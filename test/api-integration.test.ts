import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, insertChunk, upsertIndexMeta, recordToolCall } from "../src/storage/db.js";
import type { ApiContext } from "../src/api/types.js";

// ---------------------------------------------------------------------------
// Mocks — must be top-level (vitest hoists these)
// ---------------------------------------------------------------------------

vi.mock("../src/utils/freshness.js", () => ({
  ensureFreshIndex: vi.fn().mockResolvedValue({ reindexed: false, reason: "up_to_date" }),
  formatReindexNote: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/utils/git.js", () => ({
  isGitRepo: vi.fn().mockReturnValue(true),
  getHeadCommit: vi.fn().mockReturnValue("abc123"),
  getChangedFiles: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/indexer/pipeline.js", () => ({
  runPipeline: vi.fn().mockResolvedValue({
    filesProcessed: 10,
    chunksCreated: 50,
    chunksRemoved: 2,
    timeMs: 1200,
  }),
}));

vi.mock("../src/retrieval/hybrid.js", () => ({
  hybridSearch: vi.fn().mockResolvedValue({
    results: [
      {
        chunk: {
          id: "c1",
          path: "LoginViewModel.kt",
          kind: "viewmodel",
          symbol_name: "LoginViewModel",
          signature: "class LoginViewModel @Inject constructor() : ViewModel()",
          text_raw: "class LoginViewModel @Inject constructor() : ViewModel() {\n  fun login() {}\n}",
          text_sketch: "class LoginViewModel()",
          start_line: 1,
          end_line: 30,
          module: ":app",
          language: "kotlin",
          tags: "[]",
          annotations: '["@Inject"]',
          uses: '["AuthRepository"]',
        },
        score: 0.85,
        source: "both" as const,
        rank: 1,
      },
    ],
    metrics: {
      lexicalCandidates: 5,
      vectorCandidates: 3,
      candidatesBeforeFusion: 8,
      rrfK: 60,
      rerankedCount: 1,
      query: {
        terms: ["login"],
        exactTerms: [],
        expansions: [],
        aliasesUsed: [],
        variants: ["broad"],
        languageHints: [],
        kindHints: [],
      },
      scores: [
        {
          chunkId: "c1",
          rrfScore: 0.85,
          rerankScore: 0.02,
          finalScore: 0.87,
          lexicalRank: 1,
          vectorRank: 2,
          lexicalScore: 0.9,
          vectorDistance: 0.3,
          lexicalVariants: ["broad"],
          reasons: ["header_overlap"],
        },
      ],
    },
  }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks so vitest can hoist correctly
// ---------------------------------------------------------------------------

import { lookup } from "../src/api/lookup.js";
import { source } from "../src/api/source.js";
import { map } from "../src/api/map.js";
import { status } from "../src/api/status.js";
import { health } from "../src/api/health.js";
import { reindex } from "../src/api/reindex.js";
import { search } from "../src/api/search.js";
import { statistics } from "../src/api/statistics.js";
import { exportData } from "../src/api/export.js";
import { isGitRepo } from "../src/utils/git.js";
import { hybridSearch } from "../src/retrieval/hybrid.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_PATH = process.cwd();
let dbPath: string;
let tmpDir: string;

function ctx(overrides: Partial<ApiContext> = {}): ApiContext {
  return { channel: "test", repoPath: REPO_PATH, dbPath, ...overrides };
}

function makeChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: `chunk-${Math.random().toString(36).slice(2)}`,
    repo_path: REPO_PATH,
    commit_sha: "abc123",
    path: "app/src/main/LoginViewModel.kt",
    module: ":app",
    source_set: "main",
    language: "kotlin",
    kind: "viewmodel",
    symbol_name: "LoginViewModel",
    symbol_fqname: "com.example.LoginViewModel",
    signature: "class LoginViewModel()",
    start_line: 1,
    end_line: 30,
    text_raw:
      "class LoginViewModel @Inject constructor(private val repo: AuthRepository) : ViewModel() { fun login() { } }",
    text_sketch: "class LoginViewModel @Inject constructor(…) : ViewModel()",
    tags: JSON.stringify(["hilt", "viewmodel"]),
    annotations: JSON.stringify(["@HiltViewModel", "@Inject"]),
    defines: JSON.stringify(["com.example.LoginViewModel"]),
    uses: JSON.stringify(["AuthRepository", "StateFlow"]),
    content_hash: `hash-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared DB seeding
// ---------------------------------------------------------------------------

beforeAll(() => {
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "scrooge-api-test-")));
  dbPath = join(tmpDir, "test.db");

  mkdirSync(join(tmpDir, "src"), { recursive: true });
  writeFileSync(
    join(tmpDir, "src", "ExactSource.ts"),
    [
      'import type { Payload } from "./types";',
      'const prefix = "cw";',
      "",
      "export function buildPayload(input: string): Payload {",
      "  const normalized = input.trim();",
      "  return { value: `${prefix}:${normalized}` };",
      "}",
      "",
      "export function other(): Payload {",
      "  return { value: prefix };",
      "}",
      "",
    ].join("\n"),
  );

  const db = openDb(dbPath);

  insertChunk(db, makeChunk({ id: "c-login-vm" }));

  insertChunk(
    db,
    makeChunk({
      id: "c-auth-repo",
      path: "data/src/main/AuthRepository.kt",
      module: ":data",
      kind: "class",
      symbol_name: "AuthRepository",
      symbol_fqname: "com.example.AuthRepository",
      signature: "class AuthRepository()",
      text_raw:
        "class AuthRepository @Inject constructor(private val api: ApiService) { suspend fun login() {} }",
      text_sketch: "class AuthRepository @Inject constructor(…)",
      uses: JSON.stringify(["ApiService"]),
      defines: JSON.stringify(["com.example.AuthRepository"]),
    }),
  );

  insertChunk(
    db,
    makeChunk({
      id: "c-api-service",
      path: "api/src/main/ApiService.kt",
      module: ":api",
      kind: "api_interface",
      symbol_name: "ApiService",
      symbol_fqname: "com.example.ApiService",
      signature: "interface ApiService",
      text_raw: 'interface ApiService { @GET("/user") suspend fun getUser(): User }',
      text_sketch: "interface ApiService { fun getUser(): User }",
      uses: JSON.stringify([]),
      defines: JSON.stringify(["com.example.ApiService"]),
    }),
  );

  insertChunk(
    db,
    makeChunk({
      id: "c-main-activity",
      path: "app/src/main/MainActivity.kt",
      module: ":app",
      kind: "class",
      symbol_name: "MainActivity",
      symbol_fqname: "com.example.MainActivity",
      signature: "class MainActivity()",
      language: "kotlin",
      text_raw: "class MainActivity : ComponentActivity() { override fun onCreate() {} }",
      text_sketch: "class MainActivity : ComponentActivity()",
      uses: JSON.stringify(["LoginViewModel"]),
      defines: JSON.stringify(["com.example.MainActivity"]),
    }),
  );

  insertChunk(
    db,
    makeChunk({
      id: "c-build-gradle",
      path: "app/build.gradle.kts",
      module: ":app",
      kind: "build_config",
      symbol_name: null,
      symbol_fqname: null,
      language: "gradle",
      text_raw: 'plugins { id("com.android.application") }',
      text_sketch: "plugins { android-application }",
      uses: JSON.stringify([]),
      defines: JSON.stringify([]),
      tags: JSON.stringify(["gradle"]),
      annotations: JSON.stringify([]),
    }),
  );

  insertChunk(
    db,
    makeChunk({
      id: "c-exact-source",
      repo_path: tmpDir,
      path: "src/ExactSource.ts",
      module: ":app",
      source_set: "main",
      language: "typescript",
      kind: "function",
      symbol_name: "buildPayload",
      symbol_fqname: "buildPayload",
      signature: "export function buildPayload(input: string): Payload",
      start_line: 4,
      end_line: 7,
      text_raw: [
        "export function buildPayload(input: string): Payload {",
        "  const normalized = input.trim();",
        "  return { value: `${prefix}:${normalized}` };",
        "}",
      ].join("\n"),
      text_sketch: "export function buildPayload(input: string): Payload",
      tags: JSON.stringify([]),
      annotations: JSON.stringify([]),
      defines: JSON.stringify(["buildPayload"]),
      uses: JSON.stringify(["Payload"]),
    }),
  );

  upsertIndexMeta(db, {
    repo_path: REPO_PATH,
    last_commit_sha: "abc123",
    last_indexed_at: new Date().toISOString(),
    total_chunks: 5,
    total_files: 5,
  });

  // Seed some tool_calls for export tests
  recordToolCall(db, {
    tool: "lookup",
    repo_path: REPO_PATH,
    duration_ms: 42,
    tokens_sent: 200,
    tokens_raw: 800,
    channel: "test",
    metadata: { symbol: "LoginViewModel" },
  });
  recordToolCall(db, {
    tool: "search",
    repo_path: REPO_PATH,
    duration_ms: 100,
    tokens_sent: 500,
    tokens_raw: 3000,
    channel: "test",
    metadata: { query: "login", resultCount: 3 },
  });

  db.close();
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// lookup()
// ===========================================================================

describe("lookup()", () => {
  it("finds definition by exact symbol_name", async () => {
    const result = await lookup({ symbol: "LoginViewModel" }, ctx());

    expect(result.symbol).toBe("LoginViewModel");
    expect(result.definitions.length).toBeGreaterThanOrEqual(1);
    expect(result.definitions.some((d) => d.symbol === "LoginViewModel")).toBe(true);
    expect(result.definitions[0].id).toBeDefined();
    expect(result.definitions[0].language).toBe("kotlin");
    expect(result.definitions[0].signature).toContain("LoginViewModel");
  });

  it("finds definitions + usages with deduplication", async () => {
    const result = await lookup({ symbol: "AuthRepository" }, ctx());

    expect(result.definitions.some((d) => d.symbol === "AuthRepository")).toBe(true);
    expect(result.usages).toBeDefined();
    // LoginViewModel uses AuthRepository
    expect(result.usages!.some((u) => u.symbol === "LoginViewModel")).toBe(true);
  });

  it("returns no usages property when includeUsages is false", async () => {
    const result = await lookup({ symbol: "LoginViewModel", includeUsages: false }, ctx());

    expect(result.definitions.length).toBeGreaterThanOrEqual(1);
    expect(result.usages).toBeUndefined();
  });

  it("records telemetry in tool_calls", async () => {
    await lookup({ symbol: "ApiService" }, ctx());

    const db = openDb(dbPath);
    try {
      const row = db
        .prepare("SELECT * FROM tool_calls WHERE tool = 'lookup' ORDER BY id DESC LIMIT 1")
        .get() as { tool: string; repo_path: string; metadata: string };
      expect(row.tool).toBe("lookup");
      expect(row.repo_path).toBe(REPO_PATH);
      const meta = JSON.parse(row.metadata) as { symbol: string };
      expect(meta.symbol).toBe("ApiService");
    } finally {
      db.close();
    }
  });
});

// ===========================================================================
// source()
// ===========================================================================

describe("source()", () => {
  it("finds exact source by chunkId with surrounding context", async () => {
    const result = await source({ chunkId: "c-exact-source", before: 2, after: 2 }, ctx({ repoPath: tmpDir }));

    expect(result.chunkId).toBe("c-exact-source");
    expect(result.before).toBe(2);
    expect(result.after).toBe(2);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].symbol).toBe("buildPayload");
    expect(result.chunks[0].source).toContain("const normalized = input.trim()");
    expect(result.chunks[0].beforeContext?.text).toContain('const prefix = "cw";');
    expect(result.chunks[0].afterContext?.text).toContain("export function other(): Payload {");
  });

  it("finds source by symbol", async () => {
    const result = await source({ symbol: "buildPayload" }, ctx({ repoPath: tmpDir }));

    expect(result.symbol).toBe("buildPayload");
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].id).toBe("c-exact-source");
  });

  it("records telemetry in tool_calls", async () => {
    await source({ symbol: "buildPayload" }, ctx({ repoPath: tmpDir }));

    const db = openDb(dbPath);
    try {
      const row = db
        .prepare("SELECT * FROM tool_calls WHERE tool = 'source' ORDER BY id DESC LIMIT 1")
        .get() as { tool: string; repo_path: string; metadata: string };
      expect(row.tool).toBe("source");
      expect(row.repo_path).toBe(tmpDir);
      const meta = JSON.parse(row.metadata) as { symbol: string; chunkCount: number };
      expect(meta.symbol).toBe("buildPayload");
      expect(meta.chunkCount).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rejects requests without chunkId or symbol", async () => {
    await expect(source({}, ctx())).rejects.toThrow("Provide chunkId or symbol");
  });
});

// ===========================================================================
// map()
// ===========================================================================

describe("map()", () => {
  it("returns directory tree at repo level", async () => {
    const result = await map({ level: "repo" }, ctx());

    expect(result.content).toContain("Directory Tree");
    expect(result.content).toContain("```");
  });

  it("returns per-file symbols at files level", async () => {
    const result = await map({ level: "files" }, ctx());

    expect(result.content).toContain("LoginViewModel.kt");
    expect(result.content).toContain("LoginViewModel");
  });

  it("filters by module", async () => {
    const result = await map({ level: "files", module: ":data" }, ctx());

    expect(result.content).toContain("AuthRepository");
    expect(result.content).not.toContain("LoginViewModel");
    expect(result.content).not.toContain("MainActivity");
  });
});

