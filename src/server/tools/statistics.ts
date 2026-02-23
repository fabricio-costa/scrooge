import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openDb } from "../../storage/db.js";
import { getConfig } from "../../utils/config.js";
import type Database from "better-sqlite3";

type Period = "today" | "week" | "month" | "all";

interface ToolAggregate {
  tool: string;
  call_count: number;
  total_tokens_sent: number;
  total_tokens_raw: number;
}

interface SearchMeta {
  resultCount?: number;
  sources?: { lexical: number; vector: number; both: number };
}

export function registerStatisticsTool(server: McpServer): void {
  server.tool(
    "scrooge_statistics",
    "Usage and token savings metrics for Scrooge. Shows how much Scrooge saves over time by comparing compressed responses to raw content costs.",
    {
      repo_path: z.string().optional().describe("Absolute path to the repository (defaults to cwd)"),
      period: z
        .enum(["today", "week", "month", "all"])
        .optional()
        .describe('Time period to aggregate: "today", "week", "month", "all" (default "all")'),
    },
    async ({ repo_path, period }) => {
      const repoPath = repo_path ?? process.cwd();
      const config = getConfig();
      const db = openDb(config.dbPath);

      try {
        const output = buildStatisticsReport(db, repoPath, (period as Period) ?? "all");
        return {
          content: [{ type: "text" as const, text: output }],
        };
      } finally {
        db.close();
      }
    },
  );
}

export function buildStatisticsReport(
  db: Database.Database,
  repoPath: string,
  period: Period,
): string {
  const dateFilter = getDateFilter(period);
  const dateClause = dateFilter ? `AND called_at >= '${dateFilter}'` : "";

  // Aggregate by tool
  const toolAggs = db
    .prepare(
      `SELECT tool, COUNT(*) as call_count,
              COALESCE(SUM(tokens_sent), 0) as total_tokens_sent,
              COALESCE(SUM(tokens_raw), 0) as total_tokens_raw
       FROM tool_calls
       WHERE repo_path = ? ${dateClause}
       GROUP BY tool
       ORDER BY call_count DESC`,
    )
    .all(repoPath) as ToolAggregate[];

  if (toolAggs.length === 0) {
    return "No Scrooge usage recorded yet for this repository.";
  }

  const totalCalls = toolAggs.reduce((s, t) => s + t.call_count, 0);
  const totalSent = toolAggs.reduce((s, t) => s + t.total_tokens_sent, 0);
  const totalRaw = toolAggs.reduce((s, t) => s + t.total_tokens_raw, 0);
  const saved = totalRaw - totalSent;
  const savingsPct = totalRaw > 0 ? ((saved / totalRaw) * 100).toFixed(1) : "0.0";

  // Earliest call date
  const earliest = db
    .prepare(
      `SELECT MIN(called_at) as first_call FROM tool_calls WHERE repo_path = ? ${dateClause}`,
    )
    .get(repoPath) as { first_call: string | null };

  const repoName = repoPath.split("/").pop() ?? repoPath;
  const periodLabel = getPeriodLabel(period, earliest.first_call);

  const lines: string[] = [];
  lines.push(`## Scrooge Statistics — ${repoName}`);
  lines.push(`Period: ${periodLabel}`);
  lines.push("");

  // Token Savings
  lines.push("### Token Savings");
  lines.push(`Tokens delivered: ${totalSent.toLocaleString()}`);
  lines.push(`Raw equivalent:  ${totalRaw.toLocaleString()}`);
  lines.push(`Saved:           ${saved.toLocaleString()} (${savingsPct}%)`);
  lines.push("");

  // Usage breakdown
  const usageParts = toolAggs.map((t) => `${t.tool}: ${t.call_count}`);
  lines.push(`### Usage (${totalCalls} total calls)`);
  lines.push(usageParts.join(" | "));
  lines.push("");

  // Search insights (if any search calls)
  const searchInsights = getSearchInsights(db, repoPath, dateClause);
  if (searchInsights) {
    lines.push("### Search Insights");
    lines.push(
      `Avg results/query: ${searchInsights.avgResults} | Avg tokens/query: ${searchInsights.avgTokens}`,
    );
    lines.push(
      `Sources: lexical ${searchInsights.lexicalPct}% | vector ${searchInsights.vectorPct}% | both ${searchInsights.bothPct}%`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

function getDateFilter(period: Period): string | null {
  if (period === "all") return null;
  const now = new Date();
  switch (period) {
    case "today":
      return now.toISOString().slice(0, 10);
    case "week": {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return weekAgo.toISOString().slice(0, 19).replace("T", " ");
    }
    case "month": {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return monthAgo.toISOString().slice(0, 19).replace("T", " ");
    }
  }
}

function getPeriodLabel(period: Period, firstCall: string | null): string {
  if (period === "all" && firstCall) {
    const date = firstCall.slice(0, 10);
    return `all time (since ${date})`;
  }
  const labels: Record<Period, string> = {
    today: "today",
    week: "last 7 days",
    month: "last 30 days",
    all: "all time",
  };
  return labels[period];
}

interface SearchInsightsResult {
  avgResults: string;
  avgTokens: string;
  lexicalPct: string;
  vectorPct: string;
  bothPct: string;
}

function getSearchInsights(
  db: Database.Database,
  repoPath: string,
  dateClause: string,
): SearchInsightsResult | null {
  const searchCalls = db
    .prepare(
      `SELECT tokens_sent, metadata FROM tool_calls
       WHERE repo_path = ? AND tool = 'search' ${dateClause}`,
    )
    .all(repoPath) as Array<{ tokens_sent: number; metadata: string | null }>;

  if (searchCalls.length === 0) return null;

  let totalResults = 0;
  let totalTokens = 0;
  let lexical = 0;
  let vector = 0;
  let both = 0;

  for (const call of searchCalls) {
    totalTokens += call.tokens_sent;
    if (call.metadata) {
      const meta = JSON.parse(call.metadata) as SearchMeta;
      totalResults += meta.resultCount ?? 0;
      if (meta.sources) {
        lexical += meta.sources.lexical;
        vector += meta.sources.vector;
        both += meta.sources.both;
      }
    }
  }

  const totalSources = lexical + vector + both;
  const avgResults = (totalResults / searchCalls.length).toFixed(1);
  const avgTokens = Math.round(totalTokens / searchCalls.length).toLocaleString();

  return {
    avgResults,
    avgTokens,
    lexicalPct: totalSources > 0 ? Math.round((lexical / totalSources) * 100).toString() : "0",
    vectorPct: totalSources > 0 ? Math.round((vector / totalSources) * 100).toString() : "0",
    bothPct: totalSources > 0 ? Math.round((both / totalSources) * 100).toString() : "0",
  };
}
