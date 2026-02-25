import type Database from "better-sqlite3";
import { openDb, recordToolCall, type ChunkRow } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { estimateTokens } from "../utils/tokens.js";
import { ensureFreshIndex, formatReindexNote } from "../utils/freshness.js";
import { validateRepoPath } from "../utils/path-validation.js";
import { escapeLike } from "../utils/sql.js";
import type { ApiContext, DepsParams, DepsResponse, DepEntry } from "./types.js";

function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toDepEntry(row: Pick<ChunkRow, "symbol_name" | "path" | "kind" | "module">): DepEntry {
  return {
    symbol: row.symbol_name ?? "",
    path: row.path,
    kind: row.kind,
    module: row.module,
  };
}

/**
 * Core dependency graph logic, testable with an in-memory DB.
 * Similar to buildStatisticsReport — takes a db + repoPath directly.
 */
export function buildDeps(
  db: Database.Database,
  repoPath: string,
  params: DepsParams,
): DepsResponse {
  const direction = params.direction ?? "both";
  const escapedSymbolLike = escapeLike(params.symbol);

  // Find definitions (same pattern as lookup.ts)
  const definitions = db
    .prepare(`
      SELECT symbol_name, path, kind, module, uses FROM chunks
      WHERE repo_path = ? AND (symbol_name = ? OR symbol_fqname LIKE ? ESCAPE '\\')
      ORDER BY kind, path
    `)
    .all(repoPath, params.symbol, `%${escapedSymbolLike}`) as Array<
      Pick<ChunkRow, "symbol_name" | "path" | "kind" | "module" | "uses">
    >;

  let forward: DepEntry[] = [];
  let reverse: DepEntry[] = [];

  // Forward dependencies: symbols used by the definition chunks
  if (direction === "forward" || direction === "both") {
    const usedSymbols = new Set<string>();
    for (const def of definitions) {
      for (const sym of parseJsonArray(def.uses)) {
        usedSymbols.add(sym);
      }
    }

    if (usedSymbols.size > 0) {
      const symbols = [...usedSymbols];
      const placeholders = symbols.map(() => "?").join(",");
      const forwardChunks = db
        .prepare(`
          SELECT DISTINCT symbol_name, path, kind, module FROM chunks
          WHERE repo_path = ? AND symbol_name IN (${placeholders})
          ORDER BY path
        `)
        .all(repoPath, ...symbols) as Array<
          Pick<ChunkRow, "symbol_name" | "path" | "kind" | "module">
        >;
      forward = forwardChunks.map(toDepEntry);
    }
  }

  // Reverse dependencies: chunks that use this symbol
  if (direction === "reverse" || direction === "both") {
    const reverseChunks = db
      .prepare(`
        SELECT DISTINCT symbol_name, path, kind, module FROM chunks
        WHERE repo_path = ? AND uses LIKE ? ESCAPE '\\' AND symbol_name != ?
        ORDER BY path
      `)
      .all(repoPath, `%"${escapedSymbolLike}"%`, params.symbol) as Array<
        Pick<ChunkRow, "symbol_name" | "path" | "kind" | "module">
      >;
    reverse = reverseChunks.map(toDepEntry);
  }

  return {
    symbol: params.symbol,
    definitions: definitions.map(toDepEntry),
    forward,
    reverse,
  };
}

export async function deps(
  params: DepsParams,
  ctx: ApiContext,
): Promise<DepsResponse> {
  const startTime = Date.now();
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);
  const escapedSymbolLike = escapeLike(params.symbol);
  const direction = params.direction ?? "both";

  try {
    const freshness = await ensureFreshIndex(db, repoPath);
    const result = buildDeps(db, repoPath, params);
    const reindexNote = formatReindexNote(freshness);

    const resultWithNote: DepsResponse & { _note?: string } = {
      ...result,
      ...(reindexNote ? { _note: reindexNote } : {}),
    };

    const responseText = JSON.stringify(resultWithNote, null, 2);

    // Calculate raw tokens from all consulted chunks
    const defChunks = db
      .prepare(`
        SELECT text_raw FROM chunks
        WHERE repo_path = ? AND (symbol_name = ? OR symbol_fqname LIKE ? ESCAPE '\\')
      `)
      .all(repoPath, params.symbol, `%${escapedSymbolLike}`) as Array<Pick<ChunkRow, "text_raw">>;

    let forwardRawChunks: Array<Pick<ChunkRow, "text_raw">> = [];
    if (direction === "forward" || direction === "both") {
      if (result.forward.length > 0) {
        const symbols = result.forward.map((f) => f.symbol);
        const placeholders = symbols.map(() => "?").join(",");
        forwardRawChunks = db
          .prepare(`SELECT text_raw FROM chunks WHERE repo_path = ? AND symbol_name IN (${placeholders})`)
          .all(repoPath, ...symbols) as Array<Pick<ChunkRow, "text_raw">>;
      }
    }

    let reverseRawChunks: Array<Pick<ChunkRow, "text_raw">> = [];
    if (direction === "reverse" || direction === "both") {
      reverseRawChunks = db
        .prepare(`SELECT text_raw FROM chunks WHERE repo_path = ? AND uses LIKE ? ESCAPE '\\' AND symbol_name != ?`)
        .all(repoPath, `%"${escapedSymbolLike}"%`, params.symbol) as Array<Pick<ChunkRow, "text_raw">>;
    }

    const tokensRaw = [...defChunks, ...forwardRawChunks, ...reverseRawChunks]
      .reduce((sum, c) => sum + estimateTokens(c.text_raw), 0);

    recordToolCall(db, {
      tool: "deps",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: estimateTokens(responseText),
      tokens_raw: tokensRaw,
      channel: ctx.channel,
      model: ctx.model,
      metadata: {
        symbol: params.symbol,
        direction,
        definitionCount: result.definitions.length,
        forwardCount: result.forward.length,
        reverseCount: result.reverse.length,
        autoReindexed: freshness.reindexed,
      },
    });

    return resultWithNote;
  } finally {
    db.close();
  }
}
