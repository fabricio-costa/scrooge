import { execFileSync } from "node:child_process";

const SHA_RE = /^[0-9a-f]{4,40}$/i;

function assertSha(value: string, label: string): void {
  if (!SHA_RE.test(value)) {
    throw new Error(`Invalid ${label}: must be a hex SHA`);
  }
}

export function getHeadCommit(repoPath: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}

export function getChangedFiles(repoPath: string, fromCommit: string, toCommit: string = "HEAD"): string[] {
  assertSha(fromCommit, "fromCommit");
  if (toCommit !== "HEAD") assertSha(toCommit, "toCommit");

  const output = execFileSync("git", ["diff", "--name-only", `${fromCommit}..${toCommit}`], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function getDeletedFiles(repoPath: string, fromCommit: string, toCommit: string = "HEAD"): string[] {
  assertSha(fromCommit, "fromCommit");
  if (toCommit !== "HEAD") assertSha(toCommit, "toCommit");

  const output = execFileSync("git", ["diff", "--name-only", "--diff-filter=D", `${fromCommit}..${toCommit}`], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function getTrackedFiles(repoPath: string): string[] {
  const output = execFileSync("git", ["ls-files"], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function isGitRepo(repoPath: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}
