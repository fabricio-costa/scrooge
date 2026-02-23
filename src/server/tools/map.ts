import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openDb, recordToolCall } from "../../storage/db.js";
import { getConfig } from "../../utils/config.js";
import { generateTree, renderTree } from "../../repomap/tree.js";
import { getModuleSummaries, getFileSummaries } from "../../repomap/summaries.js";
import { estimateTokens } from "../../utils/tokens.js";

export function registerMapTool(server: McpServer): void {
  server.tool(
    "scrooge_map",
    "Get a repository map: directory tree and hierarchical summaries. Use 'repo' level for overview, 'modules' for module details, 'files' for per-file symbols (use with module filter for large repos).",
    {
      repo_path: z.string().optional().describe("Absolute path to the repository (defaults to cwd)"),
      level: z.enum(["repo", "modules", "files"]).optional().describe("Detail level: repo (compact tree + modules), modules (module summaries only), files (per-file symbols)"),
      module: z.string().optional().describe("Focus on a specific module (e.g., ':app', ':core:common')"),
    },
    async ({ repo_path, level, module }) => {
      const startTime = Date.now();
      const repoPath = repo_path ?? process.cwd();
      const config = getConfig();
      const db = openDb(config.dbPath);

      try {
        const detailLevel = level ?? "repo";
        const output: string[] = [];

        if (detailLevel === "repo") {
          const tree = generateTree(db, repoPath, module);
          output.push("## Directory Tree\n```");
          output.push(renderTree(tree, { maxDepth: 3 }));
          output.push("```\n");

          const modules = getModuleSummaries(db, repoPath);
          if (modules.length > 0) {
            output.push("## Modules\n");
            for (const m of modules) {
              output.push(`### ${m.module}`);
              output.push(`Files: ${m.fileCount} | Chunks: ${m.chunkCount}`);
              output.push(`Languages: ${Object.entries(m.languages).map(([l, c]) => `${l}(${c})`).join(", ")}`);
              if (m.topSymbols.length > 0) {
                output.push(`Key types: ${m.topSymbols.join(", ")}`);
              }
              output.push("");
            }
          }
        } else if (detailLevel === "modules") {
          const modules = getModuleSummaries(db, repoPath);
          if (modules.length > 0) {
            output.push("## Modules\n");
            for (const m of modules) {
              output.push(`### ${m.module}`);
              output.push(`Files: ${m.fileCount} | Chunks: ${m.chunkCount}`);
              output.push(`Languages: ${Object.entries(m.languages).map(([l, c]) => `${l}(${c})`).join(", ")}`);
              if (m.topSymbols.length > 0) {
                output.push(`Key types: ${m.topSymbols.join(", ")}`);
              }
              output.push("");
            }
          } else {
            output.push("No modules detected. Files may not follow the `<module>/src/` convention.");
          }
        } else if (detailLevel === "files") {
          const tree = generateTree(db, repoPath, module);
          output.push("## Directory Tree\n```");
          output.push(renderTree(tree, module ? undefined : { maxDepth: 3 }));
          output.push("```\n");

          const files = getFileSummaries(db, repoPath, module);
          output.push("## Files\n");
          for (const f of files) {
            output.push(`### ${f.path} (${f.language})`);
            for (const s of f.symbols) {
              const sig = s.signature ? `: ${s.signature}` : "";
              output.push(`  - [${s.kind}] ${s.name}${sig}`);
            }
            output.push("");
          }
        }

        const outputText = output.join("\n");
        const tokensSent = estimateTokens(outputText);

        // Compute raw tokens: sum of text_raw for all chunks in scope
        const moduleFilter = module ? "AND module = ?" : "";
        const params: unknown[] = [repoPath];
        if (module) params.push(module);
        const rawRow = db
          .prepare(`SELECT COALESCE(SUM(LENGTH(text_raw)), 0) as total_len FROM chunks WHERE repo_path = ? ${moduleFilter}`)
          .get(...params) as { total_len: number };
        const tokensRaw = Math.ceil(rawRow.total_len / 4);

        recordToolCall(db, {
          tool: "map",
          repo_path: repoPath,
          duration_ms: Date.now() - startTime,
          tokens_sent: tokensSent,
          tokens_raw: tokensRaw,
          metadata: { level: detailLevel, module: module ?? null },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: outputText,
            },
          ],
        };
      } finally {
        db.close();
      }
    },
  );
}
