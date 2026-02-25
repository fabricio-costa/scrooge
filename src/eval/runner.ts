import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../storage/db.js";
import { getConfig, type ScroogeConfig } from "../utils/config.js";
import { ensureFreshIndex } from "../utils/freshness.js";
import { hybridSearch } from "../retrieval/hybrid.js";
import { mrr, ndcgAtK, precisionAtK, recallAtK } from "./metrics.js";

export interface EvalQuery {
  query: string;
  repo: string;
  expected: string[];
  expected_symbols?: string[];
  tags?: string[];
}

export interface EvalConfig {
  queriesPath: string;
  configOverrides?: Partial<ScroogeConfig>;
  k: number;
}

export interface QueryResult {
  query: string;
  tags: string[];
  mrr: number;
  ndcg: number;
  precision: number;
  recall: number;
  topResults: string[];
  expected: string[];
}

export interface EvalResult {
  config: Partial<ScroogeConfig>;
  metrics: {
    mrr: number;
    ndcg: number;
    precision: number;
    recall: number;
  };
  perQuery: QueryResult[];
  timestamp: string;
}

function loadQueries(path: string): EvalQuery[] {
  const content = readFileSync(path, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as EvalQuery);
}

export async function runEval(evalConfig: EvalConfig): Promise<EvalResult> {
  const config = getConfig(evalConfig.configOverrides);
  const db = openDb(config.dbPath);
  const k = evalConfig.k;

  try {
    const queries = loadQueries(evalConfig.queriesPath);
    const perQuery: QueryResult[] = [];

    for (const q of queries) {
      const repoPath = resolve(q.repo);
      await ensureFreshIndex(db, repoPath);

      const { results } = await hybridSearch(
        db,
        repoPath,
        q.query,
        {},
        k * 2, // fetch more to have enough for @K
      );

      const rankedFiles = results.map((r) => r.chunk.path);
      const relevantSet = new Set(q.expected);

      perQuery.push({
        query: q.query,
        tags: q.tags ?? [],
        mrr: mrr(rankedFiles, relevantSet),
        ndcg: ndcgAtK(rankedFiles, q.expected, k),
        precision: precisionAtK(rankedFiles, relevantSet, k),
        recall: recallAtK(rankedFiles, relevantSet, k),
        topResults: rankedFiles.slice(0, k),
        expected: q.expected,
      });
    }

    const n = perQuery.length;
    const metrics = {
      mrr: n > 0 ? perQuery.reduce((s, q) => s + q.mrr, 0) / n : 0,
      ndcg: n > 0 ? perQuery.reduce((s, q) => s + q.ndcg, 0) / n : 0,
      precision: n > 0 ? perQuery.reduce((s, q) => s + q.precision, 0) / n : 0,
      recall: n > 0 ? perQuery.reduce((s, q) => s + q.recall, 0) / n : 0,
    };

    return {
      config: evalConfig.configOverrides ?? {},
      metrics,
      perQuery,
      timestamp: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

export function formatEvalReport(result: EvalResult, label?: string): string {
  const lines: string[] = [];
  const n = result.perQuery.length;

  lines.push(`Scrooge Eval — ${n} queries, k=5`);
  lines.push("─".repeat(40));
  lines.push("");

  if (label) {
    lines.push(`Config: ${label}`);
  } else {
    const configStr = Object.keys(result.config).length > 0
      ? JSON.stringify(result.config)
      : "default";
    lines.push(`Config: ${configStr}`);
  }

  lines.push(`  MRR:         ${result.metrics.mrr.toFixed(3)}`);
  lines.push(`  NDCG@5:      ${result.metrics.ndcg.toFixed(3)}`);
  lines.push(`  Precision@5: ${result.metrics.precision.toFixed(3)}`);
  lines.push(`  Recall@5:    ${result.metrics.recall.toFixed(3)}`);
  lines.push("");

  // Per-tag breakdown
  const tagMap = new Map<string, QueryResult[]>();
  for (const q of result.perQuery) {
    for (const tag of q.tags) {
      const arr = tagMap.get(tag) ?? [];
      arr.push(q);
      tagMap.set(tag, arr);
    }
  }

  if (tagMap.size > 0) {
    lines.push("Per-tag breakdown:");
    for (const [tag, queries] of [...tagMap.entries()].sort()) {
      const avgMrr = queries.reduce((s, q) => s + q.mrr, 0) / queries.length;
      const avgNdcg = queries.reduce((s, q) => s + q.ndcg, 0) / queries.length;
      lines.push(
        `  ${tag} (${queries.length}q): MRR=${avgMrr.toFixed(2)}  NDCG@5=${avgNdcg.toFixed(2)}`,
      );
    }
    lines.push("");
  }

  // Worst queries (MRR < 1)
  const worst = result.perQuery
    .filter((q) => q.mrr < 1)
    .sort((a, b) => a.mrr - b.mrr)
    .slice(0, 5);

  if (worst.length > 0) {
    lines.push("Worst queries:");
    for (const q of worst) {
      const got = q.topResults[0] ?? "(no results)";
      lines.push(
        `  "${q.query}" → MRR=${q.mrr.toFixed(2)} (expected: ${q.expected[0]}, got: ${got})`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatComparisonReport(results: EvalResult[], labels: string[]): string {
  const lines: string[] = [];
  const n = results[0]?.perQuery.length ?? 0;

  lines.push(`Scrooge Eval — Config Comparison (${n} queries)`);
  lines.push("─".repeat(50));
  lines.push("");

  // Header
  const colWidth = 12;
  const header = "".padEnd(16) + labels.map((l) => l.padStart(colWidth)).join("") + "   delta";
  lines.push(header);

  const metricNames: Array<{ key: keyof EvalResult["metrics"]; label: string }> = [
    { key: "mrr", label: "MRR:" },
    { key: "ndcg", label: "NDCG@5:" },
    { key: "precision", label: "Precision@5:" },
    { key: "recall", label: "Recall@5:" },
  ];

  for (const { key, label } of metricNames) {
    const values = results.map((r) => r.metrics[key]);
    const delta = values.length >= 2 ? values[1] - values[0] : 0;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3);
    const row = label.padEnd(16) + values.map((v) => v.toFixed(3).padStart(colWidth)).join("") + `   ${deltaStr}`;
    lines.push(row);
  }

  lines.push("");

  // Determine winner
  if (results.length >= 2) {
    const score0 = results[0].metrics.ndcg + results[0].metrics.mrr;
    const score1 = results[1].metrics.ndcg + results[1].metrics.mrr;
    const winner = score0 >= score1 ? labels[0] : labels[1];
    lines.push(`Winner: ${winner}`);
  }

  return lines.join("\n");
}
