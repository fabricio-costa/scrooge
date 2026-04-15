import { openDb } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { computeCoverage, readObserved } from "../utils/observed.js";
import { validateRepoPath } from "../utils/path-validation.js";
import type Database from "better-sqlite3";
import type {
  ApiContext,
  StatisticsChannelSummary,
  StatisticsCodeReadExtensionSummary,
  StatisticsCoverageSummary,
  StatisticsData,
  StatisticsGuidedReadSummary,
  StatisticsModelSummary,
  StatisticsParams,
  StatisticsPathCount,
  StatisticsPeriod,
  StatisticsReasonCount,
  StatisticsResponse,
  StatisticsSearchInsights,
  StatisticsSelectorCount,
  StatisticsToolCount,
  StatisticsToolSummary,
} from "./types.js";

type Period = StatisticsPeriod;

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

interface SearchInsightsRow {
  tokens_sent: number;
  metadata: string | null;
}

interface ModelAggregate {
  model: string;
  call_count: number;
  total_sent: number;
}

interface ChannelAggregate {
  channel: string;
  call_count: number;
}

export async function statistics(
  params: StatisticsParams,
  ctx: ApiContext,
): Promise<StatisticsResponse> {
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);

  try {
    const period = (params.period as Period) ?? "all";
    const data = buildStatisticsData(db, repoPath, period);
    return {
      format: params.format ?? "text",
      report: renderStatisticsReport(data),
      data,
    };
  } finally {
    db.close();
  }
}

export function buildStatisticsReport(
  db: Database.Database,
  repoPath: string,
  period: Period,
): string {
  return renderStatisticsReport(buildStatisticsData(db, repoPath, period));
}

export function buildStatisticsData(
  db: Database.Database,
  repoPath: string,
  period: Period,
): StatisticsData {
  const dateFilter = getDateFilter(period);
  const baseParams: unknown[] = [repoPath];
  const dateClause = dateFilter ? "AND called_at >= ?" : "";
  if (dateFilter) {
    baseParams.push(dateFilter);
  }

  const toolAggs = getToolAggregates(db, dateClause, baseParams);
  const totals = buildTotals(toolAggs);
  const usageByTool = toolAggs.map(mapToolAggregate);
  const coverage = getCoverageSummary(repoPath, dateFilter);
  const firstCallAt = getFirstCall(db, dateClause, baseParams);
  const repoName = repoPath.split("/").pop() ?? repoPath;
  const empty = usageByTool.length === 0 && coverage === null;

  return {
    repo: {
      path: repoPath,
      name: repoName,
    },
    period: {
      key: period,
      label: getPeriodLabel(period, firstCallAt),
      since: dateFilter,
      firstCallAt,
    },
    generatedAt: new Date().toISOString(),
    empty,
    ...(usageByTool.length === 0
      ? { message: "No Scrooge usage recorded yet for this repository." }
      : {}),
    totals,
    usageByTool,
    savingsByTool: usageByTool.filter((tool) => tool.tokensRaw > 0),
    channels: getChannelAggregates(db, dateClause, baseParams).map(mapChannelAggregate),
    models: getModelAggregates(db, dateClause, baseParams).map(mapModelAggregate),
    searchInsights: getSearchInsights(db, dateClause, baseParams),
    coverage,
  };
}

function renderStatisticsReport(data: StatisticsData): string {
  if (data.empty) {
    return data.message ?? "No Scrooge usage recorded yet for this repository.";
  }

  const lines: string[] = [];
  lines.push(`## Scrooge Statistics — ${data.repo.name}`);
  lines.push(`Period: ${data.period.label}`);
  lines.push("");

  lines.push("### Token Savings");
  lines.push(`Tokens delivered: ${data.totals.tokensDelivered.toLocaleString("en-US")}`);
  lines.push(`Raw equivalent:  ${data.totals.rawEquivalent.toLocaleString("en-US")}`);
  lines.push(
    `Saved:           ${data.totals.tokensSaved.toLocaleString("en-US")} (${data.totals.savingsPct.toFixed(1)}%)`,
  );
  lines.push("");

  if (data.savingsByTool.length > 0) {
    lines.push("### Savings by Tool");
    for (const tool of data.savingsByTool) {
      lines.push(
        `${tool.tool}: ${tool.tokensSent.toLocaleString("en-US")} delivered / ${tool.tokensRaw.toLocaleString("en-US")} raw (${(tool.savingsPct ?? 0).toFixed(1)}% saved)`,
      );
    }
    lines.push("");
  }

  lines.push(`### Usage (${data.totals.totalCalls} total calls)`);
  if (data.usageByTool.length > 0) {
    lines.push(data.usageByTool.map((tool) => `${tool.tool}: ${tool.callCount}`).join(" | "));
  } else {
    lines.push("No Scrooge tool calls recorded yet.");
  }
  lines.push("");

  if (data.channels.length > 1) {
    lines.push("### Channels");
    lines.push(data.channels.map((channel) => `${channel.channel}: ${channel.callCount}`).join(" | "));
    lines.push("");
  }

  if (data.models.some((model) => model.model !== "unknown")) {
    lines.push("### Models");
    lines.push(
      data.models
        .map((model) => `${model.model}: ${model.callCount} calls (${model.tokensSent.toLocaleString("en-US")} tokens)`)
        .join("\n"),
    );
    lines.push("");
  }

  if (data.searchInsights) {
    lines.push("### Search Insights");
    lines.push(
      `Avg results/query: ${data.searchInsights.avgResults.toFixed(1)} | Avg tokens/query: ${data.searchInsights.avgTokens.toLocaleString("en-US")}`,
    );
    lines.push(
      `Sources: lexical ${data.searchInsights.sourceMixPct.lexical}% | vector ${data.searchInsights.sourceMixPct.vector}% | both ${data.searchInsights.sourceMixPct.both}%`,
    );
    lines.push("");
  }

  if (data.coverage) {
    lines.push("### Agent Coverage");
    lines.push(renderCoverageSection(data.coverage));
    lines.push("");
  }

  return lines.join("\n");
}