// ===========================================================================
// status()
// ===========================================================================

describe("status()", () => {
  it("returns indexed status with metadata", async () => {
    const result = await status(ctx());

    expect(result.status).toBe("indexed");
    expect(result.total_chunks).toBe(5);
    expect(result.total_files).toBe(5);
    expect(result.last_commit_sha).toBe("abc123");
    expect(result.freshness).toBe("up_to_date");
  });

  it("returns not_indexed for repo with no index_meta", async () => {
    // tmpDir is a valid directory but has no index_meta seeded for it
    const result = await status(ctx({ repoPath: tmpDir }));

    expect(result.status).toBe("not_indexed");
    expect(result.message).toContain("not been indexed");
  });
});

// ===========================================================================
// health()
// ===========================================================================

describe("health()", () => {
  it("returns healthy for repo with chunks", async () => {
    const result = await health(ctx());

    expect(result.status).toBe("healthy");
  });

  it("returns empty for repo with no chunks", async () => {
    const emptyRepo = join(tmpDir, "empty-repo");
    mkdirSync(emptyRepo, { recursive: true });

    const result = await health(ctx({ repoPath: emptyRepo }));

    expect(result.status).toBe("empty");
  });
});

// ===========================================================================
// reindex()
// ===========================================================================

describe("reindex()", () => {
  it("returns success on reindex", async () => {
    const result = await reindex({}, ctx());

    expect(result.status).toBe("success");
    expect(result.stats).toBeDefined();
    expect(result.stats!.filesProcessed).toBe(10);
    expect(result.stats!.chunksCreated).toBe(50);
  });

  it("returns error for non-git repo", async () => {
    vi.mocked(isGitRepo).mockReturnValueOnce(false);
    const result = await reindex({}, ctx());

    expect(result.status).toBe("error");
    expect(result.error).toContain("Not a git repository");
  });
});

