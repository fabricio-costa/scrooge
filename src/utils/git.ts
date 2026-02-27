import { execFileSync } from "node:child_process";

const SHA_RE = /^[0-9a-f]{4,40}$/i;
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
const MAX_BUFFER = 50 * 1024 * 1024; // 50MB — enough for repos with 100k+ files

function assertSha(value: string, label: string): void {
  if (!SHA_RE.test(value)) {
    throw new Error(`Invalid ${label}: must be a hex SHA`);
  }
}

export function getHeadCommit(repoPath: string): string {
  return execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], {
    cwd: repoPath,
    encoding: "utf-8",
    env: GIT_ENV,
  }).trim();
}

export function getChangedFiles(repoPath: string, fromCommit: string, toCommit: string = "HEAD"): string[] {
  assertSha(fromCommit, "fromCommit");
  if (toCommit !== "HEAD") assertSha(toCommit, "toCommit");

  const output = execFileSync("git", ["--no-optional-locks", "diff", "--name-only", `${fromCommit}..${toCommit}`], {
    cwd: repoPath,
    encoding: "utf-8",
    env: GIT_ENV,
    maxBuffer: MAX_BUFFER,
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function getDeletedFiles(repoPath: string, fromCommit: string, toCommit: string = "HEAD"): string[] {
  assertSha(fromCommit, "fromCommit");
  if (toCommit !== "HEAD") assertSha(toCommit, "toCommit");

  const output = execFileSync("git", ["--no-optional-locks", "diff", "--name-only", "--diff-filter=D", `${fromCommit}..${toCommit}`], {
    cwd: repoPath,
    encoding: "utf-8",
    env: GIT_ENV,
    maxBuffer: MAX_BUFFER,
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function getTrackedFiles(repoPath: string): string[] {
  const output = execFileSync("git", ["--no-optional-locks", "ls-files"], {
    cwd: repoPath,
    encoding: "utf-8",
    env: GIT_ENV,
    maxBuffer: MAX_BUFFER,
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function isGitRepo(repoPath: string): boolean {
  try {
    execFileSync("git", ["--no-optional-locks", "rev-parse", "--is-inside-work-tree"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: GIT_ENV,
    });
    return true;
  } catch {
    return false;
  }
}
