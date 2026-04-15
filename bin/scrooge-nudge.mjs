#!/usr/bin/env node

/**
 * Scrooge PreToolUse Nudge Hook for Claude Code
 *
 * Intercepts Read/Grep/Glob operations and applies Scrooge guardrails.
 * In warn mode it suggests alternatives (rate-limited to max 3 nudges/session).
 * In strict mode it blocks blind code exploration on indexed repos.
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

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getGuardrailDecision, getNudgeMessage, recordNudge } from "./hook-state.mjs";

function buildBlockResponse(message) {
  return {
    continue: false,
    stopReason: message,
    reason: "Blocked by Scrooge strict native-exploration policy.",
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: message,
      additionalContext: message,
    },
  };
}

const DB_PATH = process.env.SCROOGE_DB_PATH || join(homedir(), ".scrooge", "scrooge.db");

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

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
  if (typeof toolName !== "string") {
    process.stdout.write("{}");
    return;
  }

  const decision = getGuardrailDecision(toolName, payload);
  if (!decision) {
    process.stdout.write("{}");
    return;
  }

  if (decision.action === "block") {
    process.stdout.write(JSON.stringify(buildBlockResponse(decision.message)));
    return;
  }

  const nudge = getNudgeMessage(toolName, payload);
  if (!nudge) {
    process.stdout.write("{}");
    return;
  }

  recordNudge(nudge.sessionId);
  process.stdout.write(JSON.stringify({ additionalContext: nudge.message }));
}

main().catch(() => {
  process.stdout.write("{}");
});