function renderCoverageSection(coverage: StatisticsCoverageSummary): string {
  const lines: string[] = [];

  if (coverage.scroogeExplorationTotal > 0) {
    const parts = coverage.scroogeExplorationByTool.map((entry) => `${entry.tool}: ${entry.count}`);
    lines.push(`Scrooge exploration: ${coverage.scroogeExplorationTotal} calls (${parts.join(", ")})`);
  } else {
    lines.push("Scrooge exploration: 0 calls");
  }

  if (coverage.nativeExplorationTotal > 0) {
    const parts = coverage.nativeExplorationByTool.map((entry) => `${entry.tool}: ${entry.count}`);
    lines.push(`Native exploration:  ${coverage.nativeExplorationTotal} calls (${parts.join(", ")})`);
  } else {
    lines.push("Native exploration:  0 calls");
  }

  if (coverage.codeReads.total > 0) {
    lines.push(
      `Code reads:          ${coverage.codeReads.total} (${coverage.codeReads.guided} guided, ${coverage.codeReads.blind} blind)`,
    );
    lines.push(`Blind read rate:     ${coverage.codeReads.blindRatePct.toFixed(1)}% of code reads skipped Scrooge`);

    if (coverage.codeReads.byExtension.length > 0) {
      lines.push(
        `Code read mix:       ${formatTopItems(
          coverage.codeReads.byExtension,
          (entry) => `${entry.extension}: ${entry.total} (${entry.blind} blind, ${entry.blindRatePct.toFixed(1)}% blind)`,
        )}`,
      );
    }

    if (coverage.codeReads.blindHotspots.length > 0) {
      lines.push(
        `Blind hotspots:      ${formatTopItems(
          coverage.codeReads.blindHotspots,
          (entry) => `${entry.path}: ${entry.count}`,
        )}`,
      );
    }

    if (coverage.codeReads.guidedBy.length > 0) {
      lines.push(
        `Read bounce:         ${coverage.codeReads.guidedBy
          .map((entry) => {
            const pct = entry.bouncePct !== null ? ` (${entry.bouncePct.toFixed(1)}% of ${entry.tool})` : "";
            return `${entry.tool}→Read ${entry.count}${pct}`;
          })
          .join(" | ")}`,
      );
    }
  }

  if (coverage.grepBypasses.length > 0) {
    lines.push(`Grep bypasses:       ${formatTopItems(coverage.grepBypasses, (entry) => `${entry.selector}: ${entry.count}`)}`);
  }

  if (coverage.globBypasses.length > 0) {
    lines.push(`Glob bypasses:       ${formatTopItems(coverage.globBypasses, (entry) => `${entry.selector}: ${entry.count}`)}`);
  }

  if (coverage.bypassReasons.length > 0) {
    lines.push(`Bypass reasons:      ${formatTopItems(coverage.bypassReasons, (entry) => `${entry.reasonCode}: ${entry.count}`)}`);
  }

  if (coverage.otherCalls.length > 0) {
    const otherTotal = coverage.otherCalls.reduce((sum, entry) => sum + entry.count, 0);
    lines.push(
      `Other agent calls:   ${otherTotal} (${coverage.otherCalls.map((entry) => `${entry.tool}: ${entry.count}`).join(", ")})`,
    );
  }

  if (coverage.totalExploration > 0) {
    lines.push("─────────────────");
    lines.push(
      `Coverage: ${coverage.coveragePct.toFixed(1)}% of exploration calls used Scrooge (${coverage.scroogeExplorationTotal} of ${coverage.totalExploration})`,
    );
  }

  return lines.join("\n");
}

