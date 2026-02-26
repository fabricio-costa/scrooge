#!/usr/bin/env node

/**
 * Scrooge SessionStart Hook for Claude Code
 *
 * Injects a repository index summary and behavioral directives at session start.
 * If the current working directory is an indexed git repo, returns additionalContext
 * with stats and tool preferences. Returns {} for non-indexed repos (zero overhead).
 *
 * Lightweight: imports only better-sqlite3 (no Scrooge dist, no tree-sitter).
 *
 * Usage in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "SessionStart": [{
 *       "hooks": [{ "type": "command", "command": "node /path/to/scrooge/bin/scrooge-session.mjs", "timeout": 3 }]
 *     }]
 *   }
 * }
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".scrooge", "scrooge.db");

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  // Quick check: if no DB file, nothing to do
  if (!existsSync(DB_PATH)) {
    process.stdout.write("{}");
    return;
  }

  let cwd;
  try {
    const payload = JSON.parse(input);
    cwd = payload.cwd;
  } catch {
    process.stdout.write("{}");
    return;
  }

  if (!cwd) {
    process.stdout.write("{}");
    return;
  }

  // Detect git repo root
  let repoPath;
  try {
    repoPath = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      timeout: 2000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  } catch {
    process.stdout.write("{}");
    return;
  }

  // Query index_meta for this repo
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

    try {
      const row = db.prepare("SELECT total_files, total_chunks, last_indexed_at, last_commit_sha FROM index_meta WHERE repo_path = ?").get(repoPath);

      if (!row) {
        process.stdout.write("{}");
        return;
      }

      const ago = timeAgo(row.last_indexed_at);
      const sha = row.last_commit_sha ? row.last_commit_sha.slice(0, 7) : "unknown";

      const context = [
        "## Scrooge Code Intelligence (active)",
        `Repository indexed: ${row.total_files.toLocaleString()} files / ${row.total_chunks.toLocaleString()} chunks.`,
        `Last indexed: ${ago} (commit ${sha}).`,
        "",
        "PREFER Scrooge tools for code exploration:",
        "- scrooge_search (not Grep) — ranked, sketch-compressed results",
        "- scrooge_map (not Glob+Read) — hierarchical repo overview",
        "- scrooge_lookup (not grep for definitions) — symbol def + usages",
        "- scrooge_deps (not grep for imports) — dependency graph",
        "Fall back to native Read/Grep only for exact file content or non-code files.",
      ].join("\n");

      process.stdout.write(JSON.stringify({ additionalContext: context }));
    } finally {
      db.close();
    }
  } catch {
    process.stdout.write("{}");
  }
}

function timeAgo(isoString) {
  if (!isoString) return "unknown";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

main().catch(() => {
  process.stdout.write("{}");
});
