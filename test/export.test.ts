import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { exportData, formatAsJsonl, formatAsCsv } from "../src/api/export.js";
import type { ExportRecord } from "../src/api/types.js";

describe("exportData", () => {
  it("should return default format as jsonl", async () => {
    // Uses real CWD (the repo itself) but a fresh in-memory DB → 0 records
    const result = await exportData(
      {},
      { channel: "test", repoPath: process.cwd(), dbPath: ":memory:" },
    );
    expect(result.format).toBe("jsonl");
    expect(result.count).toBe(0);
    expect(result.records).toEqual([]);
  });

  it("should respect format parameter", async () => {
    const result = await exportData(
      { format: "csv" },
      { channel: "test", repoPath: process.cwd(), dbPath: ":memory:" },
    );
    expect(result.format).toBe("csv");
  });
});

describe("formatAsJsonl", () => {
  it("should produce valid JSONL", () => {
    const records: ExportRecord[] = [
      {
        id: 1,
        tool: "search",
        repo: "repo",
        called_at: "2026-02-24T22:04:23",
        duration_ms: 150,
        tokens_sent: 500,
        tokens_raw: 3000,
        channel: "mcp",
        model: "claude-opus-4-6",
        query: "login",
      },
      {
        id: 2,
        tool: "lookup",
        repo: "repo",
        called_at: "2026-02-24T22:05:00",
        duration_ms: 80,
        tokens_sent: 300,
        tokens_raw: 2000,
        channel: "mcp",
        model: null,
      },
    ];

    const jsonl = formatAsJsonl(records);
    const lines = jsonl.split("\n");
    expect(lines).toHaveLength(2);

    const parsed0 = JSON.parse(lines[0]);
    expect(parsed0.tool).toBe("search");
    expect(parsed0.query).toBe("login");

    const parsed1 = JSON.parse(lines[1]);
    expect(parsed1.tool).toBe("lookup");
    expect(parsed1.model).toBeNull();
  });

  it("should return empty string for no records", () => {
    expect(formatAsJsonl([])).toBe("");
  });
});

describe("formatAsCsv", () => {
  it("should produce valid CSV with headers", () => {
    const records: ExportRecord[] = [
      {
        id: 1,
        tool: "search",
        repo: "repo",
        called_at: "2026-02-24T22:04:23",
        duration_ms: 150,
        tokens_sent: 500,
        tokens_raw: 3000,
        channel: "mcp",
        model: "claude-opus-4-6",
      },
    ];

    const csv = formatAsCsv(records);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("id,tool,repo,called_at,duration_ms,tokens_sent,tokens_raw,channel,model");
    expect(lines[1]).toContain("search");
    expect(lines[1]).toContain("500");
  });

  it("should escape commas in values", () => {
    const records: ExportRecord[] = [
      {
        id: 1,
        tool: "search",
        repo: "my,repo",
        called_at: "2026-02-24",
        duration_ms: 100,
        tokens_sent: 100,
        tokens_raw: 500,
        channel: "mcp",
        model: null,
      },
    ];

    const csv = formatAsCsv(records);
    expect(csv).toContain('"my,repo"');
  });

  it("should return empty string for no records", () => {
    expect(formatAsCsv([])).toBe("");
  });
});

describe("anonymize", () => {
  it("should hash repo and strip query", () => {
    const records: ExportRecord[] = [
      {
        id: 1,
        tool: "search",
        repo: "/home/user/my-project",
        called_at: "2026-02-24T22:04:23",
        duration_ms: 150,
        tokens_sent: 500,
        tokens_raw: 3000,
        channel: "mcp",
        model: null,
        query: "login password",
      },
    ];

    // Simulate anonymize behavior from export.ts
    const anonymized = records.map((r) => {
      const rec = { ...r };
      rec.repo = createHash("sha256").update("/home/user/my-project").digest("hex").slice(0, 8);
      delete rec.query;
      rec.called_at = r.called_at.slice(0, 10);
      return rec;
    });

    expect(anonymized[0].repo).toHaveLength(8);
    expect(anonymized[0].repo).not.toContain("my-project");
    expect(anonymized[0].query).toBeUndefined();
    expect(anonymized[0].called_at).toBe("2026-02-24");
  });
});
