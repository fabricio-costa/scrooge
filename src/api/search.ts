import { openDb, recordToolCall } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { hybridSearch } from "../retrieval/hybrid.js";
import { packageResults, type ViewMode } from "../retrieval/packager.js";
import { estimateTokens } from "../utils/tokens.js";
import { ensureFreshIndex, formatReindexNote } from "../utils/freshness.js";
import { validateRepoPath } from "../utils/path-validation.js";
import type { ApiContext, SearchParams, SearchResponse } from "./types.js";

export async function search(
  params: SearchParams,
  ctx: ApiContext,
): Promise<SearchResponse> {
  const startTime = Date.now();
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);

  try {
    const freshness = await ensureFreshIndex(db, repoPath);

    const results = await hybridSearch(
      db,
      repoPath,
      params.query,
      {
        module: params.filters?.module,
        language: params.filters?.language,
        kind: params.filters?.kind,
        tags: params.filters?.tags,
      },
      params.maxResults ?? config.defaultMaxResults,
    );

    const viewMode: ViewMode = params.view ?? "sketch";
    const packaged = packageResults(
      results,
      viewMode,
      params.tokenBudget ?? config.defaultTokenBudget,
    );

    const tokensRaw = results.reduce((sum, r) => sum + estimateTokens(r.chunk.text_raw), 0);
    const sources = { lexical: 0, vector: 0, both: 0 };
    for (const r of results) {
      sources[r.source]++;
    }

    const reindexNote = formatReindexNote(freshness);

    recordToolCall(db, {
      tool: "search",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: packaged.totalTokens,
      tokens_raw: tokensRaw,
      channel: ctx.channel,
      metadata: {
        query: params.query,
        resultCount: packaged.results.length,
        truncated: packaged.truncated,
        view: viewMode,
        sources,
        autoReindexed: freshness.reindexed,
      },
    });

    return {
      results: packaged.results,
      totalTokens: packaged.totalTokens,
      truncated: packaged.truncated,
      sources,
      ...(reindexNote ? { _note: reindexNote } : {}),
    };
  } finally {
    db.close();
  }
}
