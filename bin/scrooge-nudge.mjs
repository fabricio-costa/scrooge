#!/usr/bin/env node

/**
 * Scrooge PreToolUse Nudge Hook for Claude Code
 *
 * Intercepts Read/Grep/Glob operations and suggests Scrooge alternatives.
 * Rate-limited to max 3 nudges per session to avoid being invasive.
 *
 * Lightweight: only checks DB file existence + reads/writes a temp file
 * for rate limiting. No Scrooge dist imports.
 *
 * Usage in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "matcher": "Read|Grep|Glob",
 *       "hooks": [{ "type": "command", "command": "node /path/to/scrooge/bin/scrooge-nudge.mjs", "timeout": 2 }]
 *     }]
 *   }
 * }
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB_PATH = join(homedir(), ".scrooge", "scrooge.db");
const MAX_NUDGES = 3;

const NUDGES = {
  Grep: "Scrooge tip: scrooge_search returns ranked, sketch-compressed results across the entire codebase. Try scrooge_search instead of Grep for code exploration.",
  Glob: "Scrooge tip: scrooge_map provides a hierarchical repo overview with summaries. Try scrooge_map instead of Glob for understanding project structure.",
  Read: "Scrooge tip: scrooge_lookup finds a symbol's definition and all usages in one call. Try it before reading multiple files.",
};

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  // Quick check: if no DB, nothing to do
  if (!existsSync(DB_PATH)) {
    process.stdout.write("{}");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.stdout.write("{}");
    return;
  }

  const toolName = payload.tool_name;
  const sessionId = payload.session_id ?? "default";

  if (!toolName || !NUDGES[toolName]) {
    process.stdout.write("{}");
    return;
  }

  // For Read: only nudge on code files, not config/docs
  if (toolName === "Read") {
    const filePath = payload.tool_input?.file_path ?? "";
    const ext = filePath.split(".").pop();
    const codeExts = ["kt", "ts", "tsx", "js", "jsx", "dart", "py", "rb", "go", "rs", "java"];
    if (!ext || !codeExts.includes(ext)) {
      process.stdout.write("{}");
      return;
    }
  }

  // Rate limiting via temp file
  const ratePath = join(tmpdir(), `scrooge-nudge-${sessionId.replace(/[^a-zA-Z0-9-]/g, "_")}`);
  let count = 0;

  try {
    if (existsSync(ratePath)) {
      count = parseInt(readFileSync(ratePath, "utf-8").trim(), 10) || 0;
    }
  } catch {
    // Ignore read errors
  }

  if (count >= MAX_NUDGES) {
    process.stdout.write("{}");
    return;
  }

  // Increment counter
  try {
    writeFileSync(ratePath, String(count + 1));
  } catch {
    // Ignore write errors
  }

  process.stdout.write(JSON.stringify({ additionalContext: NUDGES[toolName] }));
}

main().catch(() => {
  process.stdout.write("{}");
});
