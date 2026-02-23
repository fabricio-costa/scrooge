import { execSync } from "node:child_process";

export function getHeadCommit(repoPath: string): string {
  return execSync("git rev-parse HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}

export function getChangedFiles(repoPath: string, fromCommit: string, toCommit: string = "HEAD"): string[] {
  const output = execSync(`git diff --name-only ${fromCommit}..${toCommit}`, {
    cwd: repoPath,
    encoding: "utf-8",
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function getDeletedFiles(repoPath: string, fromCommit: string, toCommit: string = "HEAD"): string[] {
  const output = execSync(`git diff --name-only --diff-filter=D ${fromCommit}..${toCommit}`, {
    cwd: repoPath,
    encoding: "utf-8",
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function getTrackedFiles(repoPath: string): string[] {
  const output = execSync("git ls-files", {
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
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}
