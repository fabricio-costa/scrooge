import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reindex } from "../../api/reindex.js";

export function registerReindexTool(server: McpServer): void {
  server.tool(
    "scrooge_reindex",
    "Trigger indexing of a repository. By default uses incremental mode (only re-indexes files changed since last index). Use incremental=false for a full re-index.",
    {
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
      incremental: z.boolean().optional().describe("Incremental index via git diff (default true)"),
    },
    async ({ repo_path, incremental }) => {
      const result = await reindex(
        { incremental },
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
