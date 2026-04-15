import { basename } from "node:path";
import type Database from "better-sqlite3";
import type { SearchFilter, SearchResult } from "./lexical.js";
import { lexicalSearch } from "./lexical.js";
import { vectorSearch } from "./vector.js";
import { getConfig } from "../utils/config.js";
import { buildSearchQueryPlan, type SearchQueryPlan } from "./query.js";

export interface SearchMetrics {
  candidatesBeforeFusion: number;
  lexicalCandidates: number;
  vectorCandidates: number;
  rrfK: number;
  rerankedCount: number;
  query: {
    terms: string[];
    exactTerms: string[];
    expansions: string[];
    aliasesUsed: string[];
    variants: string[];
    languageHints: string[];
    kindHints: string[];
  };
  scores: Array<{
    chunkId: string;
    rrfScore: number;
    rerankScore: number;
    finalScore: number;
    lexicalRank: number | null;
    vectorRank: number | null;
    lexicalScore: number | null;
    vectorDistance: number | null;
    lexicalVariants: string[];
    reasons: string[];
  }>;
}

export interface HybridSearchResult {
  results: SearchResult[];
  metrics: SearchMetrics;
}

interface MergedEntry {
  rrfScore: number;
  chunk: SearchResult["chunk"];
  sources: Set<string>;
  lexicalVariants: Set<string>;
}

/**
 * Reciprocal Rank Fusion (RRF) to merge lexical and vector search results,
 * followed by a light heuristic reranker for symbol/path exactness.
 * score_rrf(doc) = Σ 1 / (k + rank_in_system)
 */
export async function hybridSearch(
  db: Database.Database,
  repoPath: string,
  query: string,
  filters: SearchFilter = {},
  maxResults: number = 8,
): Promise<HybridSearchResult> {
  const config = getConfig();
  const k = config.rrfK;
  const queryPlan = buildSearchQueryPlan(query);

  // Run both searches
  const lexicalResults = lexicalSearch(db, repoPath, query, filters, maxResults * 3);
  const vectorResults = await vectorSearch(db, repoPath, query, filters, maxResults * 3);

  // Build per-chunk detail maps for metrics
  const lexicalRankMap = new Map<string, { rank: number; score: number; variants: string[] }>();
  for (const r of lexicalResults) {
    lexicalRankMap.set(r.chunk.id, {
      rank: r.rank,
      score: r.score,
      variants: r.metadata?.lexicalVariants ?? [],
    });
  }
  const vectorRankMap = new Map<string, { rank: number; distance: number }>();
  for (const r of vectorResults) {
    // score = 1 - distance, so distance = 1 - score
    vectorRankMap.set(r.chunk.id, { rank: r.rank, distance: 1 - r.score });
  }

  // Build RRF score map
  const scoreMap = new Map<string, MergedEntry>();

  for (const result of lexicalResults) {
    const existing = scoreMap.get(result.chunk.id);
    const rrfScore = 1 / (k + result.rank);
    if (existing) {
      existing.rrfScore += rrfScore;
      existing.sources.add("lexical");
      for (const variant of result.metadata?.lexicalVariants ?? []) {
        existing.lexicalVariants.add(variant);
      }
    } else {
      scoreMap.set(result.chunk.id, {
        rrfScore,
        chunk: result.chunk,
        sources: new Set(["lexical"]),
        lexicalVariants: new Set(result.metadata?.lexicalVariants ?? []),
      });
    }
  }

  for (const result of vectorResults) {
    const existing = scoreMap.get(result.chunk.id);
    const rrfScore = 1 / (k + result.rank);
    if (existing) {
      existing.rrfScore += rrfScore;
      existing.sources.add("vector");
    } else {
      scoreMap.set(result.chunk.id, {
        rrfScore,
        chunk: result.chunk,
        sources: new Set(["vector"]),
        lexicalVariants: new Set(),
      });
    }
  }

  const reranked = [...scoreMap.values()]
    .map((entry) => {
      const rerank = computeRerankScore(entry, queryPlan);
      return {
        ...entry,
        rerankScore: rerank.score,
        finalScore: entry.rrfScore + rerank.score,
        reasons: rerank.reasons,
      };
    })
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
      if (b.sources.size !== a.sources.size) return b.sources.size - a.sources.size;
      return a.chunk.path.localeCompare(b.chunk.path);
    })
    .slice(0, maxResults);

  const results = reranked.map((entry, index) => ({
    chunk: entry.chunk,
    score: entry.finalScore,
    source: entry.sources.size === 2
      ? "both" as const
      : (entry.sources.values().next().value as "lexical" | "vector"),
    rank: index + 1,
    metadata: entry.lexicalVariants.size > 0
      ? { lexicalVariants: [...entry.lexicalVariants].sort() }
      : undefined,
  }));

  const metrics: SearchMetrics = {
    candidatesBeforeFusion: scoreMap.size,
    lexicalCandidates: lexicalResults.length,
    vectorCandidates: vectorResults.length,
    rrfK: k,
    rerankedCount: reranked.filter((entry) => entry.rerankScore > 0).length,
    query: {
      terms: queryPlan.terms,
      exactTerms: queryPlan.exactTerms,
      expansions: queryPlan.expansionTerms,
      aliasesUsed: queryPlan.aliasesUsed,
      variants: queryPlan.variants.map((variant) => variant.name),
      languageHints: queryPlan.languageHints,
      kindHints: queryPlan.kindHints,
    },
    scores: reranked.map((r) => {
      const lex = lexicalRankMap.get(r.chunk.id);
      const vec = vectorRankMap.get(r.chunk.id);
      return {
        chunkId: r.chunk.id,
        rrfScore: r.rrfScore,
        rerankScore: r.rerankScore,
        finalScore: r.finalScore,
        lexicalRank: lex?.rank ?? null,
        vectorRank: vec?.rank ?? null,
        lexicalScore: lex?.score ?? null,
        vectorDistance: vec?.distance ?? null,
        lexicalVariants: [...r.lexicalVariants].sort(),
        reasons: r.reasons,
      };
    }),
  };

  return { results, metrics };
}

