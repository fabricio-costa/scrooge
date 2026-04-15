#!/usr/bin/env node

/**
 * Scrooge SessionStart Hook for Claude Code
 *
 * Injects a repository index summary and behavioral directives at session start.
 * If the current working directory is an indexed git repo, returns additionalContext
 * with stats and tool preferences. For non-indexed git repos, suggests running
 * scrooge_reindex to enable code intelligence.
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
import { normalizeGuardrailPolicy } from "./hook-state.mjs";

function getPolicySummary() {
  switch (normalizeGuardrailPolicy()) {
    case "off":
      return "Native exploration policy: off — Scrooge is still preferred, but Read/Grep/Glob are not intercepted.";
    case "strict":
      return "Native exploration policy: strict — blind code exploration via Read/Grep/Glob is blocked; keep native tools for non-code files, regex on a known path, or guided follow-up reads.";
    case "warn":
    default:
      return "Native exploration policy: warn — blind/native exploration is nudged toward Scrooge first.";
  }
}

const DB_PATH = process.env.SCROOGE_DB_PATH || join(homedir(), ".scrooge", "scrooge.db");

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

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

  // If no DB file, suggest indexing for git repos
  if (!existsSync(DB_PATH)) {
    const context = [
      "## Scrooge Code Intelligence (available)",
      "This repository has not been indexed yet.",
      "Run `scrooge_reindex` to enable code-aware search, symbol lookup, and repo maps.",
      "After indexing, PREFER Scrooge tools over native Read/Grep/Glob for code exploration.",
      getPolicySummary(),
    ].join("\n");
    process.stdout.write(JSON.stringify({ additionalContext: context }));
    return;
  }

  // Query index_meta for this repo
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

    try {
      const row = db.prepare("SELECT total_files, total_chunks, last_indexed_at, last_commit_sha FROM index_meta WHERE repo_path = ?").get(repoPath);

      if (!row) {
        const context = [
          "## Scrooge Code Intelligence (available)",
          "This repository has not been indexed yet.",
          "Run `scrooge_reindex` to enable code-aware search, symbol lookup, and repo maps.",
          "After indexing, PREFER Scrooge tools over native Read/Grep/Glob for code exploration.",
          getPolicySummary(),
        ].join("\n");
        process.stdout.write(JSON.stringify({ additionalContext: context }));
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
        "- If you know the exact symbol: scrooge_lookup first, then scrooge_source for exact code",
        "- If you know the concept but not the symbol: scrooge_search with view: \"implementation\"",
        "- If you already know the symbol or chunk ID and want exact code: scrooge_source (not full-file Read)",
        "- If you need repository structure: scrooge_map (not Glob+Read)",
        "- If you need refactoring blast radius: scrooge_deps (not grep for imports)",
        "Do not use Read to discover code. Use Scrooge first, then read only the exact file or slice you need.",
        "Fall back to native Read/Grep only for exact file content, non-code files, or regex on a known path.",
        getPolicySummary(),
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
