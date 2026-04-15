import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { source } from "../../api/source.js";

export function registerSourceTool(server: McpServer): void {
  server.tool(
    "scrooge_source",
    "Get the exact raw source for a known chunk or symbol. Use this instead of reading a whole file when you already know what implementation you need.",
    {
      chunk_id: z.string().min(1).max(200).optional().describe("Exact chunk ID from scrooge_search or scrooge_lookup"),
      symbol: z.string().min(1).max(200).optional().describe("Symbol name to fetch raw source for"),
      before: z.number().int().min(0).max(200).optional().describe("Extra lines of context before the chunk"),
      after: z.number().int().min(0).max(200).optional().describe("Extra lines of context after the chunk"),
      repo_path: z.string().max(500).optional().describe("Absolute path to the repository (defaults to cwd)"),
    },
    async ({ chunk_id, symbol, before, after, repo_path }) => {
      if (!chunk_id && !symbol) {
        throw new Error("Provide chunk_id or symbol");
      }

      const result = await source(
        { chunkId: chunk_id, symbol, before, after },
        { channel: "mcp", repoPath: repo_path, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
