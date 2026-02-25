import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exportData, formatAsJsonl, formatAsCsv } from "../../api/export.js";

export function registerExportTool(server: McpServer): void {
  server.tool(
    "scrooge_export",
    "Export raw telemetry data as JSONL or CSV for external analysis. Returns tool call records with timing, token counts, and retrieval metadata.",
    {
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
      period: z
        .enum(["today", "week", "month", "all"])
        .optional()
        .describe('Time period filter: "today", "week", "month", "all" (default "all")'),
      tool: z.string().optional().describe("Filter by tool name (e.g., \"search\", \"lookup\")"),
      format: z
        .enum(["jsonl", "csv"])
        .optional()
        .describe('Output format: "jsonl" (default) or "csv"'),
      anonymize: z.boolean().optional().describe("Strip repo paths and queries for sharing"),
      limit: z.number().int().positive().optional().describe("Maximum number of records to return"),
    },
    async ({ repo_path, period, tool, format, anonymize, limit }) => {
      const result = await exportData(
        { period, tool, format, anonymize, limit },
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );

      const text = result.format === "csv"
        ? formatAsCsv(result.records)
        : formatAsJsonl(result.records);

      return {
        content: [{ type: "text" as const, text: text || "No records found." }],
      };
    },
  );
}
