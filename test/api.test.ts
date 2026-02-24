import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, insertChunk, recordToolCall, upsertIndexMeta } from "../src/storage/db.js";
import { buildStatisticsReport } from "../src/api/statistics.js";
import type Database from "better-sqlite3";

let db: Database.Database;

const REPO_PATH = "/test/repo";

function insertTestChunks() {
  const chunks = [
    {
      id: "chunk-login-vm",
      repo_path: REPO_PATH,
      commit_sha: "abc",
      path: "app/src/main/LoginViewModel.kt",
      module: ":app",
      source_set: "main",
      language: "kotlin",
      kind: "viewmodel",
      symbol_name: "LoginViewModel",
      symbol_fqname: "com.example.LoginViewModel",
      signature: "class LoginViewModel @Inject constructor()",
      start_line: 1,
      end_line: 50,
      text_raw: "class LoginViewModel @Inject constructor(\n  private val authRepo: AuthRepository\n) : ViewModel() {\n  suspend fun authenticate(email: String, password: String): Boolean\n}",
      text_sketch: "@HiltViewModel\nclass LoginViewModel @Inject constructor()\n  val uiState: StateFlow<LoginUiState>\n  suspend fun authenticate(email: String, password: String): Boolean",
      tags: JSON.stringify(["hilt", "viewmodel"]),
      annotations: JSON.stringify(["@HiltViewModel"]),
      defines: JSON.stringify(["com.example.LoginViewModel"]),
      uses: JSON.stringify(["AuthRepository"]),
      content_hash: "hash1",
    },
    {
      id: "chunk-auth-repo",
      repo_path: REPO_PATH,
      commit_sha: "abc",
      path: "app/src/main/AuthRepository.kt",
      module: ":app",
      source_set: "main",
      language: "kotlin",
      kind: "class",
      symbol_name: "AuthRepository",
      symbol_fqname: "com.example.AuthRepository",
      signature: "class AuthRepository @Inject constructor()",
      start_line: 1,
      end_line: 30,
      text_raw: "class AuthRepository @Inject constructor(\n  private val api: ApiService\n) {\n  suspend fun login(email: String, password: String): Result<Token>\n}",
      text_sketch: "class AuthRepository @Inject constructor()\n  suspend fun login(email, password): Result<Token>",
      tags: JSON.stringify(["hilt"]),
      annotations: JSON.stringify(["@Inject"]),
      defines: JSON.stringify(["com.example.AuthRepository"]),
      uses: JSON.stringify(["ApiService"]),
      content_hash: "hash2",
    },
  ];

  for (const chunk of chunks) {
    insertChunk(db, chunk);
  }
}

beforeEach(() => {
  db = openDb(":memory:");
  insertTestChunks();
});

afterEach(() => {
  db.close();
});

describe("schema migration v3 — channel column", () => {
  it("should have channel column in tool_calls table", () => {
    const columns = db
      .prepare("PRAGMA table_info(tool_calls)")
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain("channel");
  });

  it("should default channel to 'mcp'", () => {
    recordToolCall(db, {
      tool: "search",
      repo_path: REPO_PATH,
      duration_ms: 100,
      tokens_sent: 500,
      tokens_raw: 3000,
    });

    const row = db.prepare("SELECT channel FROM tool_calls LIMIT 1").get() as { channel: string };
    expect(row.channel).toBe("mcp");
  });

  it("should persist explicit channel value", () => {
    recordToolCall(db, {
      tool: "search",
      repo_path: REPO_PATH,
      duration_ms: 100,
      tokens_sent: 500,
      tokens_raw: 3000,
      channel: "pi",
    });

    const row = db.prepare("SELECT channel FROM tool_calls LIMIT 1").get() as { channel: string };
    expect(row.channel).toBe("pi");
  });

  it("should persist test channel value", () => {
    recordToolCall(db, {
      tool: "lookup",
      repo_path: REPO_PATH,
      duration_ms: 50,
      tokens_sent: 200,
      tokens_raw: 1000,
      channel: "test",
    });

    const row = db.prepare("SELECT channel FROM tool_calls LIMIT 1").get() as { channel: string };
    expect(row.channel).toBe("test");
  });
});