// ===========================================================================
// search()
// ===========================================================================

describe("search()", () => {
  it("returns packaged results", async () => {
    const result = await search({ query: "login" }, ctx());

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.results[0].id).toBe("c1");
    expect(result.results[0].module).toBe(":app");
    expect(result.results[0].language).toBe("kotlin");
    expect(result.results[0].signature).toContain("LoginViewModel");
    expect(result.results[0].uses).toContain("AuthRepository");
  });

  it("supports implementation view with focused highlights", async () => {
    const result = await search({ query: "login", view: "implementation" }, ctx());

    expect(result.results[0].snippet).toContain("class LoginViewModel @Inject constructor() : ViewModel()");
    expect(result.results[0].highlights).toContain("fun login() {}");
  });

  it("records enriched telemetry with timing and retrieval metadata", async () => {
    await search({ query: "login telemetry" }, ctx());

    const db = openDb(dbPath);
    try {
      const row = db
        .prepare("SELECT * FROM tool_calls WHERE tool = 'search' ORDER BY id DESC LIMIT 1")
        .get() as { metadata: string };
      const meta = JSON.parse(row.metadata) as Record<string, unknown>;
      expect(meta).toHaveProperty("timing");
      expect(meta).toHaveProperty("retrieval");
      expect(meta).toHaveProperty("rewrite");
      expect(meta).toHaveProperty("rerank");
      expect(meta).toHaveProperty("packager");
      expect(meta).toHaveProperty("topScores");
    } finally {
      db.close();
    }
  });

  it("handles empty results", async () => {
    vi.mocked(hybridSearch).mockResolvedValueOnce({
      results: [],
      metrics: {
        lexicalCandidates: 0,
        vectorCandidates: 0,
        candidatesBeforeFusion: 0,
        rrfK: 60,
        rerankedCount: 0,
        query: {
          terms: [],
          exactTerms: [],
          expansions: [],
          aliasesUsed: [],
          variants: [],
          languageHints: [],
          kindHints: [],
        },
        scores: [],
      },
    });

    const result = await search({ query: "nonexistent" }, ctx());

    expect(result.results).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
  });
});