function formatTopItems<T>(items: T[], format: (item: T) => string, limit: number = 5): string {
  return items.slice(0, limit).map(format).join(" | ");
}

function buildTotals(toolAggs: ToolAggregate[]) {
  const tokensDelivered = toolAggs.reduce((sum, tool) => sum + tool.total_tokens_sent, 0);
  const rawEquivalent = toolAggs.reduce((sum, tool) => sum + tool.total_tokens_raw, 0);
  const tokensSaved = rawEquivalent - tokensDelivered;
  const savingsPct = rawEquivalent > 0 ? roundTo1((tokensSaved / rawEquivalent) * 100) : 0;

  return {
    totalCalls: toolAggs.reduce((sum, tool) => sum + tool.call_count, 0),
    tokensDelivered,
    rawEquivalent,
    tokensSaved,
    savingsPct,
  };
}

function mapToolAggregate(tool: ToolAggregate): StatisticsToolSummary {
  const tokensSaved = tool.total_tokens_raw - tool.total_tokens_sent;
  return {
    tool: tool.tool,
    callCount: tool.call_count,
    tokensSent: tool.total_tokens_sent,
    tokensRaw: tool.total_tokens_raw,
    tokensSaved,
    savingsPct: tool.total_tokens_raw > 0 ? roundTo1((tokensSaved / tool.total_tokens_raw) * 100) : null,
  };
}

function mapModelAggregate(model: ModelAggregate): StatisticsModelSummary {
  return {
    model: model.model,
    callCount: model.call_count,
    tokensSent: model.total_sent,
  };
}

function mapChannelAggregate(channel: ChannelAggregate): StatisticsChannelSummary {
  return {
    channel: channel.channel,
    callCount: channel.call_count,
  };
}

function getToolAggregates(
  db: Database.Database,
  dateClause: string,
  params: unknown[],
): ToolAggregate[] {
  return db
    .prepare(
      `SELECT tool, COUNT(*) as call_count,
              COALESCE(SUM(tokens_sent), 0) as total_tokens_sent,
              COALESCE(SUM(tokens_raw), 0) as total_tokens_raw
       FROM tool_calls
       WHERE repo_path = ? ${dateClause}
       GROUP BY tool
       ORDER BY call_count DESC, tool ASC`,
    )
    .all(...params) as ToolAggregate[];
}

function getFirstCall(
  db: Database.Database,
  dateClause: string,
  params: unknown[],
): string | null {
  const earliest = db
    .prepare(`SELECT MIN(called_at) as first_call FROM tool_calls WHERE repo_path = ? ${dateClause}`)
    .get(...params) as { first_call: string | null };
  return earliest.first_call;
}

