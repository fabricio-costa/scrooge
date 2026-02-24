import type Database from "better-sqlite3";
import { getIndexMeta } from "../storage/db.js";
import { isGitRepo, getHeadCommit } from "./git.js";
import { runPipeline, type IndexStats } from "../indexer/pipeline.js";

export interface FreshnessResult {
  reindexed: boolean;
  reason?: "not_indexed" | "stale" | "fresh" | "not_git";
  stats?: IndexStats;
}

/**
 * Ensures the index is fresh before a read operation.
 * Compares HEAD with last indexed commit and runs incremental reindex if stale.
 */
export async function ensureFreshIndex(
  db: Database.Database,
  repoPath: string,
): Promise<FreshnessResult> {
  if (!isGitRepo(repoPath)) {
    return { reindexed: false, reason: "not_git" };
  }

  const meta = getIndexMeta(db, repoPath);
  const currentHead = getHeadCommit(repoPath);

  if (!meta) {
    // Never indexed — run full index
    const stats = await runPipeline({
      repoPath,
      db,
      incremental: false,
      withEmbeddings: true,
    });
    return { reindexed: true, reason: "not_indexed", stats };
  }

  if (meta.last_commit_sha !== currentHead) {
    // Stale — run incremental index
    const stats = await runPipeline({
      repoPath,
      db,
      incremental: true,
      withEmbeddings: true,
    });
    return { reindexed: true, reason: "stale", stats };
  }

  return { reindexed: false, reason: "fresh" };
}

/**
 * Formats a note to append to tool responses when auto-reindex occurred.
 */
export function formatReindexNote(result: FreshnessResult): string | null {
  if (!result.reindexed || !result.stats) return null;

  const { filesProcessed, chunksCreated, chunksRemoved, timeMs } = result.stats;
  const action = result.reason === "not_indexed" ? "auto-indexed" : "auto-refreshed";
  return `Index ${action} (${filesProcessed} files, ${chunksCreated} chunks added, ${chunksRemoved} removed, ${timeMs}ms)`;
}
