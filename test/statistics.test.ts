import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, recordToolCall, type ToolCallRecord } from "../src/storage/db.js";
import { buildStatisticsReport } from "../src/api/statistics.js";
import type Database from "better-sqlite3";

let db: Database.Database;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("tool_calls table", () => {
  it("should exist after migration", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("tool_calls");
  });

  it("should have indexes", () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_tool_calls%'")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_tool_calls_repo");
    expect(names).toContain("idx_tool_calls_tool");
  });
});

describe("recordToolCall", () => {
  it("should insert a row with all fields", () => {
    recordToolCall(db, {
      tool: "search",
      repo_path: "/test/repo",
      duration_ms: 150,
      tokens_sent: 500,
      tokens_raw: 3000,
      metadata: { query: "LoginViewModel", resultCount: 5 },
    });

    const row = db.prepare("SELECT * FROM tool_calls WHERE tool = 'search'").get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.tool).toBe("search");
    expect(row.repo_path).toBe("/test/repo");
    expect(row.duration_ms).toBe(150);
    expect(row.tokens_sent).toBe(500);
    expect(row.tokens_raw).toBe(3000);
    expect(JSON.parse(row.metadata as string)).toEqual({ query: "LoginViewModel", resultCount: 5 });
    expect(row.called_at).toBeDefined();
  });

  it("should insert a row without metadata", () => {
    recordToolCall(db, {
      tool: "status",
      repo_path: "/test/repo",
      duration_ms: 10,
      tokens_sent: 0,
      tokens_raw: 0,
    });

    const row = db.prepare("SELECT * FROM tool_calls WHERE tool = 'status'").get() as Record<string, unknown>;
    expect(row.metadata).toBeNull();
  });

  it("should auto-increment IDs", () => {
    for (let i = 0; i < 3; i++) {
      recordToolCall(db, {
        tool: "search",
        repo_path: "/test/repo",
        duration_ms: 100,
        tokens_sent: 100,
        tokens_raw: 1000,
      });
    }

    const rows = db.prepare("SELECT id FROM tool_calls ORDER BY id").all() as Array<{ id: number }>;
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe(1);
    expect(rows[1].id).toBe(2);
    expect(rows[2].id).toBe(3);
  });
});

