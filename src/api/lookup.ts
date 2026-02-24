import { openDb, recordToolCall, type ChunkRow } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { estimateTokens } from "../utils/tokens.js";
import { ensureFreshIndex, formatReindexNote } from "../utils/freshness.js";
import { validateRepoPath } from "../utils/path-validation.js";
import { escapeLike } from "../utils/sql.js";
import type { ApiContext, LookupParams, LookupResponse, LookupChunk } from "./types.js";

function formatChunk(chunk: ChunkRow): LookupChunk {
  return {
    path: chunk.path,
    lines: `${chunk.start_line}-${chunk.end_line}`,
    kind: chunk.kind,
    symbol: chunk.symbol_name,
    module: chunk.module,
    sketch: chunk.text_sketch,
  };
}

export async function lookup(
  params: LookupParams,
  ctx: ApiContext,
): Promise<LookupResponse> {
  const startTime = Date.now();
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);
  const escapedSymbolLike = escapeLike(params.symbol);
  const escapedSymbolFts = params.symbol.replace(/"/g, '""');

  try {
    const freshness = await ensureFreshIndex(db, repoPath);

    // Find definitions
    const definitions = db
      .prepare(`
        SELECT * FROM chunks
        WHERE repo_path = ? AND (symbol_name = ? OR symbol_fqname LIKE ? ESCAPE '\\')
        ORDER BY kind, path
      `)
      .all(repoPath, params.symbol, `%${escapedSymbolLike}`) as ChunkRow[];

    let allUsages: ChunkRow[] = [];
    if (params.includeUsages !== false) {
      // Find usages: chunks whose 'uses' field contains the symbol
      const usages = db
        .prepare(`
          SELECT * FROM chunks
          WHERE repo_path = ? AND uses LIKE ? ESCAPE '\\' AND symbol_name != ?
          ORDER BY path, start_line
        `)
        .all(repoPath, `%"${escapedSymbolLike}"%`, params.symbol) as ChunkRow[];

      // Also find via FTS
      const ftsUsages = db
        .prepare(`
          SELECT c.* FROM chunks_fts fts
          JOIN chunks c ON c.rowid = fts.rowid
          WHERE chunks_fts MATCH ? AND c.repo_path = ? AND c.symbol_name != ?
          LIMIT 20
        `)
        .all(`"${escapedSymbolFts}"`, repoPath, params.symbol) as ChunkRow[];

      // Merge and deduplicate
      const seenIds = new Set(usages.map((u) => u.id));
      allUsages = [...usages];
      for (const u of ftsUsages) {
        if (!seenIds.has(u.id)) {
          allUsages.push(u);
          seenIds.add(u.id);
        }
      }
    }

    const reindexNote = formatReindexNote(freshness);

    const result: LookupResponse = {
      symbol: params.symbol,
      definitions: definitions.map(formatChunk),
      ...(params.includeUsages !== false ? { usages: allUsages.map(formatChunk) } : {}),
      ...(reindexNote ? { _note: reindexNote } : {}),
    };

    const responseText = JSON.stringify(result, null, 2);
    const tokensRaw = [...definitions, ...allUsages].reduce((sum, c) => sum + estimateTokens(c.text_raw), 0);

    recordToolCall(db, {
      tool: "lookup",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: estimateTokens(responseText),
      tokens_raw: tokensRaw,
      channel: ctx.channel,
      metadata: {
        symbol: params.symbol,
        definitionCount: definitions.length,
        usageCount: allUsages.length,
        autoReindexed: freshness.reindexed,
      },
    });

    return result;
  } finally {
    db.close();
  }
}
