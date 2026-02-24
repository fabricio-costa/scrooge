import { basename } from "node:path";
import { openDb, getIndexMeta, recordToolCall } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { isGitRepo, getHeadCommit } from "../utils/git.js";
import { validateRepoPath } from "../utils/path-validation.js";
import type { ApiContext, StatusResponse } from "./types.js";

export async function status(
  ctx: ApiContext,
): Promise<StatusResponse> {
  const startTime = Date.now();
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);
  const repoName = basename(repoPath);

  try {
    const meta = getIndexMeta(db, repoPath);

    if (!meta) {
      recordToolCall(db, {
        tool: "status",
        repo_path: repoPath,
        duration_ms: Date.now() - startTime,
        tokens_sent: 0,
        tokens_raw: 0,
        channel: ctx.channel,
        metadata: { freshness: "not_indexed" },
      });

      return {
        status: "not_indexed",
        repo: repoName,
        message: "Repository has not been indexed yet. Run scrooge_reindex first.",
      };
    }

    let freshness = "unknown";
    if (isGitRepo(repoPath)) {
      const currentCommit = getHeadCommit(repoPath);
      freshness = currentCommit === meta.last_commit_sha ? "up_to_date" : "stale";
    }

    recordToolCall(db, {
      tool: "status",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: 0,
      tokens_raw: 0,
      channel: ctx.channel,
      model: ctx.model,
      metadata: { freshness },
    });

    return {
      status: "indexed",
      repo: repoName,
      last_commit_sha: meta.last_commit_sha,
      last_indexed_at: meta.last_indexed_at,
      total_chunks: meta.total_chunks,
      total_files: meta.total_files,
      freshness,
    };
  } finally {
    db.close();
  }
}
