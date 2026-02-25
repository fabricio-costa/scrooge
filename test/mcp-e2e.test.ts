import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Mock all API functions before importing the server
vi.mock("../src/api/search.js", () => ({
  search: vi.fn().mockResolvedValue({
    results: [
      {
        file: "LoginViewModel.kt",
        kind: "viewmodel",
        name: "LoginViewModel",
        sketch: "class LoginViewModel()",
        score: 0.85,
      },
    ],
    totalTokens: 100,
    truncated: false,
    sources: { lexical: 1, vector: 0, both: 0 },
  }),
}));

vi.mock("../src/api/lookup.js", () => ({
  lookup: vi.fn().mockResolvedValue({
    symbol: "LoginViewModel",
    definitions: [
      {
        path: "LoginViewModel.kt",
        lines: "1-30",
        kind: "viewmodel",
        symbol: "LoginViewModel",
        module: ":app",
        sketch: "class LoginViewModel()",
      },
    ],
    usages: [],
  }),
}));

vi.mock("../src/api/map.js", () => ({
  map: vi.fn().mockResolvedValue({
    content: "## Directory Tree\n```\napp/\n  src/\n```",
  }),
}));

vi.mock("../src/api/reindex.js", () => ({
  reindex: vi.fn().mockResolvedValue({
    status: "success",
    repo: "scrooge",
    stats: { filesProcessed: 10, chunksCreated: 50 },
  }),
}));

vi.mock("../src/api/status.js", () => ({
  status: vi.fn().mockResolvedValue({
    status: "indexed",
    repo: "scrooge",
    total_chunks: 100,
    total_files: 20,
  }),
}));

vi.mock("../src/api/statistics.js", () => ({
  statistics: vi.fn().mockResolvedValue({
    report: "## Scrooge Statistics\nTokens delivered: 1000\nSaved: 500 (50%)",
  }),
  getDateFilter: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/api/context.js", () => ({
  context: vi.fn().mockResolvedValue({
    kind: "viewmodel",
    sampleCount: 5,
    commonAnnotations: ["@HiltViewModel"],
    commonTags: ["hilt"],
    commonImports: ["StateFlow"],
    exampleSketches: [
      { path: "LoginViewModel.kt", sketch: "class LoginViewModel()" },
    ],
  }),
}));

vi.mock("../src/api/deps.js", () => ({
  deps: vi.fn().mockResolvedValue({
    symbol: "AuthRepository",
    definitions: [
      {
        symbol: "AuthRepository",
        path: "AuthRepository.kt",
        kind: "class",
        module: ":data",
      },
    ],
    forward: [
      {
        symbol: "ApiService",
        path: "ApiService.kt",
        kind: "api_interface",
        module: ":api",
      },
    ],
    reverse: [
      {
        symbol: "LoginViewModel",
        path: "LoginViewModel.kt",
        kind: "viewmodel",
        module: ":app",
      },
    ],
  }),
}));

vi.mock("../src/api/export.js", () => ({
  exportData: vi.fn().mockResolvedValue({
    records: [],
    format: "jsonl",
    count: 0,
  }),
  formatAsJsonl: vi.fn().mockReturnValue(""),
  formatAsCsv: vi.fn().mockReturnValue(""),
}));

import { createServer } from "../src/server/mcp.js";

let client: Client;
let serverCleanup: () => Promise<void>;

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "1.0.0" }, {});
  await client.connect(clientTransport);

  serverCleanup = async () => {
    await client.close();
    await server.close();
  };
});

afterAll(async () => {
  await serverCleanup();
});

describe("tool registration", () => {
  it("lists all 9 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "scrooge_context",
      "scrooge_deps",
      "scrooge_export",
      "scrooge_lookup",
      "scrooge_map",
      "scrooge_reindex",
      "scrooge_search",
      "scrooge_statistics",
      "scrooge_status",
    ]);
  });
});

describe("tool invocation", () => {
  it("scrooge_search returns JSON result", async () => {
    const result = await client.callTool({
      name: "scrooge_search",
      arguments: { query: "login" },
    });
    expect(result.content).toBeInstanceOf(Array);
    expect((result.content as Array<{ type: string }>).length).toBeGreaterThan(
      0,
    );
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("results");
    expect(parsed).toHaveProperty("totalTokens");
  });

  it("scrooge_lookup returns JSON result", async () => {
    const result = await client.callTool({
      name: "scrooge_lookup",
      arguments: { symbol: "LoginViewModel" },
    });
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("symbol", "LoginViewModel");
    expect(parsed).toHaveProperty("definitions");
  });

  it("scrooge_map returns text content", async () => {
    const result = await client.callTool({
      name: "scrooge_map",
      arguments: {},
    });
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    expect(first.text).toContain("Directory Tree");
  });

  it("scrooge_reindex returns JSON result", async () => {
    const result = await client.callTool({
      name: "scrooge_reindex",
      arguments: {},
    });
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("status", "success");
    expect(parsed).toHaveProperty("repo", "scrooge");
  });

  it("scrooge_status returns JSON result", async () => {
    const result = await client.callTool({
      name: "scrooge_status",
      arguments: {},
    });
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("status", "indexed");
    expect(parsed).toHaveProperty("total_chunks", 100);
  });

  it("scrooge_statistics returns text report", async () => {
    const result = await client.callTool({
      name: "scrooge_statistics",
      arguments: {},
    });
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    expect(first.text).toContain("Scrooge Statistics");
    expect(first.text).toContain("Saved");
  });

  it("scrooge_context returns JSON result", async () => {
    const result = await client.callTool({
      name: "scrooge_context",
      arguments: { kind: "viewmodel" },
    });
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("kind", "viewmodel");
    expect(parsed).toHaveProperty("commonAnnotations");
    expect(parsed).toHaveProperty("exampleSketches");
  });

  it("scrooge_deps returns JSON result", async () => {
    const result = await client.callTool({
      name: "scrooge_deps",
      arguments: { symbol: "AuthRepository" },
    });
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("symbol", "AuthRepository");
    expect(parsed).toHaveProperty("forward");
    expect(parsed).toHaveProperty("reverse");
  });

  it("scrooge_export returns text content", async () => {
    const result = await client.callTool({
      name: "scrooge_export",
      arguments: {},
    });
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.type).toBe("text");
    // With empty records, formatAsJsonl returns "" so fallback is "No records found."
    expect(typeof first.text).toBe("string");
  });
});

describe("zod validation", () => {
  it("rejects missing required param for scrooge_search", async () => {
    const result = await client.callTool({
      name: "scrooge_search",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.text).toMatch(/invalid/i);
  });

  it("rejects invalid param type for scrooge_search", async () => {
    const result = await client.callTool({
      name: "scrooge_search",
      arguments: { query: "test", max_results: "abc" },
    });
    expect(result.isError).toBe(true);
    const first = (result.content as Array<{ type: string; text: string }>)[0]!;
    expect(first.text).toMatch(/invalid/i);
  });
});
