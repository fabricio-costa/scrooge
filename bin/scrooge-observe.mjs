#!/usr/bin/env node

/**
 * Scrooge PostToolUse Hook for Claude Code
 *
 * Observes ALL agent tool calls after execution and appends a compact
 * record to ~/.scrooge/observed.jsonl. Used to compute agent coverage
 * metrics (what % of exploration used Scrooge vs native tools).
 *
 * Lightweight: no Scrooge dist imports (avoids loading better-sqlite3,
 * tree-sitter, etc.). Pure Node.js stdlib for ~5ms execution.
 *
 * Usage in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "",
 *       "hooks": [{ "type": "command", "command": "node /path/to/scrooge/bin/scrooge-observe.mjs", "timeout": 3 }]
 *     }]
 *   }
 * }
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }

  const toolName = payload.tool_name;
  if (!toolName) return;

  const scroogeDir = join(homedir(), ".scrooge");
  mkdirSync(scroogeDir, { recursive: true });

  const record = JSON.stringify({
    t: new Date().toISOString(),
    tool: toolName,
    repo: payload.cwd ?? "",
    sid: payload.session_id ?? "",
  });

  appendFileSync(join(scroogeDir, "observed.jsonl"), record + "\n");
}

main().catch(() => {});
