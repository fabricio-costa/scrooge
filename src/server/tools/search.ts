import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { search } from "../../api/search.js";

export function registerSearchTool(server: McpServer): void {
  server.tool(
    "scrooge_search",
    "Hybrid code search (lexical + vector) across an indexed repository. Returns ranked chunks with token-budgeted snippets. Use sketch view for planning, raw view for implementation.",
    {
      query: z.string().min(1).max(1000).describe("Search query (natural language or identifier)"),
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
      filters: z.object({
        module: z.string().optional().describe("Filter by Gradle module (e.g., ':app')"),
        language: z.string().optional().describe("Filter by language (kotlin, xml, gradle)"),
        kind: z.string().optional().describe("Filter by chunk kind (class, function, composable, etc.)"),
        tags: z.array(z.string()).optional().describe("Filter by tags (e.g., ['hilt', 'compose'])"),
      }).optional(),
      view: z.enum(["sketch", "raw"]).optional().describe("sketch (compressed, default) or raw (full source)"),
      max_results: z.number().int().min(1).max(100).optional().describe("Maximum results to return (default 8)"),
      token_budget: z.number().int().min(100).max(50000).optional().describe("Maximum tokens in response (default 3000)"),
    },
    async ({ query, repo_path, filters, view, max_results, token_budget }) => {
      const result = await search(
        { query, filters, view, maxResults: max_results, tokenBudget: token_budget },
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
