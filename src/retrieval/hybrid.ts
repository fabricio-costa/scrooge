import type Database from "better-sqlite3";
import type { SearchFilter, SearchResult } from "./lexical.js";
import { lexicalSearch } from "./lexical.js";
import { vectorSearch } from "./vector.js";
import { getConfig } from "../utils/config.js";

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
): Promise<SearchResult[]> {
  const config = getConfig();
  const k = config.rrfK;

  // Run both searches
  const lexicalResults = lexicalSearch(db, repoPath, query, filters, maxResults * 3);
  const vectorResults = await vectorSearch(db, repoPath, query, filters, maxResults * 3);

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

  return merged.map((entry, index) => ({
    chunk: entry.chunk,
    score: entry.score,
    source: entry.sources.size === 2 ? "both" as const : (entry.sources.values().next().value as "lexical" | "vector"),
    rank: index + 1,
  }));
}
