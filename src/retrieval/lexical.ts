import type Database from "better-sqlite3";
import type { ChunkRow } from "../storage/db.js";
import type { SearchFilter, SearchResult } from "./types.js";
import { escapeLike } from "../utils/sql.js";
import { buildSearchQueryPlan, type SearchQueryPlan } from "./query.js";

export type { SearchFilter, SearchResult };

interface HeuristicMatch {
  chunk: ChunkRow;
  heuristic: number;
}

/**
 * Perform lexical search using FTS5 with query rewriting plus a symbol/path heuristic pass.
 */
export function lexicalSearch(
  db: Database.Database,
  repoPath: string,
  query: string,
  filters: SearchFilter = {},
  limit: number = 20,
): SearchResult[] {
  const plan = buildSearchQueryPlan(query);
  if (plan.variants.length === 0 && plan.likeTerms.length === 0) return [];

  const perVariantLimit = Math.max(limit * 2, 12);
  const scoreMap = new Map<string, { score: number; chunk: ChunkRow; variants: Set<string> }>();

  for (const variant of plan.variants) {
    const rows = runFtsVariant(db, repoPath, variant.query, filters, perVariantLimit);
    mergeRankedRows(scoreMap, rows, variant.name, variant.weight);
  }

  const heuristicRows = runSymbolPathVariant(db, repoPath, plan, filters, perVariantLimit);
  mergeHeuristicRows(scoreMap, heuristicRows, "symbol_path", 1.35);

  const merged = [...scoreMap.values()]
    .sort((a, b) => b.score - a.score || b.variants.size - a.variants.size || a.chunk.path.localeCompare(b.chunk.path))
    .slice(0, limit);

  return merged.map((entry, index) => ({
    chunk: entry.chunk,
    score: entry.score,
    source: "lexical" as const,
    rank: index + 1,
    metadata: {
      lexicalVariants: [...entry.variants].sort(),
    },
  }));
}

function runFtsVariant(
  db: Database.Database,
  repoPath: string,
  ftsQuery: string,
  filters: SearchFilter,
  limit: number,
): ChunkRow[] {
  if (!ftsQuery) return [];

  let sql = `
    SELECT c.*, rank AS fts_rank
    FROM chunks_fts fts
    JOIN chunks c ON c.rowid = fts.rowid
    WHERE chunks_fts MATCH ? AND c.repo_path = ?
  `;
  let params: unknown[] = [ftsQuery, repoPath];

  ({ sql, params } = appendFilters(sql, params, filters));

  sql += " ORDER BY fts_rank LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<ChunkRow & { fts_rank: number }>;
  return rows;
}

function runSymbolPathVariant(
  db: Database.Database,
  repoPath: string,
  plan: SearchQueryPlan,
  filters: SearchFilter,
  limit: number,
): HeuristicMatch[] {
  if (plan.likeTerms.length === 0) return [];

  let sql = `
    SELECT c.*
    FROM chunks c
    WHERE c.repo_path = ?
  `;
  let params: unknown[] = [repoPath];

  ({ sql, params } = appendFilters(sql, params, filters));

  const clauses: string[] = [];
  for (const term of plan.likeTerms) {
    const pattern = `%${escapeLike(term.toLowerCase())}%`;
    clauses.push("LOWER(COALESCE(c.symbol_name, '')) LIKE ? ESCAPE '\\'");
    params.push(pattern);
    clauses.push("LOWER(c.path) LIKE ? ESCAPE '\\'");
    params.push(pattern);
    clauses.push("LOWER(COALESCE(c.signature, '')) LIKE ? ESCAPE '\\'");
    params.push(pattern);
  }

  if (clauses.length === 0) return [];

  sql += ` AND (${clauses.join(" OR ")})`;

  const rows = db.prepare(sql).all(...params) as ChunkRow[];

  return rows
    .map((chunk) => ({ chunk, heuristic: scoreSymbolPathMatch(chunk, plan) }))
    .filter((entry) => entry.heuristic > 0)
    .sort((a, b) => b.heuristic - a.heuristic || a.chunk.path.localeCompare(b.chunk.path))
    .slice(0, limit);
}

function mergeRankedRows(
  scoreMap: Map<string, { score: number; chunk: ChunkRow; variants: Set<string> }>,
  rows: ChunkRow[],
  variantName: string,
  weight: number,
): void {
  for (const [index, row] of rows.entries()) {
    const existing = scoreMap.get(row.id);
    const contribution = weight / (6 + index + 1);
    if (existing) {
      existing.score += contribution;
      existing.variants.add(variantName);
    } else {
      scoreMap.set(row.id, {
        score: contribution,
        chunk: row,
        variants: new Set([variantName]),
      });
    }
  }
}

function mergeHeuristicRows(
  scoreMap: Map<string, { score: number; chunk: ChunkRow; variants: Set<string> }>,
  rows: HeuristicMatch[],
  variantName: string,
  weight: number,
): void {
  for (const [index, row] of rows.entries()) {
    const existing = scoreMap.get(row.chunk.id);
    const rankContribution = weight / (5 + index + 1);
    const heuristicContribution = Math.min(0.08, row.heuristic / 1000);
    const contribution = rankContribution + heuristicContribution;

    if (existing) {
      existing.score += contribution;
      existing.variants.add(variantName);
    } else {
      scoreMap.set(row.chunk.id, {
        score: contribution,
        chunk: row.chunk,
        variants: new Set([variantName]),
      });
    }
  }
}

function scoreSymbolPathMatch(chunk: ChunkRow, plan: SearchQueryPlan): number {
  let score = 0;

  const symbol = (chunk.symbol_name ?? "").toLowerCase();
  const path = chunk.path.toLowerCase();
  const signature = (chunk.signature ?? "").toLowerCase();

  for (const term of plan.exactTerms) {
    if (symbol === term) score += 90;
    else if (symbol.includes(term)) score += 50;

    if (path.includes(term)) score += 40;
    if (signature.includes(term)) score += 35;
  }

  for (const term of plan.terms) {
    if (symbol.includes(term)) score += 14;
    if (path.includes(term)) score += 10;
    if (signature.includes(term)) score += 8;
  }

  for (const term of plan.expansionTerms) {
    if (symbol.includes(term)) score += 8;
    if (path.includes(term)) score += 6;
    if (signature.includes(term)) score += 5;
  }

  if (plan.kindHints.includes(chunk.kind.toLowerCase())) {
    score += 6;
  }
  if (plan.languageHints.includes(chunk.language.toLowerCase())) {
    score += 5;
  }

  return score;
}

function appendFilters(
  sql: string,
  params: unknown[],
  filters: SearchFilter,
): { sql: string; params: unknown[] } {
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
      sql += ` AND c.tags LIKE ? ESCAPE '\\'`;
      params.push(`%"${escapeLike(tag)}"%`);
    }
  }

  return { sql, params };
}