describe("channel breakdown in statistics", () => {
  it("should show channel breakdown when multiple channels exist", () => {
    recordToolCall(db, {
      tool: "search",
      repo_path: REPO_PATH,
      duration_ms: 100,
      tokens_sent: 500,
      tokens_raw: 3000,
      channel: "mcp",
    });
    recordToolCall(db, {
      tool: "search",
      repo_path: REPO_PATH,
      duration_ms: 100,
      tokens_sent: 500,
      tokens_raw: 3000,
      channel: "mcp",
    });
    recordToolCall(db, {
      tool: "search",
      repo_path: REPO_PATH,
      duration_ms: 100,
      tokens_sent: 500,
      tokens_raw: 3000,
      channel: "pi",
    });

    const report = buildStatisticsReport(db, REPO_PATH, "all");
    expect(report).toContain("Channels");
    expect(report).toContain("mcp: 2");
    expect(report).toContain("pi: 1");
  });

  it("should not show channel breakdown with single channel", () => {
    recordToolCall(db, {
      tool: "search",
      repo_path: REPO_PATH,
      duration_ms: 100,
      tokens_sent: 500,
      tokens_raw: 3000,
      channel: "mcp",
    });

    const report = buildStatisticsReport(db, REPO_PATH, "all");
    expect(report).not.toContain("Channels");
  });
});

describe("index_meta for status", () => {
  it("should return null for non-indexed repo", () => {
    const meta = db
      .prepare("SELECT * FROM index_meta WHERE repo_path = ?")
      .get("/non/existent") as Record<string, unknown> | undefined;
    expect(meta).toBeUndefined();
  });

  it("should return meta after upsert", () => {
    upsertIndexMeta(db, {
      repo_path: REPO_PATH,
      last_commit_sha: "abc123",
      last_indexed_at: "2026-02-24 12:00:00",
      total_chunks: 42,
      total_files: 10,
    });

    const meta = db
      .prepare("SELECT * FROM index_meta WHERE repo_path = ?")
      .get(REPO_PATH) as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.total_chunks).toBe(42);
    expect(meta.total_files).toBe(10);
  });
});

describe("lookup SQL queries in api layer", () => {
  it("should find definitions by symbol_name", () => {
    const defs = db
      .prepare(`
        SELECT * FROM chunks
        WHERE repo_path = ? AND symbol_name = ?
        ORDER BY kind, path
      `)
      .all(REPO_PATH, "LoginViewModel") as Array<{ symbol_name: string }>;

    expect(defs).toHaveLength(1);
    expect(defs[0].symbol_name).toBe("LoginViewModel");
  });

  it("should find usages via uses LIKE", () => {
    const usages = db
      .prepare(`
        SELECT * FROM chunks
        WHERE repo_path = ? AND uses LIKE ? AND symbol_name != ?
        ORDER BY path, start_line
      `)
      .all(REPO_PATH, `%"AuthRepository"%`, "AuthRepository") as Array<{ symbol_name: string }>;

    expect(usages).toHaveLength(1);
    expect(usages[0].symbol_name).toBe("LoginViewModel");
  });

  it("should find usages via FTS", () => {
    const ftsUsages = db
      .prepare(`
        SELECT c.* FROM chunks_fts fts
        JOIN chunks c ON c.rowid = fts.rowid
        WHERE chunks_fts MATCH ? AND c.repo_path = ? AND c.symbol_name != ?
        LIMIT 20
      `)
      .all(`"AuthRepository"`, REPO_PATH, "AuthRepository") as Array<{ symbol_name: string }>;

    expect(ftsUsages.length).toBeGreaterThanOrEqual(1);
  });

  it("should deduplicate LIKE and FTS results", () => {
    const usages = db
      .prepare(`
        SELECT * FROM chunks
        WHERE repo_path = ? AND uses LIKE ? AND symbol_name != ?
        ORDER BY path, start_line
      `)
      .all(REPO_PATH, `%"AuthRepository"%`, "AuthRepository") as Array<{ id: string; symbol_name: string }>;

    const ftsUsages = db
      .prepare(`
        SELECT c.* FROM chunks_fts fts
        JOIN chunks c ON c.rowid = fts.rowid
        WHERE chunks_fts MATCH ? AND c.repo_path = ? AND c.symbol_name != ?
        LIMIT 20
      `)
      .all(`"AuthRepository"`, REPO_PATH, "AuthRepository") as Array<{ id: string; symbol_name: string }>;

    // Deduplicate
    const seenIds = new Set(usages.map((u) => u.id));
    const merged = [...usages];
    for (const u of ftsUsages) {
      if (!seenIds.has(u.id)) {
        merged.push(u);
        seenIds.add(u.id);
      }
    }

    // No duplicates
    const ids = merged.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
