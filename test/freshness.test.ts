import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, upsertIndexMeta } from "../src/storage/db.js";
import { getHeadCommit } from "../src/utils/git.js";
import { ensureFreshIndex, formatReindexNote, type FreshnessResult } from "../src/utils/freshness.js";
import type Database from "better-sqlite3";

// Mock the pipeline to avoid actual indexing (which requires file reading, tree-sitter, embeddings)
vi.mock("../src/indexer/pipeline.js", () => ({
  runPipeline: vi.fn().mockResolvedValue({
    filesProcessed: 3,
    chunksCreated: 10,
    chunksRemoved: 2,
    timeMs: 150,
  }),
}));

let tempDir: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scrooge-freshness-test-"));
  execSync("git init", { cwd: tempDir });
  execSync('git config user.email "test@test.com"', { cwd: tempDir });
  execSync('git config user.name "Test"', { cwd: tempDir });
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("ensureFreshIndex", () => {
  it("should run full reindex when repo has never been indexed", async () => {
    writeFileSync(join(tempDir, "app.kt"), "class App {}");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });

    const result = await ensureFreshIndex(db, tempDir);

    expect(result.reindexed).toBe(true);
    expect(result.reason).toBe("not_indexed");
    expect(result.stats).toBeDefined();
    expect(result.stats!.filesProcessed).toBe(3);
  });

  it("should run incremental reindex when HEAD differs from last indexed commit", async () => {
    writeFileSync(join(tempDir, "app.kt"), "class App {}");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });
    const oldSha = getHeadCommit(tempDir);

    // Record the old commit as indexed
    upsertIndexMeta(db, {
      repo_path: tempDir,
      last_commit_sha: oldSha,
      last_indexed_at: new Date().toISOString(),
      total_chunks: 5,
      total_files: 1,
    });

    // Make a new commit to make the index stale
    writeFileSync(join(tempDir, "app.kt"), "class App { fun run() {} }");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "update"', { cwd: tempDir });

    const result = await ensureFreshIndex(db, tempDir);

    expect(result.reindexed).toBe(true);
    expect(result.reason).toBe("stale");
    expect(result.stats).toBeDefined();
  });

  it("should skip reindex when index is fresh (HEAD matches last indexed commit)", async () => {
    writeFileSync(join(tempDir, "app.kt"), "class App {}");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });
    const currentSha = getHeadCommit(tempDir);

    upsertIndexMeta(db, {
      repo_path: tempDir,
      last_commit_sha: currentSha,
      last_indexed_at: new Date().toISOString(),
      total_chunks: 5,
      total_files: 1,
    });

    const result = await ensureFreshIndex(db, tempDir);

    expect(result.reindexed).toBe(false);
    expect(result.reason).toBe("fresh");
    expect(result.stats).toBeUndefined();
  });

  it("should skip check for non-git directories", async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "scrooge-no-git-"));
    try {
      const result = await ensureFreshIndex(db, nonGitDir);

      expect(result.reindexed).toBe(false);
      expect(result.reason).toBe("not_git");
      expect(result.stats).toBeUndefined();
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("should call runPipeline with incremental=false for unindexed repos", async () => {
    const { runPipeline } = await import("../src/indexer/pipeline.js");

    writeFileSync(join(tempDir, "app.kt"), "class App {}");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });

    await ensureFreshIndex(db, tempDir);

    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: tempDir,
        incremental: false,
        withEmbeddings: true,
      }),
    );
  });

  it("should call runPipeline with incremental=true for stale repos", async () => {
    const { runPipeline } = await import("../src/indexer/pipeline.js");

    writeFileSync(join(tempDir, "app.kt"), "class App {}");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });

    upsertIndexMeta(db, {
      repo_path: tempDir,
      last_commit_sha: "0000000000000000000000000000000000000000",
      last_indexed_at: new Date().toISOString(),
      total_chunks: 5,
      total_files: 1,
    });

    await ensureFreshIndex(db, tempDir);

    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: tempDir,
        incremental: true,
        withEmbeddings: true,
      }),
    );
  });

  it("should not call runPipeline when index is fresh", async () => {
    const { runPipeline } = await import("../src/indexer/pipeline.js");

    writeFileSync(join(tempDir, "app.kt"), "class App {}");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });
    const sha = getHeadCommit(tempDir);

    upsertIndexMeta(db, {
      repo_path: tempDir,
      last_commit_sha: sha,
      last_indexed_at: new Date().toISOString(),
      total_chunks: 5,
      total_files: 1,
    });

    await ensureFreshIndex(db, tempDir);

    expect(runPipeline).not.toHaveBeenCalled();
  });
});

describe("formatReindexNote", () => {
  it("should return null when no reindex happened", () => {
    const result: FreshnessResult = { reindexed: false, reason: "fresh" };
    expect(formatReindexNote(result)).toBeNull();
  });

  it("should return auto-indexed note for first-time indexing", () => {
    const result: FreshnessResult = {
      reindexed: true,
      reason: "not_indexed",
      stats: { filesProcessed: 10, chunksCreated: 50, chunksRemoved: 0, timeMs: 2000 },
    };
    const note = formatReindexNote(result);
    expect(note).toBe("Index auto-indexed (10 files, 50 chunks added, 0 removed, 2000ms)");
  });

  it("should return auto-refreshed note for stale index", () => {
    const result: FreshnessResult = {
      reindexed: true,
      reason: "stale",
      stats: { filesProcessed: 3, chunksCreated: 8, chunksRemoved: 5, timeMs: 400 },
    };
    const note = formatReindexNote(result);
    expect(note).toBe("Index auto-refreshed (3 files, 8 chunks added, 5 removed, 400ms)");
  });
});
