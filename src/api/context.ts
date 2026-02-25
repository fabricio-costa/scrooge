import type Database from "better-sqlite3";
import { openDb, recordToolCall, type ChunkRow } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { estimateTokens } from "../utils/tokens.js";
import { ensureFreshIndex, formatReindexNote } from "../utils/freshness.js";
import { validateRepoPath } from "../utils/path-validation.js";
import type { ApiContext, ContextParams, ContextResponse } from "./types.js";

const MAX_EXAMPLES = 3;
const MAX_SKETCH_TOKENS = 500;
const TOP_N = 5;
const TOP_IMPORTS = 10;
const QUERY_LIMIT = 20;

function countFrequency(items: string[]): Array<[string, number]> {
  const freq = new Map<string, number>();
  for (const item of items) {
    freq.set(item, (freq.get(item) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]);
}

function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Core context aggregation logic, testable with an in-memory DB.
 * Similar to buildStatisticsReport — takes a db + repoPath directly.
 */
export function buildContext(
  db: Database.Database,
  repoPath: string,
  params: ContextParams,
): ContextResponse {
  const whereClause = params.module
    ? "WHERE repo_path = ? AND kind = ? AND module = ?"
    : "WHERE repo_path = ? AND kind = ?";
  const queryParams = params.module
    ? [repoPath, params.kind, params.module]
    : [repoPath, params.kind];

  const chunks = db
    .prepare(`
      SELECT annotations, tags, uses, text_sketch, path, symbol_name, text_raw
      FROM chunks ${whereClause}
      ORDER BY created_at DESC LIMIT ${QUERY_LIMIT}
    `)
    .all(...queryParams) as Array<
      Pick<ChunkRow, "annotations" | "tags" | "uses" | "text_sketch" | "path" | "symbol_name" | "text_raw">
    >;

  const allAnnotations: string[] = [];
  const allTags: string[] = [];
  const allUses: string[] = [];

  for (const chunk of chunks) {
    allAnnotations.push(...parseJsonArray(chunk.annotations));
    allTags.push(...parseJsonArray(chunk.tags));
    allUses.push(...parseJsonArray(chunk.uses));
  }

  const commonAnnotations = countFrequency(allAnnotations)
    .slice(0, TOP_N)
    .map(([name]) => name);
  const commonTags = countFrequency(allTags)
    .slice(0, TOP_N)
    .map(([name]) => name);
  const commonImports = countFrequency(allUses)
    .slice(0, TOP_IMPORTS)
    .map(([name]) => name);

  const exampleSketches: Array<{ path: string; sketch: string }> = [];
  let sketchTokens = 0;
  for (const chunk of chunks) {
    if (exampleSketches.length >= MAX_EXAMPLES) break;
    const tokens = estimateTokens(chunk.text_sketch);
    if (sketchTokens + tokens > MAX_SKETCH_TOKENS) continue;
    exampleSketches.push({ path: chunk.path, sketch: chunk.text_sketch });
    sketchTokens += tokens;
  }

  return {
    kind: params.kind,
    sampleCount: chunks.length,
    commonAnnotations,
    commonTags,
    commonImports,
    exampleSketches,
  };
}

export async function context(
  params: ContextParams,
  ctx: ApiContext,
): Promise<ContextResponse> {
  const startTime = Date.now();
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);

  try {
    const freshness = await ensureFreshIndex(db, repoPath);
    const result = buildContext(db, repoPath, params);
    const reindexNote = formatReindexNote(freshness);

    const resultWithNote: ContextResponse & { _note?: string } = {
      ...result,
      ...(reindexNote ? { _note: reindexNote } : {}),
    };

    const responseText = JSON.stringify(resultWithNote, null, 2);

    // Calculate raw tokens from the chunks that were queried
    const whereClause = params.module
      ? "WHERE repo_path = ? AND kind = ? AND module = ?"
      : "WHERE repo_path = ? AND kind = ?";
    const queryParams = params.module
      ? [repoPath, params.kind, params.module]
      : [repoPath, params.kind];
    const rawChunks = db
      .prepare(`SELECT text_raw FROM chunks ${whereClause} ORDER BY created_at DESC LIMIT ${QUERY_LIMIT}`)
      .all(...queryParams) as Array<Pick<ChunkRow, "text_raw">>;
    const tokensRaw = rawChunks.reduce((sum, c) => sum + estimateTokens(c.text_raw), 0);

    recordToolCall(db, {
      tool: "context",
      repo_path: repoPath,
      duration_ms: Date.now() - startTime,
      tokens_sent: estimateTokens(responseText),
      tokens_raw: tokensRaw,
      channel: ctx.channel,
      model: ctx.model,
      metadata: {
        kind: params.kind,
        module: params.module ?? null,
        sampleCount: result.sampleCount,
        autoReindexed: freshness.reindexed,
      },
    });

    return resultWithNote;
  } finally {
    db.close();
  }
}
