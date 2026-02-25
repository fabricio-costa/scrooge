import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { deps } from "../../api/deps.js";

export function registerDepsTool(server: McpServer): void {
  server.tool(
    "scrooge_deps",
    "Get a compact dependency graph for a symbol: who it depends on (forward) and who depends on it (reverse). Optimized for refactoring decisions — returns only names, paths, and kinds, not full source.",
    {
      symbol: z.string().min(1).max(200).describe("Symbol name to look up (e.g., 'AuthRepository', 'LoginViewModel')"),
      direction: z.enum(["forward", "reverse", "both"]).optional().describe("Dependency direction: 'forward' (what it uses), 'reverse' (who uses it), or 'both' (default)"),
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
    },
    async ({ symbol, direction, repo_path }) => {
      const result = await deps(
        { symbol, direction },
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
