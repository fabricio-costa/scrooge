import { openDb, recordToolCall } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { generateTree, renderTree } from "../repomap/tree.js";
import { getModuleSummaries, getFileSummaries } from "../repomap/summaries.js";
import { estimateTokens } from "../utils/tokens.js";
import { ensureFreshIndex, formatReindexNote } from "../utils/freshness.js";
import { validateRepoPath } from "../utils/path-validation.js";
import type { ApiContext, MapParams, MapResponse } from "./types.js";

export async function map(
  params: MapParams,
  ctx: ApiContext,
): Promise<MapResponse> {
  const startTime = Date.now();
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);

  try {
    const freshness = await ensureFreshIndex(db, repoPath);

    const detailLevel = params.level ?? "repo";
    const output: string[] = [];

    if (detailLevel === "repo") {
      const tree = generateTree(db, repoPath, params.module);
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
      const tree = generateTree(db, repoPath, params.module);
      output.push("## Directory Tree\n```");
      output.push(renderTree(tree, params.module ? undefined : { maxDepth: 3 }));
      output.push("```\n");

      const files = getFileSummaries(db, repoPath, params.module);
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

    const reindexNote = formatReindexNote(freshness);
    if (reindexNote) {
      output.unshift(`> ${reindexNote}\n`);
    }

    const outputText = output.join("\n");
    const tokensSent = estimateTokens(outputText);

    // Compute raw tokens: sum of text_raw for all chunks in scope
    const moduleFilter = params.module ? "AND module = ?" : "";
    const queryParams: unknown[] = [repoPath];
    if (params.module) queryParams.push(params.module);
    const rawRow = db
      .prepare(`SELECT COALESCE(SUM(LENGTH(text_raw)), 0) as total_len FROM chunks WHERE repo_path = ? ${moduleFilter}`)
      .get(...queryParams) as { total_len: number };
    const tokensRaw = Math.ceil(rawRow.total_len / 4);

    recordToolCall(db, {
      tool: "map",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: tokensSent,
      tokens_raw: tokensRaw,
      channel: ctx.channel,
      metadata: { level: detailLevel, module: params.module ?? null, autoReindexed: freshness.reindexed },
    });

    return { content: outputText };
  } finally {
    db.close();
  }
}