function computeRerankScore(entry: MergedEntry, plan: SearchQueryPlan): { score: number; reasons: string[] } {
  let score = 0;
  const reasons = new Set<string>();

  const headerParts = [
    entry.chunk.symbol_name ?? "",
    entry.chunk.signature ?? "",
    basename(entry.chunk.path),
    entry.chunk.path,
    entry.chunk.kind,
    entry.chunk.language,
    ...parseStringArray(entry.chunk.tags),
    ...parseStringArray(entry.chunk.uses),
  ];
  const header = headerParts.join(" ").toLowerCase();
  const body = entry.chunk.text_raw.toLowerCase();

  if (plan.identifierLike) {
    const queryCompact = compact(plan.original);
    const symbolCompact = compact(entry.chunk.symbol_name ?? "");
    const basenameCompact = compact(basename(entry.chunk.path));
    const pathCompact = compact(entry.chunk.path);
    const signatureCompact = compact(entry.chunk.signature ?? "");

    if (queryCompact.length >= 3) {
      if (symbolCompact === queryCompact) {
        score += 0.036;
        reasons.add("exact_symbol");
      } else if (symbolCompact.includes(queryCompact)) {
        score += 0.02;
        reasons.add("symbol_match");
      }

      if (basenameCompact === queryCompact || basenameCompact.startsWith(queryCompact)) {
        score += 0.026;
        reasons.add("basename_match");
      } else if (pathCompact.includes(queryCompact)) {
        score += 0.02;
        reasons.add("path_match");
      } else if (signatureCompact.includes(queryCompact)) {
        score += 0.016;
        reasons.add("signature_match");
      }
    }
  }

  const matchedHeaderTerms = plan.terms.filter((term) => header.includes(term));
  if (matchedHeaderTerms.length > 0) {
    score += Math.min(0.018, matchedHeaderTerms.length * 0.0045);
    reasons.add("header_overlap");

    if (matchedHeaderTerms.length === plan.terms.length && plan.terms.length > 1) {
      score += 0.008;
      reasons.add("all_terms_in_header");
    }
  }

  const matchedBodyTerms = plan.terms.filter((term) => !matchedHeaderTerms.includes(term) && body.includes(term));
  if (matchedBodyTerms.length > 0) {
    score += Math.min(0.009, matchedBodyTerms.length * 0.0025);
    reasons.add("body_overlap");
  }

  const matchedExpansionTerms = plan.expansionTerms.filter((term) => header.includes(term) || body.includes(term));
  if (matchedExpansionTerms.length > 0) {
    score += Math.min(0.006, matchedExpansionTerms.length * 0.0015);
    reasons.add("expanded_overlap");
  }

  if (plan.kindHints.includes(entry.chunk.kind.toLowerCase())) {
    score += 0.007;
    reasons.add("kind_hint");
  }
  if (plan.languageHints.includes(entry.chunk.language.toLowerCase())) {
    score += 0.007;
    reasons.add("language_hint");
  }
  if (entry.sources.size === 2) {
    score += 0.004;
    reasons.add("source_consensus");
  }
  if (entry.lexicalVariants.has("exact")) {
    score += 0.006;
    reasons.add("lexical_exact");
  }
  if (entry.lexicalVariants.has("symbol_path")) {
    score += 0.006;
    reasons.add("symbol_path_hit");
  }

  return {
    score: Math.min(score, 0.09),
    reasons: [...reasons],
  };
}

function compact(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}
