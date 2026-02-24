import type Database from "better-sqlite3";
import { getIndexMeta } from "../storage/db.js";
import { isGitRepo, getHeadCommit } from "./git.js";
import { runPipeline, type IndexStats } from "../indexer/pipeline.js";

export interface FreshnessResult {
  reindexed: boolean;
  reason?: "not_indexed" | "stale" | "fresh" | "not_git";
  stats?: IndexStats;
}

/** In-process lock to prevent concurrent reindex for the same repo */
const reindexLocks = new Map<string, Promise<FreshnessResult>>();

/** Tracks the last reindex timestamp per repo for cooldown */
const lastReindexTime = new Map<string, number>();

const COOLDOWN_MS = 5_000; // 5 seconds

/**
 * Ensures the index is fresh before a read operation.
 * Compares HEAD with last indexed commit and runs incremental reindex if stale.
 * Includes mutex to prevent concurrent reindexes and a cooldown to prevent DoS.
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

  // If index is fresh, return immediately
  if (meta && meta.last_commit_sha === currentHead) {
    return { reindexed: false, reason: "fresh" };
  }

  // Cooldown: skip if last reindex was < 5s ago
  const lastTime = lastReindexTime.get(repoPath);
  if (lastTime && Date.now() - lastTime < COOLDOWN_MS) {
    return { reindexed: false, reason: "fresh" };
  }

  // Mutex: piggyback on in-flight reindex for same repo
  const existing = reindexLocks.get(repoPath);
  if (existing) return existing;

  const promise = doReindex(db, repoPath, meta);
  reindexLocks.set(repoPath, promise);
  try {
    return await promise;
  } finally {
    reindexLocks.delete(repoPath);
    lastReindexTime.set(repoPath, Date.now());
  }
}

async function doReindex(
  db: Database.Database,
  repoPath: string,
  meta: ReturnType<typeof getIndexMeta>,
): Promise<FreshnessResult> {
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

  // Stale — run incremental index
  const stats = await runPipeline({
    repoPath,
    db,
    incremental: true,
    withEmbeddings: true,
  });
  return { reindexed: true, reason: "stale", stats };
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
