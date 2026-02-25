import { createHash } from "node:crypto";
import { openDb } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { validateRepoPath } from "../utils/path-validation.js";
import { getDateFilter } from "./statistics.js";
import type { ApiContext, ExportParams, ExportRecord, ExportResponse } from "./types.js";

interface ToolCallRow {
  id: number;
  tool: string;
  repo_path: string;
  called_at: string;
  duration_ms: number;
  tokens_sent: number;
  tokens_raw: number;
  channel: string | null;
  model: string | null;
  metadata: string | null;
}

export async function exportData(
  params: ExportParams,
  ctx: ApiContext,
): Promise<ExportResponse> {
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);

  try {
    const period = params.period ?? "all";
    const dateFilter = getDateFilter(period);
    const sqlParams: unknown[] = [repoPath];
    let dateClause = "";
    if (dateFilter) {
      dateClause = "AND called_at >= ?";
      sqlParams.push(dateFilter);
    }

    let toolClause = "";
    if (params.tool) {
      toolClause = "AND tool = ?";
      sqlParams.push(params.tool);
    }

    let limitClause = "";
    if (params.limit && params.limit > 0) {
      limitClause = "LIMIT ?";
      sqlParams.push(params.limit);
    }

    const rows = db
      .prepare(
        `SELECT id, tool, repo_path, called_at, duration_ms, tokens_sent, tokens_raw, channel, model, metadata
         FROM tool_calls
         WHERE repo_path = ? ${dateClause} ${toolClause}
         ORDER BY called_at DESC ${limitClause}`,
      )
      .all(...sqlParams) as ToolCallRow[];

    const records: ExportRecord[] = rows.map((row) => {
      const meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};

      const record: ExportRecord = {
        id: row.id,
        tool: row.tool,
        repo: row.repo_path.split("/").pop() ?? row.repo_path,
        called_at: row.called_at,
        duration_ms: row.duration_ms,
        tokens_sent: row.tokens_sent,
        tokens_raw: row.tokens_raw,
        channel: row.channel ?? "mcp",
        model: row.model,
      };

      // Flatten relevant metadata fields
      if (meta.query !== undefined) record.query = meta.query;
      if (meta.resultCount !== undefined) record.result_count = meta.resultCount;
      if (meta.truncated !== undefined) record.truncated = meta.truncated;
      if (meta.sources !== undefined) record.sources = meta.sources;
      if (meta.timing !== undefined) record.timing = meta.timing;
      if (meta.retrieval !== undefined) record.retrieval = meta.retrieval;
      if (meta.packager !== undefined) record.packager = meta.packager;
      if (meta.topScores !== undefined) record.top_scores = meta.topScores;

      if (params.anonymize) {
        record.repo = createHash("sha256").update(row.repo_path).digest("hex").slice(0, 8);
        delete record.query;
        record.called_at = row.called_at.slice(0, 10); // date only
      }

      return record;
    });

    const format = params.format ?? "jsonl";
    return { records, format, count: records.length };
  } finally {
    db.close();
  }
}

export function formatAsJsonl(records: ExportRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

export function formatAsCsv(records: ExportRecord[]): string {
  if (records.length === 0) return "";

  const baseHeaders = [
    "id", "tool", "repo", "called_at", "duration_ms",
    "tokens_sent", "tokens_raw", "channel", "model",
  ];

  const lines: string[] = [baseHeaders.join(",")];

  for (const record of records) {
    const values = baseHeaders.map((h) => {
      const val = record[h];
      if (val === null || val === undefined) return "";
      if (typeof val === "string" && (val.includes(",") || val.includes('"'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return String(val);
    });
    lines.push(values.join(","));
  }

  return lines.join("\n");
}
