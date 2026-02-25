import { openDb } from "../storage/db.js";
import { getConfig } from "../utils/config.js";
import { validateRepoPath } from "../utils/path-validation.js";
import type { ApiContext } from "./types.js";

export async function health(ctx: ApiContext): Promise<{ status: string }> {
  const repoPath = validateRepoPath(ctx.repoPath ?? process.cwd());
  const config = getConfig();
  const db = openDb(ctx.dbPath ?? config.dbPath);
  try {
    const count = db.prepare("SELECT count(*) as n FROM chunks WHERE repo_path = ?").get(repoPath) as { n: number };
    return { status: count.n > 0 ? "healthy" : "empty" };
  } finally {
    db.close();
  }
}
