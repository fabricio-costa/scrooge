import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, insertChunk, getIndexMeta, upsertIndexMeta, deleteChunksByPath, getChunkIdsByPath, insertVecEmbedding, deleteVecByIds, type ChunkRow } from "../src/storage/db.js";
import type Database from "better-sqlite3";

let db: Database.Database;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("database setup", () => {
  it("should create all required tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain("chunks");
    expect(names).toContain("chunks_fts");
    expect(names).toContain("chunks_vec");
    expect(names).toContain("index_meta");
  });

  it("should have WAL journal mode", () => {
    const result = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe("wal");
  });

  it("should have sqlite-vec loaded", () => {
    const result = db.prepare("SELECT vec_version()").get() as Record<string, string>;
    expect(Object.values(result)[0]).toMatch(/^v\d/);
  });
});

describe("chunk operations", () => {
  const testChunk: Omit<ChunkRow, "created_at"> = {
    id: "test-chunk-001",
    repo_path: "/test/repo",
    commit_sha: "abc123",
    path: "app/src/main/LoginViewModel.kt",
    module: ":app",
    source_set: "main",
    language: "kotlin",
    kind: "class",
    symbol_name: "LoginViewModel",
    symbol_fqname: "com.example.LoginViewModel",
    signature: "class LoginViewModel @Inject constructor()",
    start_line: 1,
    end_line: 50,
    text_raw: "class LoginViewModel {}",
    text_sketch: "class LoginViewModel {}",
    tags: JSON.stringify(["hilt", "viewmodel"]),
    annotations: JSON.stringify(["@HiltViewModel"]),
    defines: JSON.stringify(["com.example.LoginViewModel"]),
    uses: JSON.stringify(["AuthRepository"]),
    content_hash: "abc123def456",
  };

  it("should insert and retrieve a chunk", () => {
    insertChunk(db, testChunk);

    const row = db.prepare("SELECT * FROM chunks WHERE id = ?").get(testChunk.id) as ChunkRow;
    expect(row).toBeDefined();
    expect(row.symbol_name).toBe("LoginViewModel");
    expect(row.language).toBe("kotlin");
    expect(row.kind).toBe("class");
  });

  it("should auto-sync FTS on insert", () => {
    insertChunk(db, testChunk);

    const ftsResult = db
      .prepare("SELECT * FROM chunks_fts WHERE chunks_fts MATCH ?")
      .all("LoginViewModel") as unknown[];
    expect(ftsResult.length).toBeGreaterThan(0);
  });

  it("should delete chunks by path", () => {
    insertChunk(db, testChunk);
    deleteChunksByPath(db, "/test/repo", testChunk.path);

    const row = db.prepare("SELECT * FROM chunks WHERE id = ?").get(testChunk.id);
    expect(row).toBeUndefined();
  });

  it("should get chunk IDs by path", () => {
    insertChunk(db, testChunk);
    const ids = getChunkIdsByPath(db, "/test/repo", testChunk.path);
    expect(ids).toContain(testChunk.id);
  });

  it("should upsert on duplicate ID", () => {
    insertChunk(db, testChunk);
    insertChunk(db, { ...testChunk, text_raw: "updated content" });

    const row = db.prepare("SELECT text_raw FROM chunks WHERE id = ?").get(testChunk.id) as { text_raw: string };
    expect(row.text_raw).toBe("updated content");
  });
});

describe("vector operations", () => {
  it("should insert and query vector embeddings", () => {
    const id = "vec-test-001";
    const embedding = new Float32Array(384).fill(0.1);

    insertVecEmbedding(db, id, embedding);

    const result = db
      .prepare("SELECT id FROM chunks_vec WHERE embedding MATCH ? AND k = 1")
      .get(embedding) as { id: string } | undefined;
    expect(result).toBeDefined();
    expect(result!.id).toBe(id);
  });

  it("should delete vectors by IDs", () => {
    const id = "vec-test-002";
    const embedding = new Float32Array(384).fill(0.2);

    insertVecEmbedding(db, id, embedding);
    deleteVecByIds(db, [id]);

    const count = db
      .prepare("SELECT COUNT(*) as cnt FROM chunks_vec")
      .get() as { cnt: number };
    expect(count.cnt).toBe(0);
  });
});

describe("index metadata", () => {
  it("should return null for non-indexed repo", () => {
    const meta = getIndexMeta(db, "/non/existent");
    expect(meta).toBeNull();
  });

  it("should upsert and retrieve index metadata", () => {
    upsertIndexMeta(db, {
      repo_path: "/test/repo",
      last_commit_sha: "abc123",
      last_indexed_at: "2024-01-01T00:00:00Z",
      total_chunks: 42,
      total_files: 10,
    });

    const meta = getIndexMeta(db, "/test/repo");
    expect(meta).toBeDefined();
    expect(meta!.last_commit_sha).toBe("abc123");
    expect(meta!.total_chunks).toBe(42);
  });

  it("should update existing metadata on upsert", () => {
    upsertIndexMeta(db, {
      repo_path: "/test/repo",
      last_commit_sha: "abc123",
      last_indexed_at: "2024-01-01T00:00:00Z",
      total_chunks: 42,
      total_files: 10,
    });

    upsertIndexMeta(db, {
      repo_path: "/test/repo",
      last_commit_sha: "def456",
      last_indexed_at: "2024-01-02T00:00:00Z",
      total_chunks: 55,
      total_files: 12,
    });

    const meta = getIndexMeta(db, "/test/repo");
    expect(meta!.last_commit_sha).toBe("def456");
    expect(meta!.total_chunks).toBe(55);
  });
});
