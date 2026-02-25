import { describe, it, expect } from "vitest";
import { formatEvalReport, formatComparisonReport } from "../src/eval/runner.js";
import type { EvalResult, QueryResult } from "../src/eval/runner.js";

function makeQueryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    query: "login flow",
    tags: [],
    mrr: 1.0,
    ndcg: 0.9,
    precision: 0.8,
    recall: 0.7,
    topResults: ["auth/LoginViewModel.kt"],
    expected: ["auth/LoginViewModel.kt"],
    ...overrides,
  };
}

function makeEvalResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    config: {},
    metrics: { mrr: 0.85, ndcg: 0.78, precision: 0.72, recall: 0.65 },
    perQuery: [makeQueryResult()],
    timestamp: "2026-02-25T10:00:00Z",
    ...overrides,
  };
}

describe("formatEvalReport", () => {
  it("formats metrics with per-tag breakdown", () => {
    const result = makeEvalResult({
      perQuery: [
        makeQueryResult({ query: "login auth", tags: ["auth"], mrr: 1.0, ndcg: 0.9 }),
        makeQueryResult({ query: "signup auth", tags: ["auth"], mrr: 0.8, ndcg: 0.7 }),
        makeQueryResult({ query: "find items", tags: ["search"], mrr: 0.5, ndcg: 0.6 }),
      ],
    });

    const report = formatEvalReport(result);

    expect(report).toContain("Scrooge Eval — 3 queries, k=5");
    expect(report).toContain("MRR:");
    expect(report).toContain("NDCG@5:");
    expect(report).toContain("Precision@5:");
    expect(report).toContain("Recall@5:");
    expect(report).toContain("Per-tag breakdown:");
    expect(report).toContain("auth (2q):");
    expect(report).toContain("search (1q):");
  });

  it("shows worst queries section", () => {
    const result = makeEvalResult({
      perQuery: [
        makeQueryResult({ query: "perfect match", mrr: 1.0 }),
        makeQueryResult({
          query: "bad match",
          mrr: 0.2,
          topResults: ["wrong/File.kt"],
          expected: ["correct/File.kt"],
        }),
        makeQueryResult({
          query: "worse match",
          mrr: 0.0,
          topResults: [],
          expected: ["missing/File.kt"],
        }),
      ],
    });

    const report = formatEvalReport(result);

    expect(report).toContain("Worst queries:");
    // Sorted by MRR ascending: "worse match" (0.0) appears before "bad match" (0.2)
    const worstIdx = report.indexOf('"worse match"');
    const badIdx = report.indexOf('"bad match"');
    expect(worstIdx).toBeGreaterThan(-1);
    expect(badIdx).toBeGreaterThan(-1);
    expect(worstIdx).toBeLessThan(badIdx);
  });

  it("handles empty results", () => {
    const result = makeEvalResult({
      perQuery: [],
      metrics: { mrr: 0, ndcg: 0, precision: 0, recall: 0 },
    });

    const report = formatEvalReport(result);

    expect(report).toContain("0 queries");
    expect(report).not.toContain("Per-tag breakdown:");
    expect(report).not.toContain("Worst queries:");
  });
});

describe("formatComparisonReport", () => {
  it("formats side-by-side comparison with delta", () => {
    const resultA = makeEvalResult({
      metrics: { mrr: 0.70, ndcg: 0.65, precision: 0.60, recall: 0.55 },
    });
    const resultB = makeEvalResult({
      metrics: { mrr: 0.80, ndcg: 0.75, precision: 0.70, recall: 0.65 },
    });

    const report = formatComparisonReport([resultA, resultB], ["baseline", "experiment"]);

    expect(report).toContain("Config Comparison");
    expect(report).toContain("baseline");
    expect(report).toContain("experiment");
    // Deltas should be positive (B > A): +0.100
    expect(report).toContain("+0.100");
  });

  it("determines winner correctly", () => {
    const resultA = makeEvalResult({
      metrics: { mrr: 0.70, ndcg: 0.80, precision: 0.60, recall: 0.55 },
    });
    const resultB = makeEvalResult({
      metrics: { mrr: 0.85, ndcg: 0.90, precision: 0.70, recall: 0.65 },
    });

    // A: ndcg + mrr = 0.80 + 0.70 = 1.50
    // B: ndcg + mrr = 0.90 + 0.85 = 1.75
    const report = formatComparisonReport([resultA, resultB], ["A", "B"]);

    expect(report).toContain("Winner: B");
  });
});
