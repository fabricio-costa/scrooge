import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookup } from "../../api/lookup.js";

export function registerLookupTool(server: McpServer): void {
  server.tool(
    "scrooge_lookup",
    "Look up a symbol by name: find its definition and all usages across the codebase.",
    {
      symbol: z.string().min(1).max(200).describe("Symbol name to look up (e.g., 'LoginViewModel', 'authenticate')"),
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
      include_usages: z.boolean().optional().describe("Include chunks that reference this symbol (default true)"),
    },
    async ({ symbol, repo_path, include_usages }) => {
      const result = await lookup(
        { symbol, includeUsages: include_usages },
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
