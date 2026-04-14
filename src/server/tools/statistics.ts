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
      format: z
        .enum(["text", "json"])
        .optional()
        .describe('Output format: "text" (default) or "json" for structured dashboard-friendly data'),
    },
    async ({ repo_path, period, format }) => {
      const result = await statistics(
        { period, format },
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text" as const, text: format === "json" ? JSON.stringify(result.data, null, 2) : result.report }],
      };
    },
  );
}
