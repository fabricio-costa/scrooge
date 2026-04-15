import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { openDb, recordToolCall, type ChunkRow } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { estimateTokens } from "../utils/tokens.js";
import { ensureFreshIndex, formatReindexNote } from "../utils/freshness.js";
import { validateRepoPath } from "../utils/path-validation.js";
import { escapeLike } from "../utils/sql.js";
import type { ApiContext, SourceParams, SourceResponse, SourceChunk, SourceContext } from "./types.js";

/**
 * Core exact-source lookup logic, testable with an in-memory DB.
 * Returns raw chunk source for a known chunk ID or symbol.
 */
export function buildSource(
  db: Database.Database,
  repoPath: string,
  params: SourceParams,
): SourceResponse {
  if (!params.chunkId && !params.symbol) {
    throw new Error("Provide chunkId or symbol");
  }

  const before = Math.max(0, params.before ?? 0);
  const after = Math.max(0, params.after ?? 0);

  let chunks: ChunkRow[];
  if (params.chunkId) {
    chunks = db
      .prepare(`
        SELECT * FROM chunks
        WHERE repo_path = ? AND id = ?
        ORDER BY path, start_line
      `)
      .all(repoPath, params.chunkId) as ChunkRow[];
  } else {
    const escapedSymbolLike = escapeLike(params.symbol!);
    chunks = db
      .prepare(`
        SELECT * FROM chunks
        WHERE repo_path = ? AND (symbol_name = ? OR symbol_fqname LIKE ? ESCAPE '\\')
        ORDER BY kind, path, start_line
      `)
      .all(repoPath, params.symbol, `%${escapedSymbolLike}`) as ChunkRow[];
  }

  return {
    ...(params.chunkId ? { chunkId: params.chunkId } : {}),
    ...(params.symbol ? { symbol: params.symbol } : {}),
    before,
    after,
    chunks: chunks.map((chunk) => formatSourceChunk(repoPath, chunk, before, after)),
  };
}

function formatSourceChunk(repoPath: string, chunk: ChunkRow, before: number, after: number): SourceChunk {
  const context = readContext(repoPath, chunk, before, after);

  return {
    id: chunk.id,
    path: chunk.path,
    lines: `${chunk.start_line}-${chunk.end_line}`,
    kind: chunk.kind,
    symbol: chunk.symbol_name,
    module: chunk.module,
    language: chunk.language,
    signature: chunk.signature,
    source: chunk.text_raw,
    ...(context.beforeContext ? { beforeContext: context.beforeContext } : {}),
    ...(context.afterContext ? { afterContext: context.afterContext } : {}),
  };
}

function readContext(
  repoPath: string,
  chunk: ChunkRow,
  before: number,
  after: number,
): { beforeContext?: SourceContext; afterContext?: SourceContext } {
  if (before === 0 && after === 0) return {};

  const filePath = resolve(repoPath, chunk.path);
  const normalizedRepo = repoPath.endsWith(sep) ? repoPath : `${repoPath}${sep}`;
  if (filePath !== repoPath && !filePath.startsWith(normalizedRepo)) {
    return {};
  }

  if (!existsSync(filePath)) return {};

  try {
    const fileLines = readFileSync(filePath, "utf-8").split(/\r?\n/);
    const result: { beforeContext?: SourceContext; afterContext?: SourceContext } = {};

    if (before > 0) {
      const startLine = Math.max(1, chunk.start_line - before);
      const endLine = Math.max(0, chunk.start_line - 1);
      if (endLine >= startLine) {
        const text = fileLines.slice(startLine - 1, endLine).join("\n");
        if (text.trim()) {
          result.beforeContext = {
            lines: `${startLine}-${endLine}`,
            text,
          };
        }
      }
    }

    if (after > 0) {
      const startLine = chunk.end_line + 1;
      const endLine = Math.min(fileLines.length, chunk.end_line + after);
      if (endLine >= startLine) {
        const text = fileLines.slice(startLine - 1, endLine).join("\n");
        if (text.trim()) {
          result.afterContext = {
            lines: `${startLine}-${endLine}`,
            text,
          };
        }
      }
    }

    return result;
  } catch {
    return {};
  }
}

export async function source(
  params: SourceParams,
  ctx: ApiContext,
): Promise<SourceResponse> {
  const startTime = Date.now();
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);

  try {
    const freshness = await ensureFreshIndex(db, repoPath);
    const result = buildSource(db, repoPath, params);
    const reindexNote = formatReindexNote(freshness);

    const resultWithNote: SourceResponse & { _note?: string } = {
      ...result,
      ...(reindexNote ? { _note: reindexNote } : {}),
    };

    const responseText = JSON.stringify(resultWithNote, null, 2);
    const tokensRaw = result.chunks.reduce((sum, chunk) => {
      const beforeTokens = chunk.beforeContext ? estimateTokens(chunk.beforeContext.text) : 0;
      const afterTokens = chunk.afterContext ? estimateTokens(chunk.afterContext.text) : 0;
      return sum + estimateTokens(chunk.source) + beforeTokens + afterTokens;
    }, 0);

    recordToolCall(db, {
      tool: "source",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: estimateTokens(responseText),
      tokens_raw: tokensRaw,
      channel: ctx.channel,
      model: ctx.model,
      metadata: {
        chunkId: params.chunkId ?? null,
        symbol: params.symbol ?? null,
        before: result.before,
        after: result.after,
        chunkCount: result.chunks.length,
        autoReindexed: freshness.reindexed,
      },
    });

    return resultWithNote;
  } finally {
    db.close();
  }
}
