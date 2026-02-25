import type Database from "better-sqlite3";
import type { SearchFilter, SearchResult } from "./lexical.js";
import { lexicalSearch } from "./lexical.js";
import { vectorSearch } from "./vector.js";
import { getConfig } from "../utils/config.js";

export interface SearchMetrics {
  candidatesBeforeFusion: number;
  lexicalCandidates: number;
  vectorCandidates: number;
  rrfK: number;
  scores: Array<{
    chunkId: string;
    rrfScore: number;
    lexicalRank: number | null;
    vectorRank: number | null;
    lexicalScore: number | null;
    vectorDistance: number | null;
  }>;
}

export interface HybridSearchResult {
  results: SearchResult[];
  metrics: SearchMetrics;
}

/**
 * Reciprocal Rank Fusion (RRF) to merge lexical and vector search results.
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

  // Run both searches
  const lexicalResults = lexicalSearch(db, repoPath, query, filters, maxResults * 3);
  const vectorResults = await vectorSearch(db, repoPath, query, filters, maxResults * 3);

  // Build per-chunk detail maps for metrics
  const lexicalRankMap = new Map<string, { rank: number; score: number }>();
  for (const r of lexicalResults) {
    lexicalRankMap.set(r.chunk.id, { rank: r.rank, score: r.score });
  }
  const vectorRankMap = new Map<string, { rank: number; distance: number }>();
  for (const r of vectorResults) {
    // score = 1 - distance, so distance = 1 - score
    vectorRankMap.set(r.chunk.id, { rank: r.rank, distance: 1 - r.score });
  }

  // Build RRF score map
  const scoreMap = new Map<string, { score: number; chunk: SearchResult["chunk"]; sources: Set<string> }>();

  for (const result of lexicalResults) {
    const existing = scoreMap.get(result.chunk.id);
    const rrfScore = 1 / (k + result.rank);
    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("lexical");
    } else {
      scoreMap.set(result.chunk.id, {
        score: rrfScore,
        chunk: result.chunk,
        sources: new Set(["lexical"]),
      });
    }
  }

  for (const result of vectorResults) {
    const existing = scoreMap.get(result.chunk.id);
    const rrfScore = 1 / (k + result.rank);
    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("vector");
    } else {
      scoreMap.set(result.chunk.id, {
        score: rrfScore,
        chunk: result.chunk,
        sources: new Set(["vector"]),
      });
    }
  }

  // Sort by RRF score descending
  const merged = [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  const results = merged.map((entry, index) => ({
    chunk: entry.chunk,
    score: entry.score,
    source: entry.sources.size === 2 ? "both" as const : (entry.sources.values().next().value as "lexical" | "vector"),
    rank: index + 1,
  }));

  const metrics: SearchMetrics = {
    candidatesBeforeFusion: scoreMap.size,
    lexicalCandidates: lexicalResults.length,
    vectorCandidates: vectorResults.length,
    rrfK: k,
    scores: results.map((r) => {
      const lex = lexicalRankMap.get(r.chunk.id);
      const vec = vectorRankMap.get(r.chunk.id);
      return {
        chunkId: r.chunk.id,
        rrfScore: r.score,
        lexicalRank: lex?.rank ?? null,
        vectorRank: vec?.rank ?? null,
        lexicalScore: lex?.score ?? null,
        vectorDistance: vec?.distance ?? null,
      };
    }),
  };

  return { results, metrics };
}
