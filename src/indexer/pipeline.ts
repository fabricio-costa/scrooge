import { readFileSync, lstatSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type Database from "better-sqlite3";
import { classifyFile } from "./classifier.js";
import { kotlinChunker } from "./chunkers/kotlin.js";
import { xmlAndroidChunker } from "./chunkers/xml-android.js";
import { gradleChunker } from "./chunkers/gradle.js";
import { genericChunker } from "./chunkers/generic.js";
import { typescriptChunker } from "./chunkers/typescript.js";
import { dartChunker } from "./chunkers/dart.js";
import type { ChunkerPlugin } from "./chunkers/types.js";
import { embed } from "./embedder.js";
import {
  insertChunk,
  insertVecEmbedding,
  deleteChunksByPath,
  deleteChunksByRepo,
  deleteVecByIds,
  getChunkIdsByPath,
  upsertIndexMeta,
} from "../storage/db.js";
import { getHeadCommit, getChangedFiles, getDeletedFiles, getTrackedFiles } from "../utils/git.js";
import { filterFiles } from "../utils/ignore.js";

const chunkers: ChunkerPlugin[] = [
  kotlinChunker,
  typescriptChunker,
  dartChunker,
  xmlAndroidChunker,
  gradleChunker,
  genericChunker, // must be last (fallback)
];

const MAX_FILE_SIZE = 1_000_000; // 1MB

export interface IndexStats {
  filesProcessed: number;
  chunksCreated: number;
  chunksRemoved: number;
  timeMs: number;
}

export interface IndexOptions {
  repoPath: string;
  db: Database.Database;
  incremental: boolean;
  withEmbeddings: boolean;
}

function log(msg: string): void {
  console.error(`[scrooge] ${msg}`);
}

function elapsed(startMs: number): string {
  return ((Date.now() - startMs) / 1000).toFixed(1) + "s";
}

export async function runPipeline(options: IndexOptions): Promise<IndexStats> {
  const { repoPath, db, incremental, withEmbeddings } = options;
  const start = Date.now();

  log(`Starting ${incremental ? "incremental" : "full"} index of ${basename(repoPath)}`);

  const commitSha = getHeadCommit(repoPath);
  let filesToProcess: string[];
  let chunksRemoved = 0;

  if (incremental) {
    const meta = db
      .prepare("SELECT last_commit_sha FROM index_meta WHERE repo_path = ?")
      .get(repoPath) as { last_commit_sha: string } | undefined;

    if (meta?.last_commit_sha) {
      const changedFiles = getChangedFiles(repoPath, meta.last_commit_sha, commitSha);
      const deletedFiles = getDeletedFiles(repoPath, meta.last_commit_sha, commitSha);
      const deletedSet = new Set(deletedFiles);

      log(`Incremental: ${changedFiles.length} changed, ${deletedFiles.length} deleted since ${meta.last_commit_sha.slice(0, 8)}`);

      // Remove chunks for changed/deleted files
      for (const file of [...changedFiles, ...deletedFiles]) {
        const ids = getChunkIdsByPath(db, repoPath, file);
        if (ids.length > 0) {
          deleteVecByIds(db, ids);
          deleteChunksByPath(db, repoPath, file);
          chunksRemoved += ids.length;
        }
      }

      // Only process changed files (not deleted)
      filesToProcess = filterFiles(changedFiles.filter((f) => !deletedSet.has(f)));
    } else {
      log("No previous index found, falling back to full index");
      filesToProcess = filterFiles(getTrackedFiles(repoPath));
    }
  } else {
    // Full re-index: clear existing chunks to avoid orphans from deleted files
    const existingIds = (db.prepare("SELECT id FROM chunks WHERE repo_path = ?").all(repoPath) as Array<{ id: string }>).map((r) => r.id);
    if (existingIds.length > 0) {
      log(`Clearing ${existingIds.length} existing chunks`);
      deleteVecByIds(db, existingIds);
      deleteChunksByRepo(db, repoPath);
      chunksRemoved = existingIds.length;
    }
    filesToProcess = filterFiles(getTrackedFiles(repoPath));
  }

  log(`${filesToProcess.length} files to process`);

  let chunksCreated = 0;
  let filesProcessedSoFar = 0;
  let errors = 0;
  const logInterval = Math.max(1, Math.floor(filesToProcess.length / 20)); // ~20 progress updates

  for (const file of filesToProcess) {
    try {
      const fullPath = join(repoPath, file);

      // Skip symlinks to prevent traversal
      try {
        if (lstatSync(fullPath).isSymbolicLink()) continue;
      } catch {
        continue;
      }

      // Skip files exceeding size limit
      try {
        const stat = statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE) {
          log(`Skipping ${file}: exceeds 1MB`);
          continue;
        }
      } catch {
        continue;
      }

      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        continue; // File might have been deleted
      }

      const language = classifyFile(file);
      const chunker = chunkers.find((c) => c.supports(file, language));
      if (!chunker) continue;

      const chunks = chunker.chunk(file, content);

      // Detect module from path (e.g., app/src/main/... → :app)
      const module = detectModule(file);
      const sourceSet = detectSourceSet(file);

      for (const chunk of chunks) {
        chunk.module = module;
        chunk.sourceSet = sourceSet;

        insertChunk(db, {
          id: chunk.id,
          repo_path: repoPath,
          commit_sha: commitSha,
          path: chunk.path,
          module: chunk.module ?? null,
          source_set: chunk.sourceSet ?? null,
          language: chunk.language,
          kind: chunk.kind,
          symbol_name: chunk.symbolName ?? null,
          symbol_fqname: chunk.symbolFqname ?? null,
          signature: chunk.signature ?? null,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          text_raw: chunk.textRaw,
          text_sketch: chunk.textSketch,
          tags: chunk.tags.length > 0 ? JSON.stringify(chunk.tags) : null,
          annotations: chunk.annotations.length > 0 ? JSON.stringify(chunk.annotations) : null,
          defines: chunk.defines.length > 0 ? JSON.stringify(chunk.defines) : null,
          uses: chunk.uses.length > 0 ? JSON.stringify(chunk.uses) : null,
          content_hash: chunk.contentHash,
        });

        if (withEmbeddings) {
          const embedding = await embed(chunk.textSketch || chunk.textRaw);
          insertVecEmbedding(db, chunk.id, embedding);
        }

        chunksCreated++;
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      log(`Error processing ${file}: ${msg}`);
      continue;
    }

    filesProcessedSoFar++;
    if (filesProcessedSoFar % logInterval === 0 || filesProcessedSoFar === filesToProcess.length) {
      const pct = Math.round((filesProcessedSoFar / filesToProcess.length) * 100);
      log(`${pct}% (${filesProcessedSoFar}/${filesToProcess.length} files, ${chunksCreated} chunks) ${elapsed(start)}`);
    }
  }

  // Update index metadata
  const totalChunks = (
    db.prepare("SELECT COUNT(*) as cnt FROM chunks WHERE repo_path = ?").get(repoPath) as { cnt: number }
  ).cnt;
  const totalFiles = (
    db.prepare("SELECT COUNT(DISTINCT path) as cnt FROM chunks WHERE repo_path = ?").get(repoPath) as { cnt: number }
  ).cnt;

  upsertIndexMeta(db, {
    repo_path: repoPath,
    last_commit_sha: commitSha,
    last_indexed_at: new Date().toISOString(),
    total_chunks: totalChunks,
    total_files: totalFiles,
  });

  const stats = {
    filesProcessed: filesToProcess.length,
    chunksCreated,
    chunksRemoved,
    timeMs: Date.now() - start,
  };

  log(`Done in ${elapsed(start)} -- ${stats.filesProcessed} files, ${stats.chunksCreated} chunks created, ${stats.chunksRemoved} removed${errors > 0 ? `, ${errors} errors` : ""}`);

  return stats;
}

function detectModule(filePath: string): string | undefined {
  // Pattern: <module>/src/... → :<module> (supports nested like core/common/src/ → :core:common)
  const match = filePath.match(/^(.+?)\/src\//);
  if (match) return `:${match[1].replace(/\//g, ":")}`;
  return undefined;
}

function detectSourceSet(filePath: string): string | undefined {
  const match = filePath.match(/\/src\/(\w+)\//);
  if (match) return match[1]; // main, test, androidTest
  return undefined;
}