// ===========================================================================
// exportData()
// ===========================================================================

describe("statistics()", () => {
  it("returns text report plus structured dashboard data", async () => {
    const statsRepo = join(tmpDir, "stats-repo");
    mkdirSync(statsRepo, { recursive: true });

    const statsDb = openDb(dbPath);
    try {
      recordToolCall(statsDb, {
        tool: "lookup",
        repo_path: statsRepo,
        duration_ms: 42,
        tokens_sent: 200,
        tokens_raw: 800,
        channel: "test",
        metadata: { symbol: "LoginViewModel" },
      });
      recordToolCall(statsDb, {
        tool: "search",
        repo_path: statsRepo,
        duration_ms: 100,
        tokens_sent: 500,
        tokens_raw: 3000,
        channel: "test",
        metadata: { query: "login", resultCount: 3 },
      });
    } finally {
      statsDb.close();
    }

    const result = await statistics({ period: "all", format: "json" }, ctx({ repoPath: statsRepo }));

    expect(result.format).toBe("json");
    expect(result.report).toContain("Scrooge Statistics");
    expect(result.data.repo.path).toBe(statsRepo);
    expect(result.data.totals).toEqual({
      totalCalls: 2,
      tokensDelivered: 700,
      rawEquivalent: 3800,
      tokensSaved: 3100,
      savingsPct: 81.6,
    });
    expect(result.data.usageByTool.map((tool) => tool.tool)).toEqual(["lookup", "search"]);
    expect(result.data.searchInsights).toEqual({
      callCount: 1,
      avgResults: 3,
      avgTokens: 500,
      sourceCounts: { lexical: 0, vector: 0, both: 0 },
      sourceMixPct: { lexical: 0, vector: 0, both: 0 },
    });
  });
});

