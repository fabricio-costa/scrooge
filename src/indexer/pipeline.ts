import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { classifyFile } from "./classifier.js";
import { kotlinChunker } from "./chunkers/kotlin.js";
import { xmlAndroidChunker } from "./chunkers/xml-android.js";
import { gradleChunker } from "./chunkers/gradle.js";
import { genericChunker } from "./chunkers/generic.js";
import type { Chunk, ChunkerPlugin } from "./chunkers/types.js";
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
  xmlAndroidChunker,
  gradleChunker,
  genericChunker, // must be last (fallback)
];

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

export async function runPipeline(options: IndexOptions): Promise<IndexStats> {
  const { repoPath, db, incremental, withEmbeddings } = options;
  const start = Date.now();

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
      // No previous index: full index
      filesToProcess = filterFiles(getTrackedFiles(repoPath));
    }
  } else {
    // Full re-index: clear existing chunks to avoid orphans from deleted files
    const existingIds = (db.prepare("SELECT id FROM chunks WHERE repo_path = ?").all(repoPath) as Array<{ id: string }>).map((r) => r.id);
    if (existingIds.length > 0) {
      deleteVecByIds(db, existingIds);
      deleteChunksByRepo(db, repoPath);
      chunksRemoved = existingIds.length;
    }
    filesToProcess = filterFiles(getTrackedFiles(repoPath));
  }

  let chunksCreated = 0;

  for (const file of filesToProcess) {
    try {
      let content: string;
      try {
        content = readFileSync(join(repoPath, file), "utf-8");
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
      console.error(`[scrooge] Error processing file ${file}:`, err);
      continue;
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

  return {
    filesProcessed: filesToProcess.length,
    chunksCreated,
    chunksRemoved,
    timeMs: Date.now() - start,
  };
}

function detectModule(filePath: string): string | undefined {
  // Pattern: <module>/src/... → :<module>
  const match = filePath.match(/^([^/]+)\/src\//);
  if (match) return `:${match[1]}`;
  return undefined;
}

function detectSourceSet(filePath: string): string | undefined {
  const match = filePath.match(/\/src\/(\w+)\//);
  if (match) return match[1]; // main, test, androidTest
  return undefined;
}
