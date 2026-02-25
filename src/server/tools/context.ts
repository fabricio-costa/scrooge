import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { context } from "../../api/context.js";

export function registerContextTool(server: McpServer): void {
  server.tool(
    "scrooge_context",
    "Get project patterns for a given chunk kind (e.g., viewmodel, composable, dao). Returns common annotations, tags, imports, and example sketches — so the agent writes code that matches existing conventions without reading multiple files.",
    {
      kind: z.string().min(1).max(100).describe("Chunk kind to query (e.g., 'viewmodel', 'composable', 'dao', 'function', 'class')"),
      module: z.string().max(200).optional().describe("Filter to a specific module (e.g., ':feature:auth')"),
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
    },
    async ({ kind, module, repo_path }) => {
      const result = await context(
        { kind, module },
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
