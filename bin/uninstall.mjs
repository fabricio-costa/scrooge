#!/usr/bin/env node

/**
 * Scrooge Uninstall Script
 *
 * Removes MCP registration, PreToolUse hook, pi.dev extension,
 * and project settings. Does NOT delete ~/.scrooge/scrooge.db (user data).
 *
 * Usage: npm run uninstall
 */

import { execSync } from "node:child_process";
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
    execSync(`which ${cmd}`, { stdio: "pipe" });
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
    execSync("claude mcp remove scrooge", { stdio: "pipe" });
    log("ok", "MCP server removed");
  } catch {
    log("skip", "MCP server: not registered");
  }
} else {
  log("skip", "MCP server: skipped (claude CLI not found)");
}

// ── 2. Remove scrooge hook from ~/.claude/settings.json ──────────────────────

const userSettingsPath = join(homedir(), ".claude", "settings.json");

if (existsSync(userSettingsPath)) {
  try {
    const settings = JSON.parse(readFileSync(userSettingsPath, "utf-8"));

    if (settings.hooks && Array.isArray(settings.hooks.PreToolUse)) {
      const before = settings.hooks.PreToolUse.length;
      settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((entry) => {
        const hooks = entry.hooks || [];
        return !hooks.some((h) => typeof h.command === "string" && h.command.includes("scrooge-hook.mjs"));
      });
      const after = settings.hooks.PreToolUse.length;

      if (before !== after) {
        writeFileSync(userSettingsPath, JSON.stringify(settings, null, 2) + "\n");
        log("ok", "PreToolUse hook removed (~/.claude/settings.json)");
      } else {
        log("skip", "PreToolUse hook: not found in settings");
      }
    } else {
      log("skip", "PreToolUse hook: no hooks configured");
    }
  } catch (err) {
    log("fail", `Hook removal failed: ${err.message}`);
  }
} else {
  log("skip", "PreToolUse hook: ~/.claude/settings.json not found");
}

// ── 3. Remove pi.dev extension ───────────────────────────────────────────────

if (which("pi")) {
  try {
    const extensionPath = join(root, "packages", "pi-extension");
    execSync(`pi remove ${extensionPath}`, { stdio: "pipe" });
    log("ok", "pi.dev extension removed");
  } catch {
    log("skip", "pi.dev extension: not installed");
  }
} else {
  log("skip", "pi.dev: skipped (pi CLI not found)");
}

// ── 4. Remove project .claude/settings.json ──────────────────────────────────

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

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("");
console.log("Scrooge database (~/.scrooge/scrooge.db) was NOT deleted.");
console.log("To remove it: rm -rf ~/.scrooge\n");
