import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { status } from "../../api/status.js";

export function registerStatusTool(server: McpServer): void {
  server.tool(
    "scrooge_status",
    "Get information about the Scrooge index for a repository: last indexed commit, total chunks, freshness.",
    {
      repo_path: z.string().max(500).describe("Absolute path to the repository (defaults to cwd)").optional(),
    },
    async ({ repo_path }) => {
      const result = await status(
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
