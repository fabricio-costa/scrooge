import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerStatusTool } from "./tools/status.js";
import { registerSearchTool } from "./tools/search.js";
import { registerMapTool } from "./tools/map.js";
import { registerLookupTool } from "./tools/lookup.js";
import { registerReindexTool } from "./tools/reindex.js";
import { registerStatisticsTool } from "./tools/statistics.js";
import { registerContextTool } from "./tools/context.js";
import { registerDepsTool } from "./tools/deps.js";
import { registerExportTool } from "./tools/export.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "scrooge",
    version: "0.1.0",
  });

  registerStatusTool(server);
  registerSearchTool(server);
  registerMapTool(server);
  registerLookupTool(server);
  registerReindexTool(server);
  registerStatisticsTool(server);
  registerContextTool(server);
  registerDepsTool(server);
  registerExportTool(server);

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
