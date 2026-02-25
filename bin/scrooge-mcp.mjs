#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Check if native modules are compatible with this Node version.
// When users have multiple Node versions (e.g. Node 20 + Node 24 via nvm),
// better-sqlite3's .node binary must match the running Node's MODULE_VERSION.
try {
  execFileSync(process.execPath, [
    "-e",
    `require(${JSON.stringify(join(root, "node_modules", "better-sqlite3"))})`,
  ], { stdio: "pipe", timeout: 5000 });
} catch {
  process.stderr.write(
    `[scrooge] Native modules don't match Node ${process.version}, rebuilding...\n`
  );
  try {
    // Use process.execPath as npm's node to ensure rebuild targets the correct version.
    // npm is invoked via PATH but NODE is forced to match the running process.
    execFileSync("npm", ["rebuild", "better-sqlite3", "tree-sitter", "--loglevel=error"], {
      cwd: root,
      env: { ...process.env, npm_config_node_gyp_force_process_config: "true" },
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 120000, // 2 min — C++ compilation can be slow
    });
    process.stderr.write("[scrooge] Rebuild complete.\n");
  } catch (err) {
    process.stderr.write(
      `[scrooge] Rebuild failed: ${err.message}\n` +
      `[scrooge] Try: cd ${root} && npm rebuild better-sqlite3\n`
    );
    process.exit(1);
  }
}

// Start the MCP server
await import(join(root, "dist", "index.js"));
