import type Database from "better-sqlite3";
import type { ChunkRow } from "../storage/db.js";
import type { SearchFilter, SearchResult } from "./lexical.js";
import { embed } from "../indexer/embedder.js";

/**
 * Perform vector similarity search using sqlite-vec.
 */
export async function vectorSearch(
  db: Database.Database,
  repoPath: string,
  query: string,
  filters: SearchFilter = {},
  limit: number = 20,
): Promise<SearchResult[]> {
  const queryEmbedding = await embed(query);

  // sqlite-vec cosine distance search
  let sql = `
    SELECT v.id, v.distance, c.*
    FROM chunks_vec v
    JOIN chunks c ON c.id = v.id
    WHERE v.embedding MATCH ? AND k = ?
      AND c.repo_path = ?
  `;
  const params: unknown[] = [queryEmbedding, limit * 2, repoPath]; // fetch more to filter

  if (filters.module) {
    sql += " AND c.module = ?";
    params.push(filters.module);
  }
  if (filters.language) {
    sql += " AND c.language = ?";
    params.push(filters.language);
  }
  if (filters.kind) {
    sql += " AND c.kind = ?";
    params.push(filters.kind);
  }

  sql += " ORDER BY v.distance LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<ChunkRow & { distance: number }>;

  // Post-filter tags (can't do LIKE in the vec query easily)
  let filtered = rows;
  if (filters.tags && filters.tags.length > 0) {
    filtered = rows.filter((row) => {
      if (!row.tags) return false;
      const tags = JSON.parse(row.tags) as string[];
      return filters.tags!.every((t) => tags.includes(t));
    });
  }

  return filtered.map((row, index) => ({
    chunk: row,
    score: 1 - row.distance, // Convert distance to similarity
    source: "vector" as const,
    rank: index + 1,
  }));
}