describe("buildStatisticsReport", () => {
  function insertCalls(calls: ToolCallRecord[]) {
    for (const call of calls) {
      recordToolCall(db, call);
    }
  }

  it("should return empty message when no calls recorded", () => {
    const report = buildStatisticsReport(db, "/test/repo", "all");
    expect(report).toBe("No Scrooge usage recorded yet for this repository.");
  });

  it("should show token savings summary", () => {
    insertCalls([
      { tool: "search", repo_path: "/test/repo", duration_ms: 100, tokens_sent: 500, tokens_raw: 3000 },
      { tool: "search", repo_path: "/test/repo", duration_ms: 120, tokens_sent: 600, tokens_raw: 4000 },
      { tool: "map", repo_path: "/test/repo", duration_ms: 50, tokens_sent: 200, tokens_raw: 10000 },
    ]);

    const report = buildStatisticsReport(db, "/test/repo", "all");

    expect(report).toContain("Scrooge Statistics");
    expect(report).toContain("Token Savings");
    // total sent: 1300, total raw: 17000, saved: 15700 (92.4%)
    expect(report).toContain("1,300");
    expect(report).toContain("17,000");
    expect(report).toContain("15,700");
    expect(report).toContain("92.4%");
  });

  it("should show usage breakdown by tool", () => {
    insertCalls([
      { tool: "search", repo_path: "/test/repo", duration_ms: 100, tokens_sent: 500, tokens_raw: 3000 },
      { tool: "search", repo_path: "/test/repo", duration_ms: 100, tokens_sent: 500, tokens_raw: 3000 },
      { tool: "lookup", repo_path: "/test/repo", duration_ms: 80, tokens_sent: 300, tokens_raw: 2000 },
      { tool: "map", repo_path: "/test/repo", duration_ms: 50, tokens_sent: 200, tokens_raw: 10000 },
      { tool: "status", repo_path: "/test/repo", duration_ms: 10, tokens_sent: 0, tokens_raw: 0 },
    ]);

    const report = buildStatisticsReport(db, "/test/repo", "all");

    expect(report).toContain("5 total calls");
    expect(report).toContain("search: 2");
    expect(report).toContain("lookup: 1");
    expect(report).toContain("map: 1");
    expect(report).toContain("status: 1");
  });

  it("should show search insights when search calls exist", () => {
    insertCalls([
      {
        tool: "search",
        repo_path: "/test/repo",
        duration_ms: 100,
        tokens_sent: 500,
        tokens_raw: 3000,
        metadata: { query: "login", resultCount: 5, sources: { lexical: 2, vector: 1, both: 2 } },
      },
      {
        tool: "search",
        repo_path: "/test/repo",
        duration_ms: 120,
        tokens_sent: 700,
        tokens_raw: 4000,
        metadata: { query: "auth", resultCount: 3, sources: { lexical: 1, vector: 1, both: 1 } },
      },
    ]);

    const report = buildStatisticsReport(db, "/test/repo", "all");

    expect(report).toContain("Search Insights");
    expect(report).toContain("Avg results/query: 4.0");
    // avg tokens: (500+700)/2 = 600
    expect(report).toContain("Avg tokens/query: 600");
    // sources: lexical=3, vector=2, both=3 → total=8 → 38%, 25%, 38%
    expect(report).toContain("lexical 38%");
    expect(report).toContain("vector 25%");
    expect(report).toContain("both 38%");
  });

  it("should filter by repo_path", () => {
    insertCalls([
      { tool: "search", repo_path: "/repo-a", duration_ms: 100, tokens_sent: 500, tokens_raw: 3000 },
      { tool: "search", repo_path: "/repo-b", duration_ms: 100, tokens_sent: 800, tokens_raw: 5000 },
    ]);

    const reportA = buildStatisticsReport(db, "/repo-a", "all");
    expect(reportA).toContain("500");
    expect(reportA).not.toContain("800");

    const reportB = buildStatisticsReport(db, "/repo-b", "all");
    expect(reportB).toContain("800");
    expect(reportB).not.toContain("3,000");
  });

  it("should handle period filtering", () => {
    // Insert a call with explicit timestamp in the past
    db.prepare(
      `INSERT INTO tool_calls (tool, repo_path, called_at, duration_ms, tokens_sent, tokens_raw, metadata)
       VALUES ('search', '/test/repo', '2020-01-01 00:00:00', 100, 500, 3000, NULL)`,
    ).run();

    // Insert a recent call
    recordToolCall(db, {
      tool: "search",
      repo_path: "/test/repo",
      duration_ms: 100,
      tokens_sent: 800,
      tokens_raw: 5000,
    });

    const allReport = buildStatisticsReport(db, "/test/repo", "all");
    // Should include both calls (1300 total sent)
    expect(allReport).toContain("1,300");

    const todayReport = buildStatisticsReport(db, "/test/repo", "today");
    // Should only include the recent call
    expect(todayReport).toContain("800");
    expect(todayReport).not.toContain("1,300");
  });

  it("should show 0% savings when tokens_raw is 0", () => {
    insertCalls([
      { tool: "status", repo_path: "/test/repo", duration_ms: 10, tokens_sent: 0, tokens_raw: 0 },
    ]);

    const report = buildStatisticsReport(db, "/test/repo", "all");
    expect(report).toContain("0.0%");
  });

  it("should extract repo name from path", () => {
    insertCalls([
      { tool: "search", repo_path: "/home/user/projects/kotlin-pdv", duration_ms: 100, tokens_sent: 500, tokens_raw: 3000 },
    ]);

    const report = buildStatisticsReport(db, "/home/user/projects/kotlin-pdv", "all");
    expect(report).toContain("kotlin-pdv");
  });

  it("should show per-tool savings breakdown", () => {
    insertCalls([
      { tool: "search", repo_path: "/test/repo", duration_ms: 100, tokens_sent: 500, tokens_raw: 3000 },
      { tool: "search", repo_path: "/test/repo", duration_ms: 120, tokens_sent: 300, tokens_raw: 2000 },
      { tool: "lookup", repo_path: "/test/repo", duration_ms: 80, tokens_sent: 200, tokens_raw: 1000 },
      { tool: "map", repo_path: "/test/repo", duration_ms: 50, tokens_sent: 100, tokens_raw: 500 },
      { tool: "status", repo_path: "/test/repo", duration_ms: 10, tokens_sent: 0, tokens_raw: 0 },
    ]);

    const report = buildStatisticsReport(db, "/test/repo", "all");

    expect(report).toContain("Savings by Tool");
    // search: 800 delivered / 5,000 raw (84.0% saved)
    expect(report).toContain("search: 800 delivered / 5,000 raw (84.0% saved)");
    // lookup: 200 delivered / 1,000 raw (80.0% saved)
    expect(report).toContain("lookup: 200 delivered / 1,000 raw (80.0% saved)");
    // map: 100 delivered / 500 raw (80.0% saved)
    expect(report).toContain("map: 100 delivered / 500 raw (80.0% saved)");
    // status has 0 tokens_raw, should not appear in savings breakdown
    expect(report).not.toContain("status: 0 delivered");
  });

  it("should show model breakdown when model data exists", () => {
    insertCalls([
      { tool: "search", repo_path: "/test/repo", duration_ms: 100, tokens_sent: 500, tokens_raw: 3000, model: "claude-opus-4-6" },
      { tool: "search", repo_path: "/test/repo", duration_ms: 120, tokens_sent: 300, tokens_raw: 2000, model: "claude-opus-4-6" },
      { tool: "lookup", repo_path: "/test/repo", duration_ms: 80, tokens_sent: 200, tokens_raw: 1000, model: "claude-sonnet-4-5" },
    ]);

    const report = buildStatisticsReport(db, "/test/repo", "all");

    expect(report).toContain("Models");
    expect(report).toContain("claude-opus-4-6: 2 calls (800 tokens)");
    expect(report).toContain("claude-sonnet-4-5: 1 calls (200 tokens)");
  });

  it("should hide model section when all models are unknown", () => {
    insertCalls([
      { tool: "search", repo_path: "/test/repo", duration_ms: 100, tokens_sent: 500, tokens_raw: 3000 },
    ]);

    const report = buildStatisticsReport(db, "/test/repo", "all");

    expect(report).not.toContain("Models");
  });
});

describe("recordToolCall with model", () => {
  it("should store model field", () => {
    recordToolCall(db, {
      tool: "search",
      repo_path: "/test/repo",
      duration_ms: 100,
      tokens_sent: 500,
      tokens_raw: 3000,
      model: "claude-opus-4-6",
    });

    const row = db.prepare("SELECT model FROM tool_calls WHERE tool = 'search'").get() as { model: string | null };
    expect(row.model).toBe("claude-opus-4-6");
  });

  it("should store null when model not provided", () => {
    recordToolCall(db, {
      tool: "status",
      repo_path: "/test/repo",
      duration_ms: 10,
      tokens_sent: 0,
      tokens_raw: 0,
    });

    const row = db.prepare("SELECT model FROM tool_calls WHERE tool = 'status'").get() as { model: string | null };
    expect(row.model).toBeNull();
  });
});
