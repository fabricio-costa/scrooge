/**
 * Integration test for bin/scrooge-session.mjs (SessionStart hook).
 *
 * Verifies the hook correctly handles:
 * - Non-git directories (returns {})
 * - Git repos without a Scrooge DB (suggests indexing)
 * - Git repos with DB but not indexed (suggests indexing)
 * - Git repos that are indexed (returns summary with stats)
 * - Malformed input (returns {})
 *
 * Uses SCROOGE_DB_PATH env var to control the database location,
 * isolating tests from the user's real Scrooge installation.
 *
 * See: https://github.com/fabricio-costa/scrooge/pull/18
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const HOOK_PATH = join(__dirname, "..", "bin", "scrooge-session.mjs");

function runHook(input: unknown, env: Record<string, string> = {}): Record<string, unknown> {
  const result = execFileSync("node", [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: "utf-8",
    timeout: 5000,
    env: { ...process.env, ...env },
  });
  return JSON.parse(result);
}

function runHookRaw(rawInput: string, env: Record<string, string> = {}): Record<string, unknown> {
  const result = execFileSync("node", [HOOK_PATH], {
    input: rawInput,
    encoding: "utf-8",
    timeout: 5000,
    env: { ...process.env, ...env },
  });
  return JSON.parse(result);
}

const INDEX_META_DDL = `CREATE TABLE IF NOT EXISTS index_meta (
  repo_path TEXT PRIMARY KEY,
  total_files INTEGER,
  total_chunks INTEGER,
  last_indexed_at TEXT,
  last_commit_sha TEXT
)`;

let tempDir: string;
let dbDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scrooge-session-test-"));
  dbDir = mkdtempSync(join(tmpdir(), "scrooge-db-test-"));
  dbPath = join(dbDir, "scrooge.db");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

describe("scrooge-session.mjs hook", () => {
  describe("non-indexed repos (adoption deadlock prevention)", () => {
    it("suggests indexing when DB file does not exist for a git repo", () => {
      execSync("git init", { cwd: tempDir });

      const result = runHook(
        { cwd: tempDir },
        { SCROOGE_DB_PATH: join(dbDir, "nonexistent.db") },
      );

      const ctx = result.additionalContext as string;
      expect(ctx).toContain("not been indexed");
      expect(ctx).toContain("scrooge_reindex");
      expect(ctx).toContain("PREFER Scrooge tools");
    });

    it("suggests indexing when DB exists but repo is not in index_meta", () => {
      execSync("git init", { cwd: tempDir });

      const db = new Database(dbPath);
      db.exec(INDEX_META_DDL);
      db.close();

      const result = runHook({ cwd: tempDir }, { SCROOGE_DB_PATH: dbPath });

      const ctx = result.additionalContext as string;
      expect(ctx).toContain("not been indexed");
      expect(ctx).toContain("scrooge_reindex");
    });
  });

  describe("indexed repos", () => {
    it("returns summary with file and chunk counts", () => {
      execSync("git init", { cwd: tempDir });
      execSync('git config user.email "test@test.com"', { cwd: tempDir });
      execSync('git config user.name "Test"', { cwd: tempDir });
      writeFileSync(join(tempDir, "file.kt"), "class A");
      execSync("git add file.kt", { cwd: tempDir });
      execSync('git commit -m "initial"', { cwd: tempDir });

      const repoPath = execSync("git rev-parse --show-toplevel", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      const sha = execSync("git rev-parse HEAD", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();

      const db = new Database(dbPath);
      db.exec(INDEX_META_DDL);
      db.prepare("INSERT INTO index_meta VALUES (?, ?, ?, ?, ?)").run(
        repoPath, 5523, 26412, new Date().toISOString(), sha,
      );
      db.close();

      const result = runHook({ cwd: tempDir }, { SCROOGE_DB_PATH: dbPath });

      const ctx = result.additionalContext as string;
      expect(ctx).toContain("active");
      // toLocaleString() output varies by locale (5,523 vs 5.523), so match digits
      expect(ctx).toMatch(/5[.,]523/);
      expect(ctx).toMatch(/26[.,]412/);
      expect(ctx).toContain("scrooge_search");
      expect(ctx).toContain("scrooge_map");
      expect(ctx).toContain("scrooge_lookup");
      expect(ctx).toContain("scrooge_deps");
    });

    it("includes commit SHA prefix in summary", () => {
      execSync("git init", { cwd: tempDir });
      execSync('git config user.email "test@test.com"', { cwd: tempDir });
      execSync('git config user.name "Test"', { cwd: tempDir });
      writeFileSync(join(tempDir, "file.kt"), "class A");
      execSync("git add file.kt", { cwd: tempDir });
      execSync('git commit -m "initial"', { cwd: tempDir });

      const repoPath = execSync("git rev-parse --show-toplevel", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      const sha = execSync("git rev-parse HEAD", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();

      const db = new Database(dbPath);
      db.exec(INDEX_META_DDL);
      db.prepare("INSERT INTO index_meta VALUES (?, ?, ?, ?, ?)").run(
        repoPath, 100, 500, new Date().toISOString(), sha,
      );
      db.close();

      const result = runHook({ cwd: tempDir }, { SCROOGE_DB_PATH: dbPath });

      const ctx = result.additionalContext as string;
      expect(ctx).toContain(sha.slice(0, 7));
    });
  });

  describe("edge cases", () => {
    it("returns {} for non-git directory", () => {
      const result = runHook({ cwd: tempDir }, { SCROOGE_DB_PATH: dbPath });
      expect(result).toEqual({});
    });

    it("returns {} for invalid JSON input", () => {
      const result = runHookRaw("not json", { SCROOGE_DB_PATH: dbPath });
      expect(result).toEqual({});
    });

    it("returns {} when no cwd is provided", () => {
      const result = runHook({}, { SCROOGE_DB_PATH: dbPath });
      expect(result).toEqual({});
    });
  });
});
