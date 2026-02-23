import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openDb, getIndexMeta } from "../../storage/db.js";
import { getConfig } from "../../utils/config.js";
import { isGitRepo, getHeadCommit } from "../../utils/git.js";

export function registerStatusTool(server: McpServer): void {
  server.tool(
    "scrooge_status",
    "Get information about the Scrooge index for a repository: last indexed commit, total chunks, freshness.",
    {
      repo_path: z.string().describe("Absolute path to the repository (defaults to cwd)").optional(),
    },
    async ({ repo_path }) => {
      const repoPath = repo_path ?? process.cwd();
      const config = getConfig();
      const db = openDb(config.dbPath);

      try {
        const meta = getIndexMeta(db, repoPath);

        if (!meta) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "not_indexed",
                    repo_path: repoPath,
                    message: "Repository has not been indexed yet. Run scrooge_reindex first.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        let freshness = "unknown";
        if (isGitRepo(repoPath)) {
          const currentCommit = getHeadCommit(repoPath);
          freshness = currentCommit === meta.last_commit_sha ? "up_to_date" : "stale";
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "indexed",
                  repo_path: repoPath,
                  last_commit_sha: meta.last_commit_sha,
                  last_indexed_at: meta.last_indexed_at,
                  total_chunks: meta.total_chunks,
                  total_files: meta.total_files,
                  freshness,
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
