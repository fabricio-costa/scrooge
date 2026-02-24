import { basename } from "node:path";
import { openDb, recordToolCall } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { runPipeline } from "../indexer/pipeline.js";
import { isGitRepo } from "../utils/git.js";
import { validateRepoPath } from "../utils/path-validation.js";
import type { ApiContext, ReindexParams, ReindexResponse } from "./types.js";

export async function reindex(
  params: ReindexParams,
  ctx: ApiContext,
): Promise<ReindexResponse> {
  const startTime = Date.now();
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const isIncremental = params.incremental !== false;
  const repoName = basename(repoPath);

  if (!isGitRepo(repoPath)) {
    return {
      status: "error",
      repo: repoName,
      error: "Not a git repository",
    };
  }

  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);

  try {
    const stats = await runPipeline({
      repoPath,
      db,
      incremental: isIncremental,
      withEmbeddings: true,
    });

    recordToolCall(db, {
      tool: "reindex",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: 0,
      tokens_raw: 0,
      channel: ctx.channel,
      model: ctx.model,
      metadata: { ...stats, incremental: isIncremental },
    });

    return {
      status: "success",
      repo: repoName,
      stats,
    };
  } finally {
    db.close();
  }
}
