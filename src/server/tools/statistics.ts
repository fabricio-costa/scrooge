import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { statistics } from "../../api/statistics.js";

export function registerStatisticsTool(server: McpServer): void {
  server.tool(
    "scrooge_statistics",
    "Usage and token savings metrics for Scrooge. Shows how much Scrooge saves over time by comparing compressed responses to raw content costs.",
    {
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
      period: z
        .enum(["today", "week", "month", "all"])
        .optional()
        .describe('Time period to aggregate: "today", "week", "month", "all" (default "all")'),
    },
    async ({ repo_path, period }) => {
      const result = await statistics(
        { period },
        { channel: "mcp", repoPath: repo_path },
      );
      return {
        content: [{ type: "text" as const, text: result.report }],
      };
    },
  );
}
