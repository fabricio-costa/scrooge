import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { map } from "../../api/map.js";

export function registerMapTool(server: McpServer): void {
  server.tool(
    "scrooge_map",
    "Get a repository map: directory tree and hierarchical summaries. Use 'repo' level for overview, 'modules' for module details, 'files' for per-file symbols (use with module filter for large repos).",
    {
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
      level: z.enum(["repo", "modules", "files"]).optional().describe("Detail level: repo (compact tree + modules), modules (module summaries only), files (per-file symbols)"),
      module: z.string().optional().describe("Focus on a specific module (e.g., ':app', ':core:common')"),
    },
    async ({ repo_path, level, module }) => {
      const result = await map(
        { level, module },
        { channel: "mcp", repoPath: repo_path },
      );
      return {
        content: [{ type: "text" as const, text: result.content }],
      };
    },
  );
}
