#!/usr/bin/env node
import { startServer } from "./server/mcp.js";

startServer().catch((err) => {
  console.error("Failed to start Scrooge MCP server:", err);
  process.exit(1);
});
