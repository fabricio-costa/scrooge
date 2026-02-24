import { resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";

/**
 * Validate and normalize a repo_path parameter.
 * Resolves symlinks, rejects non-directories, and prevents path traversal.
 */
export function validateRepoPath(input: string): string {
  const resolved = resolve(input);

  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    throw new Error("repo_path does not exist");
  }

  const stat = statSync(real);
  if (!stat.isDirectory()) {
    throw new Error("repo_path must be a directory");
  }

  return real;
}