export function getDateFilter(period: Period): string | null {
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

function getSearchInsights(
  db: Database.Database,
  dateClause: string,
  baseParams: unknown[],
): StatisticsSearchInsights | null {
  const searchParams: unknown[] = [baseParams[0], "search"];
  if (baseParams.length > 1) {
    searchParams.push(baseParams[1]);
  }

  const searchCalls = db
    .prepare(
      `SELECT tokens_sent, metadata FROM tool_calls
       WHERE repo_path = ? AND tool = ? ${dateClause}`,
    )
    .all(...searchParams) as SearchInsightsRow[];

  if (searchCalls.length === 0) return null;

  let totalResults = 0;
  let totalTokens = 0;
  let lexical = 0;
  let vector = 0;
  let both = 0;

  for (const call of searchCalls) {
    totalTokens += call.tokens_sent;
    if (!call.metadata) continue;

    try {
      const meta = JSON.parse(call.metadata) as SearchMeta;
      totalResults += meta.resultCount ?? 0;
      if (meta.sources) {
        lexical += meta.sources.lexical;
        vector += meta.sources.vector;
        both += meta.sources.both;
      }
    } catch {
      // Ignore malformed metadata rows from older/manual inserts.
    }
  }

  const totalSources = lexical + vector + both;
  return {
    callCount: searchCalls.length,
    avgResults: roundTo1(totalResults / searchCalls.length),
    avgTokens: Math.round(totalTokens / searchCalls.length),
    sourceCounts: { lexical, vector, both },
    sourceMixPct: {
      lexical: totalSources > 0 ? Math.round((lexical / totalSources) * 100) : 0,
      vector: totalSources > 0 ? Math.round((vector / totalSources) * 100) : 0,
      both: totalSources > 0 ? Math.round((both / totalSources) * 100) : 0,
    },
  };
}

function getModelAggregates(
  db: Database.Database,
  dateClause: string,
  baseParams: unknown[],
): ModelAggregate[] {
  try {
    return db
      .prepare(
        `SELECT COALESCE(model, 'unknown') as model, COUNT(*) as call_count,
                COALESCE(SUM(tokens_sent), 0) as total_sent
         FROM tool_calls
         WHERE repo_path = ? ${dateClause}
         GROUP BY model
         ORDER BY call_count DESC, model ASC`,
      )
      .all(...baseParams) as ModelAggregate[];
  } catch {
    // model column may not exist yet (pre-v4 schema)
    return [];
  }
}

function getChannelAggregates(
  db: Database.Database,
  dateClause: string,
  baseParams: unknown[],
): ChannelAggregate[] {
  try {
    return db
      .prepare(
        `SELECT COALESCE(channel, 'mcp') as channel, COUNT(*) as call_count
         FROM tool_calls
         WHERE repo_path = ? ${dateClause}
         GROUP BY channel
         ORDER BY call_count DESC, channel ASC`,
      )
      .all(...baseParams) as ChannelAggregate[];
  } catch {
    // channel column may not exist yet (pre-v3 schema)
    return [];
  }
}

function getCoverageSummary(repoPath: string, since?: string | null): StatisticsCoverageSummary | null {
  const records = readObserved(repoPath, since);
  if (records.length === 0) return null;

  const coverage = computeCoverage(records);
  const scroogeExplorationTotal = sumCounts(coverage.scroogeExploration);
  const nativeExplorationTotal = sumCounts(coverage.nativeExploration);
  const otherTotal = sumCounts(coverage.other);

  if (scroogeExplorationTotal + nativeExplorationTotal === 0 && otherTotal === 0) {
    return null;
  }

  return {
    scroogeExplorationTotal,
    nativeExplorationTotal,
    totalExploration: coverage.totalExploration,
    coveragePct: roundTo1(coverage.coveragePct),
    scroogeExplorationByTool: toToolCounts(coverage.scroogeExploration),
    nativeExplorationByTool: toToolCounts(coverage.nativeExploration),
    codeReads: {
      total: coverage.codeReads,
      guided: coverage.guidedCodeReads,
      blind: coverage.blindCodeReads,
      blindRatePct: coverage.codeReads > 0 ? roundTo1((coverage.blindCodeReads / coverage.codeReads) * 100) : 0,
      byExtension: toCodeReadExtensions(coverage.codeReadByExtension),
      guidedBy: toGuidedReadSummaries(coverage.guidedReadBy, coverage.scroogeExploration),
      blindHotspots: toPathCounts(coverage.blindReadPaths),
    },
    grepBypasses: toSelectorCounts(coverage.grepSelectors),
    globBypasses: toSelectorCounts(coverage.globSelectors),
    bypassReasons: toReasonCounts(coverage.nativeReasonCodes),
    otherCalls: toToolCounts(coverage.other),
  };
}

function toToolCounts(map: Map<string, number>): StatisticsToolCount[] {
  return sortCountEntries(map).map(([tool, count]) => ({ tool, count }));
}

function toPathCounts(map: Map<string, number>): StatisticsPathCount[] {
  return sortCountEntries(map).map(([path, count]) => ({ path, count }));
}

function toSelectorCounts(map: Map<string, number>): StatisticsSelectorCount[] {
  return sortCountEntries(map).map(([selector, count]) => ({ selector, count }));
}

function toReasonCounts(map: Map<string, number>): StatisticsReasonCount[] {
  return sortCountEntries(map).map(([reasonCode, count]) => ({ reasonCode, count }));
}

function toGuidedReadSummaries(
  guidedReadBy: Map<string, number>,
  scroogeExploration: Map<string, number>,
): StatisticsGuidedReadSummary[] {
  return sortCountEntries(guidedReadBy).map(([tool, count]) => {
    const base = scroogeExploration.get(tool) ?? 0;
    return {
      tool,
      count,
      bouncePct: base > 0 ? roundTo1((count / base) * 100) : null,
    };
  });
}

function toCodeReadExtensions(
  map: Map<string, { total: number; guided: number; blind: number }>,
): StatisticsCodeReadExtensionSummary[] {
  return [...map.entries()]
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .map(([extension, stats]) => ({
      extension,
      total: stats.total,
      guided: stats.guided,
      blind: stats.blind,
      blindRatePct: stats.total > 0 ? roundTo1((stats.blind / stats.total) * 100) : 0,
    }));
}

function sortCountEntries(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function sumCounts(map: Map<string, number>): number {
  return [...map.values()].reduce((sum, count) => sum + count, 0);
}

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}
