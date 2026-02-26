#!/usr/bin/env node

/**
 * Scrooge Uninstall Script
 *
 * Removes MCP registration, all hooks, pi.dev extension + AGENTS.md section,
 * project settings, and generated files. Does NOT delete ~/.scrooge/scrooge.db (user data).
 *
 * Usage: npm run uninstall
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function log(symbol, message) {
  const prefix = symbol === "ok" ? "\x1b[32m✓\x1b[0m" : symbol === "skip" ? "\x1b[33m–\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`${prefix} ${message}`);
}

function which(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

console.log("\nScrooge Uninstall");
console.log("─────────────────\n");

// ── 1. Remove MCP registration ───────────────────────────────────────────────

if (which("claude")) {
  try {
    execFileSync("claude", ["mcp", "remove", "scrooge"], { stdio: "pipe" });
    log("ok", "MCP server removed");
  } catch {
    log("skip", "MCP server: not registered");
  }
} else {
  log("skip", "MCP server: skipped (claude CLI not found)");
}

// ── 2. Remove all scrooge hooks from ~/.claude/settings.json ────────────────

const userSettingsPath = join(homedir(), ".claude", "settings.json");

if (existsSync(userSettingsPath)) {
  try {
    const settings = JSON.parse(readFileSync(userSettingsPath, "utf-8"));
    let modified = false;

    // Helper: filter out scrooge entries from a hook array
    const filterScrooge = (arr, pattern) =>
      (arr || []).filter((entry) => {
        const hooks = entry.hooks || [];
        return !hooks.some((h) => typeof h.command === "string" && h.command.includes(pattern));
      });

    // Remove PreToolUse hooks (context + nudge)
    if (settings.hooks && Array.isArray(settings.hooks.PreToolUse)) {
      const before = settings.hooks.PreToolUse.length;
      settings.hooks.PreToolUse = filterScrooge(settings.hooks.PreToolUse, "scrooge-hook.mjs");
      settings.hooks.PreToolUse = filterScrooge(settings.hooks.PreToolUse, "scrooge-nudge.mjs");
      if (before !== settings.hooks.PreToolUse.length) {
        modified = true;
        log("ok", "PreToolUse hooks removed");
      } else {
        log("skip", "PreToolUse hooks: not found");
      }
    }

    // Remove PostToolUse hook (observability)
    if (settings.hooks && Array.isArray(settings.hooks.PostToolUse)) {
      const before = settings.hooks.PostToolUse.length;
      settings.hooks.PostToolUse = filterScrooge(settings.hooks.PostToolUse, "scrooge-observe.mjs");
      if (before !== settings.hooks.PostToolUse.length) {
        modified = true;
        log("ok", "PostToolUse hook removed");
      } else {
        log("skip", "PostToolUse hook: not found");
      }
    }

    // Remove SessionStart hook (onboarding)
    if (settings.hooks && Array.isArray(settings.hooks.SessionStart)) {
      const before = settings.hooks.SessionStart.length;
      settings.hooks.SessionStart = filterScrooge(settings.hooks.SessionStart, "scrooge-session.mjs");
      if (before !== settings.hooks.SessionStart.length) {
        modified = true;
        log("ok", "SessionStart hook removed");
      } else {
        log("skip", "SessionStart hook: not found");
      }
    }

    if (modified) {
      writeFileSync(userSettingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
  } catch (err) {
    log("fail", `Hook removal failed: ${err.message}`);
  }
} else {
  log("skip", "Hooks: ~/.claude/settings.json not found");
}

// ── 3. Remove pi.dev extension ───────────────────────────────────────────────

if (which("pi")) {
  try {
    const extensionPath = join(root, "packages", "pi-extension");
    execFileSync("pi", ["remove", extensionPath], { stdio: "pipe" });
    log("ok", "pi.dev extension removed");
  } catch {
    log("skip", "pi.dev extension: not installed");
  }
} else {
  log("skip", "pi.dev: skipped (pi CLI not found)");
}

// ── 4. Remove Scrooge section from pi.dev AGENTS.md ─────────────────────────

{
  const MARKER_START = "<!-- scrooge:start v1 -->";
  const MARKER_END = "<!-- scrooge:end -->";
  const agentsMdPath = join(homedir(), ".pi", "agent", "AGENTS.md");

  if (existsSync(agentsMdPath)) {
    try {
      const content = readFileSync(agentsMdPath, "utf-8");
      const startIdx = content.indexOf(MARKER_START);
      const endIdx = content.indexOf(MARKER_END);

      if (startIdx !== -1 && endIdx !== -1) {
        // Backup before modification
        writeFileSync(`${agentsMdPath}.scrooge-bak`, content);

        let before = content.slice(0, startIdx);
        let after = content.slice(endIdx + MARKER_END.length);

        // Clean up extra newlines at the boundary
        before = before.replace(/\n+$/, before.trim() ? "\n" : "");
        after = after.replace(/^\n+/, after.trim() ? "\n" : "");

        writeFileSync(agentsMdPath, before + after);
        log("ok", "Scrooge section removed from Pi.dev AGENTS.md");
      } else {
        log("skip", "Pi.dev AGENTS.md: no Scrooge section found");
      }
    } catch (err) {
      log("fail", `Pi.dev AGENTS.md cleanup failed: ${err.message}`);
    }
  } else {
    log("skip", "Pi.dev AGENTS.md: not found");
  }
}

// ── 5. Remove project .claude/settings.json ──────────────────────────────────

const projectSettingsPath = join(root, ".claude", "settings.json");

if (existsSync(projectSettingsPath)) {
  try {
    unlinkSync(projectSettingsPath);
    log("ok", "Project settings removed (.claude/settings.json)");
  } catch (err) {
    log("fail", `Project settings removal failed: ${err.message}`);
  }
} else {
  log("skip", "Project settings: not found");
}

// ── 6. Remove generated files ───────────────────────────────────────────────

const generatedFiles = [
  { path: join(homedir(), ".scrooge", "observed.jsonl"), label: "Observed data" },
  { path: join(homedir(), ".scrooge", "agent-instructions.md"), label: "Agent instructions template" },
];

for (const { path, label } of generatedFiles) {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
      log("ok", `${label} removed`);
    } catch (err) {
      log("fail", `${label} removal failed: ${err.message}`);
    }
  } else {
    log("skip", `${label}: not found`);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("");
console.log("Scrooge database (~/.scrooge/scrooge.db) was NOT deleted.");
console.log("To remove it: rm -rf ~/.scrooge\n");
