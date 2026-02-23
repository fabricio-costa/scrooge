import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openDb, recordToolCall } from "../../storage/db.js";
import { getConfig } from "../../utils/config.js";
import { hybridSearch } from "../../retrieval/hybrid.js";
import { packageResults, type ViewMode } from "../../retrieval/packager.js";
import { estimateTokens } from "../../utils/tokens.js";

export function registerSearchTool(server: McpServer): void {
  server.tool(
    "scrooge_search",
    "Hybrid code search (lexical + vector) across an indexed repository. Returns ranked chunks with token-budgeted snippets. Use sketch view for planning, raw view for implementation.",
    {
      query: z.string().describe("Search query (natural language or identifier)"),
      repo_path: z.string().optional().describe("Absolute path to the repository (defaults to cwd)"),
      filters: z.object({
        module: z.string().optional().describe("Filter by Gradle module (e.g., ':app')"),
        language: z.string().optional().describe("Filter by language (kotlin, xml, gradle)"),
        kind: z.string().optional().describe("Filter by chunk kind (class, function, composable, etc.)"),
        tags: z.array(z.string()).optional().describe("Filter by tags (e.g., ['hilt', 'compose'])"),
      }).optional(),
      view: z.enum(["sketch", "raw"]).optional().describe("sketch (compressed, default) or raw (full source)"),
      max_results: z.number().optional().describe("Maximum results to return (default 8)"),
      token_budget: z.number().optional().describe("Maximum tokens in response (default 3000)"),
    },
    async ({ query, repo_path, filters, view, max_results, token_budget }) => {
      const startTime = Date.now();
      const repoPath = repo_path ?? process.cwd();
      const config = getConfig();
      const db = openDb(config.dbPath);

      try {
        const results = await hybridSearch(
          db,
          repoPath,
          query,
          {
            module: filters?.module,
            language: filters?.language,
            kind: filters?.kind,
            tags: filters?.tags,
          },
          max_results ?? config.defaultMaxResults,
        );

        const viewMode = (view as ViewMode) ?? "sketch";
        const packaged = packageResults(
          results,
          viewMode,
          token_budget ?? config.defaultTokenBudget,
        );

        const tokensRaw = results.reduce((sum, r) => sum + estimateTokens(r.chunk.text_raw), 0);
        const sources = { lexical: 0, vector: 0, both: 0 };
        for (const r of results) {
          sources[r.source]++;
        }

        recordToolCall(db, {
          tool: "search",
          repo_path: repoPath,
          duration_ms: Date.now() - startTime,
          tokens_sent: packaged.totalTokens,
          tokens_raw: tokensRaw,
          metadata: { query, resultCount: packaged.results.length, truncated: packaged.truncated, view: viewMode, sources },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(packaged, null, 2),
            },
          ],
        };
      } finally {
        db.close();
      }
    },
  );
}
