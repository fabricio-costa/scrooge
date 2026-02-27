/**
 * Contract test: verify git utility functions pass maxBuffer to execFileSync.
 *
 * Prevents ENOBUFS errors on repositories with 20k+ files where
 * git ls-files / git diff output exceeds Node's default 1MB buffer.
 *
 * Approach: mock execFileSync to spy on the options object while still
 * delegating to the real implementation, then assert maxBuffer is set.
 *
 * See: https://github.com/fabricio-costa/scrooge/pull/18
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

vi.mock("node:child_process", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:child_process")>();
  return {
    ...mod,
    execFileSync: vi.fn<AnyFn>((...args) => (mod.execFileSync as AnyFn)(...args)),
  };
});

import { execFileSync } from "node:child_process";
import { getTrackedFiles, getChangedFiles, getDeletedFiles, MAX_BUFFER } from "../src/utils/git.js";

const MIN_EXPECTED_BUFFER = 10 * 1024 * 1024; // 10MB minimum
const mock = vi.mocked(execFileSync);

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scrooge-buf-test-"));
  execSync("git init", { cwd: tempDir });
  execSync('git config user.email "test@test.com"', { cwd: tempDir });
  execSync('git config user.name "Test"', { cwd: tempDir });
  writeFileSync(join(tempDir, "file.kt"), "class A");
  execSync("git add file.kt", { cwd: tempDir });
  execSync('git commit -m "initial"', { cwd: tempDir });
  mock.mockClear();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function findCall(requiredArgs: string[]): unknown[] | undefined {
  return mock.mock.calls.find((call) => {
    const args = call[1] as string[];
    return call[0] === "git" && requiredArgs.every((a) => args.includes(a));
  });
}

function getOpts(call: unknown[]): Record<string, unknown> {
  return call[2] as Record<string, unknown>;
}

describe("MAX_BUFFER constant", () => {
  it("is at least 10MB to handle repos with 100k+ files", () => {
    expect(MAX_BUFFER).toBeGreaterThanOrEqual(MIN_EXPECTED_BUFFER);
  });
});

describe("git maxBuffer contract", () => {
  it("getTrackedFiles passes maxBuffer to execFileSync", () => {
    getTrackedFiles(tempDir);

    const call = findCall(["ls-files"]);
    expect(call, "expected execFileSync call with 'ls-files'").toBeDefined();
    expect(getOpts(call!).maxBuffer).toBeGreaterThanOrEqual(MIN_EXPECTED_BUFFER);
  });

  it("getChangedFiles passes maxBuffer to execFileSync", () => {
    const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf-8" }).trim();
    writeFileSync(join(tempDir, "file.kt"), "class B");
    execSync("git add file.kt", { cwd: tempDir });
    execSync('git commit -m "change"', { cwd: tempDir });
    mock.mockClear();

    getChangedFiles(tempDir, sha);

    const call = findCall(["diff", "--name-only"]);
    expect(call, "expected execFileSync call with 'diff --name-only'").toBeDefined();
    expect(getOpts(call!).maxBuffer).toBeGreaterThanOrEqual(MIN_EXPECTED_BUFFER);
  });

  it("getDeletedFiles passes maxBuffer to execFileSync", () => {
    const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf-8" }).trim();
    writeFileSync(join(tempDir, "file.kt"), "class B");
    execSync("git add file.kt", { cwd: tempDir });
    execSync('git commit -m "change"', { cwd: tempDir });
    mock.mockClear();

    getDeletedFiles(tempDir, sha);

    const call = findCall(["--diff-filter=D"]);
    expect(call, "expected execFileSync call with '--diff-filter=D'").toBeDefined();
    expect(getOpts(call!).maxBuffer).toBeGreaterThanOrEqual(MIN_EXPECTED_BUFFER);
  });
});
