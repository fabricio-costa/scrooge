#!/usr/bin/env node

/**
 * Scrooge Setup Script
 *
 * One-command setup: builds the project, registers the MCP server with Claude Code,
 * configures the PreToolUse hook, and optionally installs the pi.dev extension.
 *
 * Usage: npm run setup
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function log(symbol, message) {
  const prefix = symbol === "ok" ? "\x1b[32m✓\x1b[0m" : symbol === "skip" ? "\x1b[33m–\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`${prefix} ${message}`);
  results.push({ symbol, message });
}

function which(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── 1. Check Node.js version ──────────────────────────────────────────────────

const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 20) {
  console.error(`\x1b[31mError: Node.js >= 20 required (found ${process.version})\x1b[0m`);
  process.exit(1);
}

console.log("\nScrooge Setup");
console.log("─────────────\n");

// ── 2. Build if needed ────────────────────────────────────────────────────────

if (!existsSync(join(root, "dist", "index.js"))) {
  console.log("Building project...");
  try {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
    log("ok", "Build completed");
  } catch {
    log("fail", "Build failed");
    process.exit(1);
  }
} else {
  log("ok", "Build verified (dist/ exists)");
}

// ── 3. Register MCP server (Claude Code) ──────────────────────────────────────

const hasClaude = which("claude");

if (hasClaude) {
  try {
    // Remove existing registration (idempotent)
    try {
      execSync("claude mcp remove scrooge", { stdio: "pipe" });
    } catch {
      // Not registered yet — fine
    }

    const launcherPath = join(root, "bin", "scrooge-mcp.mjs");
    execSync(`claude mcp add -s user scrooge -- node ${launcherPath}`, { stdio: "pipe" });
    log("ok", "MCP server registered (user scope)");
  } catch (err) {
    log("fail", `MCP registration failed: ${err.message}`);
  }
} else {
  log("skip", "MCP server: skipped (claude CLI not found)");
}

// ── 4. Configure PreToolUse hook (user scope ~/.claude/settings.json) ─────────

if (hasClaude) {
  try {
    const userClaudeDir = join(homedir(), ".claude");
    const userSettingsPath = join(userClaudeDir, "settings.json");

    // Read existing settings or start fresh
    let settings = {};
    if (existsSync(userSettingsPath)) {
      try {
        settings = JSON.parse(readFileSync(userSettingsPath, "utf-8"));
      } catch {
        // Corrupted file — back up and start fresh
        writeFileSync(`${userSettingsPath}.bak`, readFileSync(userSettingsPath));
        settings = {};
      }
    } else {
      mkdirSync(userClaudeDir, { recursive: true });
    }

    // Ensure hooks.PreToolUse array exists
    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

    // Remove any existing scrooge entry
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((entry) => {
      const hooks = entry.hooks || [];
      return !hooks.some((h) => typeof h.command === "string" && h.command.includes("scrooge-hook.mjs"));
    });

    // Append fresh scrooge entry
    const hookCommand = `node ${join(root, "bin", "scrooge-hook.mjs")}`;
    settings.hooks.PreToolUse.push({
      matcher: "Write|Edit",
      hooks: [{ type: "command", command: hookCommand, timeout: 3 }],
    });

    writeFileSync(userSettingsPath, JSON.stringify(settings, null, 2) + "\n");
    log("ok", "PreToolUse hook configured (~/.claude/settings.json)");
  } catch (err) {
    log("fail", `Hook configuration failed: ${err.message}`);
  }
} else {
  log("skip", "PreToolUse hook: skipped (claude CLI not found)");
}

// ── 5. Configure PostToolUse hook (agent coverage tracking, user scope) ──────

if (hasClaude) {
  try {
    const userClaudeDir = join(homedir(), ".claude");
    const userSettingsPath = join(userClaudeDir, "settings.json");

    let settings = {};
    if (existsSync(userSettingsPath)) {
      try {
        settings = JSON.parse(readFileSync(userSettingsPath, "utf-8"));
      } catch {
        settings = {};
      }
    }

    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];

    // Remove any existing scrooge-observe entries
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter((entry) => {
      const hooks = entry.hooks || [];
      return !hooks.some((h) => typeof h.command === "string" && h.command.includes("scrooge-observe.mjs"));
    });

    // Append fresh entry (empty matcher = match all tools)
    const observeCommand = `node ${join(root, "bin", "scrooge-observe.mjs")}`;
    settings.hooks.PostToolUse.push({
      matcher: "",
      hooks: [{ type: "command", command: observeCommand, timeout: 3 }],
    });

    writeFileSync(userSettingsPath, JSON.stringify(settings, null, 2) + "\n");
    log("ok", "PostToolUse hook configured (~/.claude/settings.json)");
  } catch (err) {
    log("fail", `PostToolUse hook configuration failed: ${err.message}`);
  }
} else {
  log("skip", "PostToolUse hook: skipped (claude CLI not found)");
}

// ── 6. Generate project .claude/settings.json ─────────────────────────────────

try {
  const projectClaudeDir = join(root, ".claude");
  mkdirSync(projectClaudeDir, { recursive: true });

  const hookCommand = `node ${join(root, "bin", "scrooge-hook.mjs")}`;
  const observeCommand = `node ${join(root, "bin", "scrooge-observe.mjs")}`;
  const projectSettings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: hookCommand, timeout: 3 }],
        },
      ],
      PostToolUse: [
        {
          matcher: "",
          hooks: [{ type: "command", command: observeCommand, timeout: 3 }],
        },
      ],
    },
  };

  writeFileSync(join(projectClaudeDir, "settings.json"), JSON.stringify(projectSettings, null, 2) + "\n");
  log("ok", "Project settings generated (.claude/settings.json)");
} catch (err) {
  log("fail", `Project settings failed: ${err.message}`);
}

// ── 7. Register pi.dev extension (optional) ───────────────────────────────────

const hasPi = which("pi");

if (hasPi) {
  try {
    const extensionPath = join(root, "packages", "pi-extension");
    execSync(`pi install ${extensionPath}`, { stdio: "pipe" });
    log("ok", "pi.dev extension installed");
  } catch (err) {
    log("fail", `pi.dev extension failed: ${err.message}`);
  }
} else {
  log("skip", "pi.dev: skipped (pi CLI not found)");
}

// ── Summary ───────────────────────────────────────────────────────────────────

const hasFailure = results.some((r) => r.symbol === "fail");

console.log("");
if (!hasFailure) {
  console.log("Hook is active in all projects. Scrooge indexes repos on first query.");
} else {
  console.log("Setup completed with errors. Check messages above.");
}
console.log("\nTo uninstall: npm run uninstall\n");

process.exit(hasFailure ? 1 : 0);
