import { openDb, recordToolCall } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { hybridSearch } from "../retrieval/hybrid.js";
import { getDefaultTokenBudget, packageResults, type ViewMode } from "../retrieval/packager.js";
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
    const freshnessEnd = Date.now();

    const viewMode: ViewMode = params.view ?? "sketch";
    const maxResults = params.maxResults ?? getDefaultMaxResults(viewMode, config.defaultMaxResults);

    const { results, metrics } = await hybridSearch(
      db,
      repoPath,
      params.query,
      {
        module: params.filters?.module,
        language: params.filters?.language,
        kind: params.filters?.kind,
        tags: params.filters?.tags,
      },
      maxResults,
    );
    const searchEnd = Date.now();

    const packaged = packageResults(
      results,
      viewMode,
      params.tokenBudget,
      params.query,
    );

    const tokensRaw = results
      .slice(0, packaged.results.length)
      .reduce((sum, r) => sum + estimateTokens(r.chunk.text_raw), 0);
    const sources = { lexical: 0, vector: 0, both: 0 };
    for (const r of results) {
      sources[r.source]++;
    }

    const reindexNote = formatReindexNote(freshness);
    const rewrite = metrics.query ?? {
      terms: [],
      exactTerms: [],
      expansions: [],
      aliasesUsed: [],
      variants: [],
      languageHints: [],
      kindHints: [],
    };

    recordToolCall(db, {
      tool: "search",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: packaged.totalTokens,
      tokens_raw: tokensRaw,
      channel: ctx.channel,
      model: ctx.model,
      metadata: {
        query: params.query,
        resultCount: packaged.results.length,
        truncated: packaged.truncated,
        view: viewMode,
        maxResults,
        tokenBudget: params.tokenBudget ?? getDefaultTokenBudget(viewMode, config.defaultTokenBudget),
        sources,
        autoReindexed: freshness.reindexed,
        timing: {
          freshness_ms: freshnessEnd - startTime,
          search_ms: searchEnd - freshnessEnd,
          packaging_ms: Date.now() - searchEnd,
        },
        retrieval: {
          lexicalCandidates: metrics.lexicalCandidates,
          vectorCandidates: metrics.vectorCandidates,
          candidatesBeforeFusion: metrics.candidatesBeforeFusion,
          rrfK: metrics.rrfK,
        },
        rewrite: {
          terms: rewrite.terms,
          exactTerms: rewrite.exactTerms,
          expansions: rewrite.expansions,
          aliasesUsed: rewrite.aliasesUsed,
          variants: rewrite.variants,
          languageHints: rewrite.languageHints,
          kindHints: rewrite.kindHints,
        },
        rerank: {
          rerankedCount: metrics.rerankedCount ?? 0,
        },
        packager: {
          diversityRejected: packaged.stats.diversityRejected,
          uniqueFiles: packaged.stats.uniqueFiles,
          budgetUtilization: packaged.stats.tokenBudgetUtilization,
        },
        topScores: metrics.scores.slice(0, 5).map((s) => ({
          rrf: Math.round((s.rrfScore ?? 0) * 100000) / 100000,
          rerank: Math.round((s.rerankScore ?? 0) * 100000) / 100000,
          final: Math.round((s.finalScore ?? s.rrfScore ?? 0) * 100000) / 100000,
          lex_rank: s.lexicalRank,
          vec_rank: s.vectorRank,
          variants: s.lexicalVariants ?? [],
          reasons: s.reasons ?? [],
        })),
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

function getDefaultMaxResults(view: ViewMode, baseMaxResults: number): number {
  switch (view) {
    case "implementation":
      return Math.max(4, Math.ceil(baseMaxResults / 2));
    case "raw":
      return Math.max(3, Math.ceil(baseMaxResults / 2));
    case "sketch":
    default:
      return baseMaxResults;
  }
}
