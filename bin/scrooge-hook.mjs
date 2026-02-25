#!/usr/bin/env node

/**
 * Scrooge PreToolUse Hook for Claude Code
 *
 * Reads tool invocation from stdin and injects project patterns
 * as additional context before Write/Edit operations on supported files.
 *
 * Usage in .claude/settings.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "matcher": "Write|Edit",
 *       "command": "node /path/to/scrooge/bin/scrooge-hook.mjs"
 *     }]
 *   }
 * }
 */

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_EXTENSIONS = ["kt", "ts", "tsx", "dart", "py"];
const TIMEOUT_MS = 1500;

async function main() {
  // Read stdin
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    // Invalid JSON — skip
    process.stdout.write("{}");
    return;
  }

  const toolInput = payload.tool_input ?? {};
  const filePath = toolInput.file_path;

  if (!filePath) {
    process.stdout.write("{}");
    return;
  }

  // Check file extension
  const ext = filePath.split(".").pop();
  if (!ext || !SUPPORTED_EXTENSIONS.includes(ext)) {
    process.stdout.write("{}");
    return;
  }

  try {
    // Detect repo root
    const repoPath = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      timeout: TIMEOUT_MS,
    }).trim();

    // Import the context API directly (no MCP overhead)
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const { context } = await import(join(root, "dist", "api", "context.js"));

    // Use AbortController for timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const result = await context(
        { kind: "function" },
        { channel: "cli", repoPath },
      );

      clearTimeout(timer);

      if (!result || result.sampleCount === 0) {
        process.stdout.write("{}");
        return;
      }

      const lines = ["## Project Patterns (auto-injected by Scrooge)"];
      if (result.commonAnnotations.length > 0) {
        lines.push(`Annotations: ${result.commonAnnotations.join(", ")}`);
      }
      if (result.commonImports.length > 0) {
        lines.push(`Common imports: ${result.commonImports.join(", ")}`);
      }
      if (result.commonTags.length > 0) {
        lines.push(`Tags: ${result.commonTags.join(", ")}`);
      }
      if (result.exampleSketches.length > 0) {
        lines.push("Example:");
        lines.push(result.exampleSketches[0].sketch);
      }

      process.stdout.write(JSON.stringify({ additionalContext: lines.join("\n") }));
    } catch {
      clearTimeout(timer);
      process.stdout.write("{}");
    }
  } catch {
    // Not a git repo, DB doesn't exist, or timeout — silent failure
    process.stdout.write("{}");
  }
}

main();