describe("exportData()", () => {
  it("exports seeded tool_calls as JSONL", async () => {
    const result = await exportData({}, ctx());

    expect(result.format).toBe("jsonl");
    // We seeded 2 tool_calls + additional ones from earlier tests
    expect(result.count).toBeGreaterThanOrEqual(2);
  });

  it("filters by tool name", async () => {
    const result = await exportData({ tool: "lookup" }, ctx());

    expect(result.count).toBeGreaterThanOrEqual(1);
    for (const record of result.records) {
      expect(record.tool).toBe("lookup");
    }
  });

  it("anonymize strips query and hashes repo", async () => {
    const result = await exportData({ anonymize: true }, ctx());

    expect(result.count).toBeGreaterThanOrEqual(1);

    // Find a search record that would have had a query
    const searchRecord = result.records.find((r) => r.tool === "search");
    if (searchRecord) {
      expect(searchRecord.query).toBeUndefined();
      // Repo should be an 8-char hex hash, not the real path
      expect(searchRecord.repo).toHaveLength(8);
      expect(searchRecord.repo).not.toContain("/");
    }

    // All records should have hashed repo
    for (const record of result.records) {
      expect(record.repo).toHaveLength(8);
      // Date should be truncated to date-only (YYYY-MM-DD)
      expect(record.called_at).toHaveLength(10);
    }
  });
});
