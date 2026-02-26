#!/usr/bin/env node

/**
 * Scrooge Setup Script
 *
 * One-command setup: builds the project, registers the MCP server with Claude Code,
 * configures the PreToolUse hook, and optionally installs the pi.dev extension.
 *
 * Usage: npm run setup
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    execFileSync("which", [cmd], { stdio: "pipe" });
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
      execFileSync("claude", ["mcp", "remove", "scrooge"], { stdio: "pipe" });
    } catch {
      // Not registered yet — fine
    }

    const launcherPath = join(root, "bin", "scrooge-mcp.mjs");
    execFileSync("claude", ["mcp", "add", "-s", "user", "scrooge", "--", "node", launcherPath], { stdio: "pipe" });
    log("ok", "MCP server registered (user scope)");
  } catch (err) {
    log("fail", `MCP registration failed: ${err.message}`);
  }
} else {
  log("skip", "MCP server: skipped (claude CLI not found)");
}

// ── 4. Configure all hooks (user scope ~/.claude/settings.json) ──────────────

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

    if (!settings.hooks) settings.hooks = {};

    // Helper: filter out scrooge entries from a hook array
    const filterScrooge = (arr, pattern) =>
      (arr || []).filter((entry) => {
        const hooks = entry.hooks || [];
        return !hooks.some((h) => typeof h.command === "string" && h.command.includes(pattern));
      });

    // --- PreToolUse: context injection (Write|Edit) + nudge (Read|Grep|Glob) ---
    settings.hooks.PreToolUse = filterScrooge(settings.hooks.PreToolUse, "scrooge-hook.mjs");
    settings.hooks.PreToolUse = filterScrooge(settings.hooks.PreToolUse, "scrooge-nudge.mjs");

    settings.hooks.PreToolUse.push({
      matcher: "Write|Edit",
      hooks: [{ type: "command", command: `node ${join(root, "bin", "scrooge-hook.mjs")}`, timeout: 3 }],
    });
    settings.hooks.PreToolUse.push({
      matcher: "Read|Grep|Glob",
      hooks: [{ type: "command", command: `node ${join(root, "bin", "scrooge-nudge.mjs")}`, timeout: 2 }],
    });
    log("ok", "PreToolUse hooks configured (Write|Edit → patterns, Read|Grep|Glob → nudge)");

    // --- PostToolUse: observability ---
    settings.hooks.PostToolUse = filterScrooge(settings.hooks.PostToolUse, "scrooge-observe.mjs");
    settings.hooks.PostToolUse.push({
      matcher: "",
      hooks: [{ type: "command", command: `node ${join(root, "bin", "scrooge-observe.mjs")}`, timeout: 3 }],
    });
    log("ok", "PostToolUse hook configured (observability)");

    // --- SessionStart: onboarding ---
    if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
    settings.hooks.SessionStart = filterScrooge(settings.hooks.SessionStart, "scrooge-session.mjs");
    settings.hooks.SessionStart.push({
      hooks: [{ type: "command", command: `node ${join(root, "bin", "scrooge-session.mjs")}`, timeout: 3 }],
    });
    log("ok", "SessionStart hook configured (onboarding)");

    writeFileSync(userSettingsPath, JSON.stringify(settings, null, 2) + "\n");
  } catch (err) {
    log("fail", `Hook configuration failed: ${err.message}`);
  }
} else {
  log("skip", "Hooks: skipped (claude CLI not found)");
}

// ── 5. Generate project .claude/settings.json ─────────────────────────────────

try {
  const projectClaudeDir = join(root, ".claude");
  mkdirSync(projectClaudeDir, { recursive: true });

  const projectSettings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: `node ${join(root, "bin", "scrooge-hook.mjs")}`, timeout: 3 }],
        },
        {
          matcher: "Read|Grep|Glob",
          hooks: [{ type: "command", command: `node ${join(root, "bin", "scrooge-nudge.mjs")}`, timeout: 2 }],
        },
      ],
      PostToolUse: [
        {
          matcher: "",
          hooks: [{ type: "command", command: `node ${join(root, "bin", "scrooge-observe.mjs")}`, timeout: 3 }],
        },
      ],
      SessionStart: [
        {
          hooks: [{ type: "command", command: `node ${join(root, "bin", "scrooge-session.mjs")}`, timeout: 3 }],
        },
      ],
    },
  };

  writeFileSync(join(projectClaudeDir, "settings.json"), JSON.stringify(projectSettings, null, 2) + "\n");
  log("ok", "Project settings generated (.claude/settings.json)");
} catch (err) {
  log("fail", `Project settings failed: ${err.message}`);
}

// ── 6. Register pi.dev extension (optional) ───────────────────────────────────

const hasPi = which("pi");

if (hasPi) {
  try {
    const extensionPath = join(root, "packages", "pi-extension");
    execFileSync("pi", ["install", extensionPath], { stdio: "pipe" });
    log("ok", "pi.dev extension installed");
  } catch (err) {
    log("fail", `pi.dev extension failed: ${err.message}`);
  }
} else {
  log("skip", "pi.dev: skipped (pi CLI not found)");
}

// ── 7. Manage pi.dev AGENTS.md ──────────────────────────────────────────────

if (hasPi) {
  try {
    managePiAgentsMd("install");
  } catch (err) {
    log("fail", `Pi.dev AGENTS.md failed: ${err.message}`);
  }
} else {
  log("skip", "Pi.dev AGENTS.md: skipped (pi CLI not found)");
}

// ── 8. Save agent instructions template ─────────────────────────────────────

try {
  const scroogeDir = join(homedir(), ".scrooge");
  mkdirSync(scroogeDir, { recursive: true });
  const templateSrc = join(root, "templates", "agent-instructions.md");
  const templateDest = join(scroogeDir, "agent-instructions.md");
  copyFileSync(templateSrc, templateDest);
  log("ok", "Template saved to ~/.scrooge/agent-instructions.md");
} catch (err) {
  log("fail", `Template copy failed: ${err.message}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

const hasFailure = results.some((r) => r.symbol === "fail");

console.log("");
if (!hasFailure) {
  console.log("Hook is active in all projects. Scrooge indexes repos on first query.");
} else {
  console.log("Setup completed with errors. Check messages above.");
}
console.log("\nTo add Scrooge instructions to a project's CLAUDE.md:");
console.log("  cat ~/.scrooge/agent-instructions.md");
console.log("\nTo uninstall: npm run uninstall\n");

process.exit(hasFailure ? 1 : 0);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Manage the Scrooge section in ~/.pi/agent/AGENTS.md.
 *
 * Safety protocol:
 * - NEVER overwrites or deletes user content
 * - Uses HTML markers to delimit the Scrooge section
 * - Creates backup before any modification
 * - Uninstall removes only the Scrooge section
 */
