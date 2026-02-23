import type Database from "better-sqlite3";
import type { ChunkRow } from "../storage/db.js";

export interface SearchFilter {
  module?: string;
  language?: string;
  kind?: string;
  tags?: string[];
}

export interface SearchResult {
  chunk: ChunkRow;
  score: number;
  source: "lexical" | "vector" | "both";
  rank: number;
}

/**
 * Perform lexical search using FTS5 with BM25 ranking.
 */
export function lexicalSearch(
  db: Database.Database,
  repoPath: string,
  query: string,
  filters: SearchFilter = {},
  limit: number = 20,
): SearchResult[] {
  const ftsQuery = tokenizeQuery(query);
  if (!ftsQuery) return [];

  let sql = `
    SELECT c.*, rank AS fts_rank
    FROM chunks_fts fts
    JOIN chunks c ON c.rowid = fts.rowid
    WHERE chunks_fts MATCH ? AND c.repo_path = ?
  `;
  const params: unknown[] = [ftsQuery, repoPath];

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
  if (filters.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      sql += " AND c.tags LIKE ?";
      params.push(`%"${tag}"%`);
    }
  }

  sql += " ORDER BY fts_rank LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<ChunkRow & { fts_rank: number }>;

  return rows.map((row, index) => ({
    chunk: row,
    score: -row.fts_rank, // FTS5 rank is negative (lower = better)
    source: "lexical" as const,
    rank: index + 1,
  }));
}

/**
 * Tokenize a natural language query for FTS5 MATCH.
 * Splits CamelCase identifiers and creates an OR query.
 */
function tokenizeQuery(query: string): string {
  // Keep original query terms alongside CamelCase-split terms
  const terms = new Set<string>();

  // Add original words
  const originalWords = query.split(/\s+/).filter((w) => w.length >= 2);
  for (const w of originalWords) {
    terms.add(w.toLowerCase());
  }

  // Split camelCase/PascalCase and add sub-terms
  const expanded = query.replace(/([a-z])([A-Z])/g, "$1 $2");
  const cleaned = expanded.replace(/[^a-zA-Z0-9\s]/g, " ");
  const subWords = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  for (const w of subWords) {
    terms.add(w.toLowerCase());
  }

  if (terms.size === 0) return "";

  // FTS5: use unquoted terms for prefix matching and OR for combining
  return [...terms].join(" OR ");
}
