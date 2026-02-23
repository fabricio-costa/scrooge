import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openDb, recordToolCall, type ChunkRow } from "../../storage/db.js";
import { getConfig } from "../../utils/config.js";
import { estimateTokens } from "../../utils/tokens.js";

export function registerLookupTool(server: McpServer): void {
  server.tool(
    "scrooge_lookup",
    "Look up a symbol by name: find its definition and all usages across the codebase.",
    {
      symbol: z.string().describe("Symbol name to look up (e.g., 'LoginViewModel', 'authenticate')"),
      repo_path: z.string().optional().describe("Absolute path to the repository (defaults to cwd)"),
      include_usages: z.boolean().optional().describe("Include chunks that reference this symbol (default true)"),
    },
    async ({ symbol, repo_path, include_usages }) => {
      const startTime = Date.now();
      const repoPath = repo_path ?? process.cwd();
      const config = getConfig();
      const db = openDb(config.dbPath);
      const escapedSymbol = symbol.replace(/"/g, '""');

      try {
        // Find definition
        const definitions = db
          .prepare(`
            SELECT * FROM chunks
            WHERE repo_path = ? AND (symbol_name = ? OR symbol_fqname LIKE ?)
            ORDER BY kind, path
          `)
          .all(repoPath, symbol, `%${symbol}`) as ChunkRow[];

        const result: Record<string, unknown> = {
          symbol,
          definitions: definitions.map(formatChunk),
        };

        let allUsages: ChunkRow[] = [];
        if (include_usages !== false) {
          // Find usages: chunks whose 'uses' field contains the symbol
          const usages = db
            .prepare(`
              SELECT * FROM chunks
              WHERE repo_path = ? AND uses LIKE ? AND symbol_name != ?
              ORDER BY path, start_line
            `)
            .all(repoPath, `%"${escapedSymbol}"%`, symbol) as ChunkRow[];

          // Also find via FTS
          const ftsUsages = db
            .prepare(`
              SELECT c.* FROM chunks_fts fts
              JOIN chunks c ON c.rowid = fts.rowid
              WHERE chunks_fts MATCH ? AND c.repo_path = ? AND c.symbol_name != ?
              LIMIT 20
            `)
            .all(`"${escapedSymbol}"`, repoPath, symbol) as ChunkRow[];

          // Merge and deduplicate
          const seenIds = new Set(usages.map((u) => u.id));
          allUsages = [...usages];
          for (const u of ftsUsages) {
            if (!seenIds.has(u.id)) {
              allUsages.push(u);
              seenIds.add(u.id);
            }
          }

          result.usages = allUsages.map(formatChunk);
        }

        const responseText = JSON.stringify(result, null, 2);
        const tokensRaw = [...definitions, ...allUsages].reduce((sum, c) => sum + estimateTokens(c.text_raw), 0);

        recordToolCall(db, {
          tool: "lookup",
          repo_path: repoPath,
          duration_ms: Date.now() - startTime,
          tokens_sent: estimateTokens(responseText),
          tokens_raw: tokensRaw,
          metadata: { symbol, definitionCount: definitions.length, usageCount: allUsages.length },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: responseText,
            },
          ],
        };
      } finally {
        db.close();
      }
    },
  );
}

function formatChunk(chunk: ChunkRow): Record<string, unknown> {
  return {
    path: chunk.path,
    lines: `${chunk.start_line}-${chunk.end_line}`,
    kind: chunk.kind,
    symbol: chunk.symbol_name,
    module: chunk.module,
    sketch: chunk.text_sketch,
  };
}