function managePiAgentsMd(action) {
  const MARKER_START = "<!-- scrooge:start v1 -->";
  const MARKER_END = "<!-- scrooge:end -->";

  const agentsMdPath = join(homedir(), ".pi", "agent", "AGENTS.md");
  const templatePath = join(root, "templates", "agent-instructions.md");

  if (action === "install") {
    const template = readFileSync(templatePath, "utf-8");
    const section = `${MARKER_START}\n${template.trimEnd()}\n${MARKER_END}`;

    if (!existsSync(agentsMdPath)) {
      // Create new file with only the Scrooge section
      mkdirSync(dirname(agentsMdPath), { recursive: true });
      writeFileSync(agentsMdPath, section + "\n");
      log("ok", "Pi.dev AGENTS.md created with Scrooge instructions");
      return;
    }

    const content = readFileSync(agentsMdPath, "utf-8");

    // Backup before modification
    writeFileSync(`${agentsMdPath}.scrooge-bak`, content);

    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      // Update existing section (replace between markers)
      const before = content.slice(0, startIdx);
      const after = content.slice(endIdx + MARKER_END.length);
      writeFileSync(agentsMdPath, before + section + after);
      log("ok", "Pi.dev AGENTS.md updated with Scrooge instructions");
    } else {
      // Append to end (preserve existing content)
      const separator = content.endsWith("\n") ? "\n" : "\n\n";
      writeFileSync(agentsMdPath, content + separator + section + "\n");
      log("ok", "Pi.dev AGENTS.md appended with Scrooge instructions");
    }
  } else if (action === "uninstall") {
    if (!existsSync(agentsMdPath)) return;

    const content = readFileSync(agentsMdPath, "utf-8");
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    if (startIdx === -1 || endIdx === -1) {
      log("skip", "Pi.dev AGENTS.md: no Scrooge section found");
      return;
    }

    // Backup before modification
    writeFileSync(`${agentsMdPath}.scrooge-bak`, content);

    // Remove the Scrooge section (including markers and surrounding newlines)
    let before = content.slice(0, startIdx);
    let after = content.slice(endIdx + MARKER_END.length);

    // Clean up extra newlines at the boundary
    before = before.replace(/\n+$/, before.trim() ? "\n" : "");
    after = after.replace(/^\n+/, after.trim() ? "\n" : "");

    writeFileSync(agentsMdPath, before + after);
    log("ok", "Scrooge section removed from Pi.dev AGENTS.md");
  }
}
