import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openDb, recordToolCall } from "../../storage/db.js";
import { getConfig } from "../../utils/config.js";
import { runPipeline } from "../../indexer/pipeline.js";
import { isGitRepo } from "../../utils/git.js";

export function registerReindexTool(server: McpServer): void {
  server.tool(
    "scrooge_reindex",
    "Trigger indexing of a repository. By default uses incremental mode (only re-indexes files changed since last index). Use incremental=false for a full re-index.",
    {
      repo_path: z.string().optional().describe("Absolute path to the repository (defaults to cwd)"),
      incremental: z.boolean().optional().describe("Incremental index via git diff (default true)"),
    },
    async ({ repo_path, incremental }) => {
      const startTime = Date.now();
      const repoPath = repo_path ?? process.cwd();
      const isIncremental = incremental !== false;

      if (!isGitRepo(repoPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Not a git repository", repo_path: repoPath }),
            },
          ],
        };
      }

      const config = getConfig();
      const db = openDb(config.dbPath);

      try {
        const stats = await runPipeline({
          repoPath,
          db,
          incremental: isIncremental,
          withEmbeddings: true,
        });

        recordToolCall(db, {
          tool: "reindex",
          repo_path: repoPath,
          duration_ms: Date.now() - startTime,
          tokens_sent: 0,
          tokens_raw: 0,
          metadata: { ...stats, incremental: isIncremental },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "success",
                  repo_path: repoPath,
                  ...stats,
                },
                null,
                2,
              ),
            },
          ],
        };
      } finally {
        db.close();
      }
    },
  );
}
