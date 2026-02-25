import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;
let scroogeDir: string;
let observedPath: string;

// Mock homedir before importing observed.ts so all calls use our test dir
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => testDir,
  };
});

// Import after mock setup
const { categorize, shortName, readObserved, computeCoverage, cleanupObserved, formatCoverageSection } = await import(
  "../src/utils/observed.js"
);
type ObservedRecord = import("../src/utils/observed.js").ObservedRecord;

beforeEach(() => {
  testDir = join(tmpdir(), `scrooge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  scroogeDir = join(testDir, ".scrooge");
  observedPath = join(scroogeDir, "observed.jsonl");
  mkdirSync(scroogeDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("categorize", () => {
  it("should classify Claude Code scrooge search as scrooge_exploration", () => {
    expect(categorize("mcp__plugin_scrooge__scrooge_search")).toBe("scrooge_exploration");
    expect(categorize("mcp__scrooge__scrooge_search")).toBe("scrooge_exploration");
  });

  it("should classify all scrooge exploration tools", () => {
    expect(categorize("mcp__scrooge__scrooge_lookup")).toBe("scrooge_exploration");
    expect(categorize("mcp__scrooge__scrooge_map")).toBe("scrooge_exploration");
    expect(categorize("mcp__scrooge__scrooge_context")).toBe("scrooge_exploration");
    expect(categorize("mcp__scrooge__scrooge_deps")).toBe("scrooge_exploration");
  });

  it("should classify pi.dev scrooge tools as scrooge_exploration", () => {
    expect(categorize("pi:scrooge_search")).toBe("scrooge_exploration");
    expect(categorize("pi:scrooge_lookup")).toBe("scrooge_exploration");
    expect(categorize("pi:scrooge_map")).toBe("scrooge_exploration");
    expect(categorize("pi:scrooge_context")).toBe("scrooge_exploration");
    expect(categorize("pi:scrooge_deps")).toBe("scrooge_exploration");
  });

  it("should classify Claude Code native exploration tools", () => {
    expect(categorize("Read")).toBe("native_exploration");
    expect(categorize("Grep")).toBe("native_exploration");
    expect(categorize("Glob")).toBe("native_exploration");
  });

  it("should classify pi.dev native exploration tools", () => {
    expect(categorize("pi:read")).toBe("native_exploration");
    expect(categorize("pi:grep")).toBe("native_exploration");
    expect(categorize("pi:glob")).toBe("native_exploration");
  });

  it("should classify scrooge admin tools", () => {
    expect(categorize("mcp__scrooge__scrooge_status")).toBe("scrooge_admin");
    expect(categorize("mcp__scrooge__scrooge_statistics")).toBe("scrooge_admin");
    expect(categorize("mcp__scrooge__scrooge_export")).toBe("scrooge_admin");
    expect(categorize("mcp__scrooge__scrooge_reindex")).toBe("scrooge_admin");
    expect(categorize("pi:scrooge_status")).toBe("scrooge_admin");
  });

  it("should classify other tools", () => {
    expect(categorize("Write")).toBe("other");
    expect(categorize("Edit")).toBe("other");
    expect(categorize("Bash")).toBe("other");
    expect(categorize("Task")).toBe("other");
    expect(categorize("WebFetch")).toBe("other");
    expect(categorize("pi:write")).toBe("other");
    expect(categorize("pi:edit")).toBe("other");
  });
});

describe("shortName", () => {
  it("should strip mcp prefix and scrooge_ prefix", () => {
    expect(shortName("mcp__plugin_scrooge__scrooge_search")).toBe("search");
    expect(shortName("mcp__scrooge__scrooge_lookup")).toBe("lookup");
  });

  it("should strip pi:scrooge_ prefix", () => {
    expect(shortName("pi:scrooge_search")).toBe("search");
    expect(shortName("pi:scrooge_deps")).toBe("deps");
  });

  it("should capitalize pi: native tools", () => {
    expect(shortName("pi:read")).toBe("Read");
    expect(shortName("pi:grep")).toBe("Grep");
    expect(shortName("pi:glob")).toBe("Glob");
  });

  it("should keep Claude Code tool names as-is", () => {
    expect(shortName("Read")).toBe("Read");
    expect(shortName("Write")).toBe("Write");
    expect(shortName("Bash")).toBe("Bash");
  });
});

describe("readObserved", () => {
  it("should return empty array when file does not exist", () => {
    rmSync(observedPath, { force: true });
    expect(readObserved()).toEqual([]);
  });

  it("should read JSONL records", () => {
    const records = [
      { t: "2026-02-25T10:00:00Z", tool: "Read", repo: "/test/repo", sid: "s1" },
      { t: "2026-02-25T10:01:00Z", tool: "mcp__scrooge__scrooge_search", repo: "/test/repo", sid: "s1" },
    ];
    writeFileSync(observedPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const result = readObserved();
    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe("Read");
    expect(result[1].tool).toBe("mcp__scrooge__scrooge_search");
  });

  it("should filter by repo path", () => {
    const records = [
      { t: "2026-02-25T10:00:00Z", tool: "Read", repo: "/repo-a", sid: "s1" },
      { t: "2026-02-25T10:01:00Z", tool: "Grep", repo: "/repo-b", sid: "s1" },
      { t: "2026-02-25T10:02:00Z", tool: "Glob", repo: "/repo-a", sid: "s1" },
    ];
    writeFileSync(observedPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const result = readObserved("/repo-a");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.repo === "/repo-a")).toBe(true);
  });

  it("should filter by date", () => {
    const records = [
      { t: "2026-01-01T00:00:00Z", tool: "Read", repo: "/test", sid: "s1" },
      { t: "2026-02-25T10:00:00Z", tool: "Grep", repo: "/test", sid: "s1" },
    ];
    writeFileSync(observedPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const result = readObserved(undefined, "2026-02-01");
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe("Grep");
  });

  it("should skip malformed lines", () => {
    writeFileSync(observedPath, '{"t":"2026-02-25","tool":"Read","repo":"/test","sid":"s1"}\nnot-json\n');

    const result = readObserved();
    expect(result).toHaveLength(1);
  });
});

describe("computeCoverage", () => {
  function makeRecord(tool: string, repo = "/test"): ObservedRecord {
    return { t: "2026-02-25T10:00:00Z", tool, repo, sid: "s1" };
  }

  it("should compute correct coverage percentage", () => {
    const records = [
      makeRecord("mcp__scrooge__scrooge_search"),
      makeRecord("mcp__scrooge__scrooge_search"),
      makeRecord("mcp__scrooge__scrooge_lookup"),
      makeRecord("Read"),
    ];

    const result = computeCoverage(records);
    expect(result.coveragePct).toBe(75);
    expect(result.totalExploration).toBe(4);
    expect(result.scroogeExploration.get("search")).toBe(2);
    expect(result.scroogeExploration.get("lookup")).toBe(1);
    expect(result.nativeExploration.get("Read")).toBe(1);
  });

  it("should handle 100% scrooge coverage", () => {
    const records = [
      makeRecord("mcp__scrooge__scrooge_search"),
      makeRecord("mcp__scrooge__scrooge_map"),
    ];

    const result = computeCoverage(records);
    expect(result.coveragePct).toBe(100);
    expect(result.totalExploration).toBe(2);
  });

  it("should handle 0% scrooge coverage (all native)", () => {
    const records = [makeRecord("Read"), makeRecord("Grep"), makeRecord("Glob")];

    const result = computeCoverage(records);
    expect(result.coveragePct).toBe(0);
    expect(result.totalExploration).toBe(3);
  });

  it("should handle empty records", () => {
    const result = computeCoverage([]);
    expect(result.coveragePct).toBe(0);
    expect(result.totalExploration).toBe(0);
  });

  it("should put admin and other tools in the other bucket", () => {
    const records = [
      makeRecord("mcp__scrooge__scrooge_status"),
      makeRecord("Write"),
      makeRecord("Bash"),
    ];

    const result = computeCoverage(records);
    expect(result.coveragePct).toBe(0);
    expect(result.totalExploration).toBe(0);
    expect(result.other.get("status")).toBe(1);
    expect(result.other.get("Write")).toBe(1);
    expect(result.other.get("Bash")).toBe(1);
  });

  it("should handle pi.dev tools correctly", () => {
    const records = [
      makeRecord("pi:scrooge_search"),
      makeRecord("pi:scrooge_lookup"),
      makeRecord("pi:read"),
      makeRecord("pi:write"),
    ];

    const result = computeCoverage(records);
    expect(result.coveragePct).toBeCloseTo(66.7, 0);
    expect(result.scroogeExploration.get("search")).toBe(1);
    expect(result.nativeExploration.get("Read")).toBe(1);
    expect(result.other.get("Write")).toBe(1);
  });
});

describe("cleanupObserved", () => {
  it("should remove records older than specified days", () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();

    const records = [
      { t: old, tool: "Read", repo: "/test", sid: "s1" },
      { t: recent, tool: "Grep", repo: "/test", sid: "s1" },
    ];
    writeFileSync(observedPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const removed = cleanupObserved(90);
    expect(removed).toBe(1);

    const remaining = readObserved();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tool).toBe("Grep");
  });

  it("should return 0 when file does not exist", () => {
    rmSync(observedPath, { force: true });
    expect(cleanupObserved()).toBe(0);
  });
});

describe("formatCoverageSection", () => {
  it("should return null when no observed data", () => {
    rmSync(observedPath, { force: true });
    expect(formatCoverageSection("/test")).toBeNull();
  });

  it("should format coverage section correctly", () => {
    const records = [
      { t: "2026-02-25T10:00:00Z", tool: "mcp__scrooge__scrooge_search", repo: "/test", sid: "s1" },
      { t: "2026-02-25T10:01:00Z", tool: "mcp__scrooge__scrooge_search", repo: "/test", sid: "s1" },
      { t: "2026-02-25T10:02:00Z", tool: "mcp__scrooge__scrooge_lookup", repo: "/test", sid: "s1" },
      { t: "2026-02-25T10:03:00Z", tool: "Read", repo: "/test", sid: "s1" },
      { t: "2026-02-25T10:04:00Z", tool: "Write", repo: "/test", sid: "s1" },
    ];
    writeFileSync(observedPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const section = formatCoverageSection("/test");
    expect(section).not.toBeNull();
    expect(section).toContain("Scrooge exploration: 3 calls");
    expect(section).toContain("search: 2");
    expect(section).toContain("lookup: 1");
    expect(section).toContain("Native exploration:  1 calls");
    expect(section).toContain("Read: 1");
    expect(section).toContain("Other agent calls:   1");
    expect(section).toContain("Coverage: 75.0%");
    expect(section).toContain("3 of 4");
  });

  it("should return null when only non-exploration calls exist for repo", () => {
    const records = [
      { t: "2026-02-25T10:00:00Z", tool: "Write", repo: "/other-repo", sid: "s1" },
    ];
    writeFileSync(observedPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    expect(formatCoverageSection("/test")).toBeNull();
  });
});
