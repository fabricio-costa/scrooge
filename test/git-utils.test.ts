import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getHeadCommit,
  getTrackedFiles,
  getChangedFiles,
  getDeletedFiles,
  isGitRepo,
} from "../src/utils/git.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scrooge-git-test-"));
  execSync("git init", { cwd: tempDir });
  execSync('git config user.email "test@test.com"', { cwd: tempDir });
  execSync('git config user.name "Test"', { cwd: tempDir });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("isGitRepo", () => {
  it("should return true for a git repository", () => {
    expect(isGitRepo(tempDir)).toBe(true);
  });

  it("should return false for a non-git directory", () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "scrooge-no-git-"));
    try {
      expect(isGitRepo(nonGitDir)).toBe(false);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

describe("getHeadCommit", () => {
  it("should return a 40-char hex SHA after a commit", () => {
    writeFileSync(join(tempDir, "file.txt"), "hello");
    execSync("git add file.txt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });

    const sha = getHeadCommit(tempDir);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("should return a different SHA after a second commit", () => {
    writeFileSync(join(tempDir, "file.txt"), "hello");
    execSync("git add file.txt", { cwd: tempDir });
    execSync('git commit -m "first"', { cwd: tempDir });
    const sha1 = getHeadCommit(tempDir);

    writeFileSync(join(tempDir, "file.txt"), "world");
    execSync("git add file.txt", { cwd: tempDir });
    execSync('git commit -m "second"', { cwd: tempDir });
    const sha2 = getHeadCommit(tempDir);

    expect(sha2).toMatch(/^[0-9a-f]{40}$/);
    expect(sha2).not.toBe(sha1);
  });
});

describe("getTrackedFiles", () => {
  it("should return committed files", () => {
    writeFileSync(join(tempDir, "a.kt"), "class A");
    writeFileSync(join(tempDir, "b.kt"), "class B");
    execSync("git add a.kt b.kt", { cwd: tempDir });
    execSync('git commit -m "add files"', { cwd: tempDir });

    const tracked = getTrackedFiles(tempDir);
    expect(tracked).toContain("a.kt");
    expect(tracked).toContain("b.kt");
    expect(tracked).toHaveLength(2);
  });

  it("should not include untracked files", () => {
    writeFileSync(join(tempDir, "tracked.kt"), "class T");
    execSync("git add tracked.kt", { cwd: tempDir });
    execSync('git commit -m "add tracked"', { cwd: tempDir });

    writeFileSync(join(tempDir, "untracked.kt"), "class U");

    const tracked = getTrackedFiles(tempDir);
    expect(tracked).toContain("tracked.kt");
    expect(tracked).not.toContain("untracked.kt");
    expect(tracked).toHaveLength(1);
  });
});

describe("getChangedFiles", () => {
  it("should detect a modified file between two commits", () => {
    writeFileSync(join(tempDir, "app.kt"), "v1");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });
    const from = getHeadCommit(tempDir);

    writeFileSync(join(tempDir, "app.kt"), "v2");
    execSync("git add app.kt", { cwd: tempDir });
    execSync('git commit -m "modify"', { cwd: tempDir });
    const to = getHeadCommit(tempDir);

    const changed = getChangedFiles(tempDir, from, to);
    expect(changed).toContain("app.kt");
    expect(changed).toHaveLength(1);
  });

  it("should only return the modified file when multiple files exist", () => {
    writeFileSync(join(tempDir, "a.kt"), "v1");
    writeFileSync(join(tempDir, "b.kt"), "v1");
    execSync("git add a.kt b.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });
    const from = getHeadCommit(tempDir);

    writeFileSync(join(tempDir, "a.kt"), "v2");
    execSync("git add a.kt", { cwd: tempDir });
    execSync('git commit -m "modify a"', { cwd: tempDir });
    const to = getHeadCommit(tempDir);

    const changed = getChangedFiles(tempDir, from, to);
    expect(changed).toEqual(["a.kt"]);
  });

  it("should detect newly added files as changed", () => {
    writeFileSync(join(tempDir, "a.kt"), "v1");
    execSync("git add a.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });
    const from = getHeadCommit(tempDir);

    writeFileSync(join(tempDir, "b.kt"), "new");
    execSync("git add b.kt", { cwd: tempDir });
    execSync('git commit -m "add b"', { cwd: tempDir });
    const to = getHeadCommit(tempDir);

    const changed = getChangedFiles(tempDir, from, to);
    expect(changed).toContain("b.kt");
  });

  it("should default toCommit to HEAD", () => {
    writeFileSync(join(tempDir, "a.kt"), "v1");
    execSync("git add a.kt", { cwd: tempDir });
    execSync('git commit -m "initial"', { cwd: tempDir });
    const from = getHeadCommit(tempDir);

    writeFileSync(join(tempDir, "a.kt"), "v2");
    execSync("git add a.kt", { cwd: tempDir });
    execSync('git commit -m "modify"', { cwd: tempDir });

    const changed = getChangedFiles(tempDir, from);
    expect(changed).toContain("a.kt");
  });
});

describe("getDeletedFiles", () => {
  it("should detect a deleted file between two commits", () => {
    writeFileSync(join(tempDir, "doomed.kt"), "bye");
    execSync("git add doomed.kt", { cwd: tempDir });
    execSync('git commit -m "add doomed"', { cwd: tempDir });
    const from = getHeadCommit(tempDir);

    unlinkSync(join(tempDir, "doomed.kt"));
    execSync("git add doomed.kt", { cwd: tempDir });
    execSync('git commit -m "delete doomed"', { cwd: tempDir });
    const to = getHeadCommit(tempDir);

    const deleted = getDeletedFiles(tempDir, from, to);
    expect(deleted).toContain("doomed.kt");
    expect(deleted).toHaveLength(1);
  });

  it("should only return the deleted file when multiple files exist", () => {
    writeFileSync(join(tempDir, "a.kt"), "keep");
    writeFileSync(join(tempDir, "b.kt"), "remove");
    execSync("git add a.kt b.kt", { cwd: tempDir });
    execSync('git commit -m "add both"', { cwd: tempDir });
    const from = getHeadCommit(tempDir);

    unlinkSync(join(tempDir, "b.kt"));
    execSync("git add b.kt", { cwd: tempDir });
    execSync('git commit -m "delete b"', { cwd: tempDir });
    const to = getHeadCommit(tempDir);

    const deleted = getDeletedFiles(tempDir, from, to);
    expect(deleted).toEqual(["b.kt"]);
  });

  it("should default toCommit to HEAD", () => {
    writeFileSync(join(tempDir, "gone.kt"), "bye");
    execSync("git add gone.kt", { cwd: tempDir });
    execSync('git commit -m "add"', { cwd: tempDir });
    const from = getHeadCommit(tempDir);

    unlinkSync(join(tempDir, "gone.kt"));
    execSync("git add gone.kt", { cwd: tempDir });
    execSync('git commit -m "delete"', { cwd: tempDir });

    const deleted = getDeletedFiles(tempDir, from);
    expect(deleted).toContain("gone.kt");
  });
});
