#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Check if native modules are compatible with this Node version
try {
  execFileSync(process.execPath, [
    "-e",
    `require(${JSON.stringify(join(root, "node_modules", "better-sqlite3"))})`,
  ], { stdio: "pipe", timeout: 5000 });
} catch {
  process.stderr.write(
    `[scrooge] Native modules don't match Node ${process.version}, rebuilding...\n`
  );
  execSync("npm rebuild better-sqlite3 tree-sitter --loglevel=error", {
    cwd: root,
    stdio: ["pipe", "pipe", "inherit"],
  });
  process.stderr.write("[scrooge] Rebuild complete.\n");
}

// Start the MCP server
await import(join(root, "dist", "index.js"));
