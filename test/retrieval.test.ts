import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, insertChunk, insertVecEmbedding } from "../src/storage/db.js";
import { lexicalSearch } from "../src/retrieval/lexical.js";
import { packageResults } from "../src/retrieval/packager.js";
import type Database from "better-sqlite3";
import type { SearchResult } from "../src/retrieval/lexical.js";

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
      text_sketch: "class AuthRepository\n  suspend fun login(email: String, password: String): Result<Token>",
      tags: JSON.stringify(["hilt"]),
      annotations: null,
      defines: JSON.stringify(["com.example.AuthRepository"]),
      uses: JSON.stringify(["ApiService"]),
      content_hash: "hash2",
    },
    {
      id: "chunk-api-service",
      repo_path: REPO_PATH,
      commit_sha: "abc",
      path: "app/src/main/ApiService.kt",
      module: ":app",
      source_set: "main",
      language: "kotlin",
      kind: "api_interface",
      symbol_name: "ApiService",
      symbol_fqname: "com.example.ApiService",
      signature: "interface ApiService",
      start_line: 1,
      end_line: 20,
      text_raw: 'interface ApiService {\n  @POST("auth/login")\n  suspend fun login(@Body request: LoginRequest): LoginResponse\n}',
      text_sketch: 'interface ApiService\n  @POST("auth/login") suspend fun login(@Body request: LoginRequest): LoginResponse',
      tags: JSON.stringify(["retrofit"]),
      annotations: null,
      defines: JSON.stringify(["com.example.ApiService"]),
      uses: null,
      content_hash: "hash3",
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

describe("lexical search", () => {
  it("should find chunks by symbol name", () => {
    const results = lexicalSearch(db, REPO_PATH, "LoginViewModel");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].chunk.symbol_name).toBe("LoginViewModel");
    expect(results[0].source).toBe("lexical");
    expect(results[0].rank).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("should find chunks by content keywords", () => {
    const results = lexicalSearch(db, REPO_PATH, "authenticate email password");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("should filter by module", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", { module: ":app" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.chunk.module).toBe(":app");
    }
  });

  it("should filter by language", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", { language: "kotlin" });
    for (const r of results) {
      expect(r.chunk.language).toBe("kotlin");
    }
  });

  it("should filter by kind", () => {
    const results = lexicalSearch(db, REPO_PATH, "LoginViewModel", { kind: "viewmodel" });
    expect(results.length).toBe(1);
    expect(results[0].chunk.kind).toBe("viewmodel");
  });

  it("should filter by tags", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", { tags: ["hilt"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      const tags = JSON.parse(r.chunk.tags ?? "[]") as string[];
      expect(tags).toContain("hilt");
    }
  });

  it("should return empty for non-matching query", () => {
    const results = lexicalSearch(db, REPO_PATH, "zzzznonexistent");
    expect(results.length).toBe(0);
  });

  it("should split CamelCase in query", () => {
    const results = lexicalSearch(db, REPO_PATH, "Login View Model");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should respect limit parameter", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", {}, 1);
    expect(results.length).toBe(1);
  });
});

describe("context packager", () => {
  function makeMockResults(): SearchResult[] {
    return [
      {
        chunk: {
          id: "1",
          repo_path: REPO_PATH,
          commit_sha: "abc",
          path: "file1.kt",
          module: null,
          source_set: null,
          language: "kotlin",
          kind: "class",
          symbol_name: "Foo",
          symbol_fqname: null,
          signature: null,
          start_line: 1,
          end_line: 10,
          text_raw: "a".repeat(400),
          text_sketch: "class Foo",
          tags: null,
          annotations: null,
          defines: null,
          uses: null,
          content_hash: "h1",
          created_at: "",
        },
        score: 0.9,
        source: "both",
        rank: 1,
      },
      {
        chunk: {
          id: "2",
          repo_path: REPO_PATH,
          commit_sha: "abc",
          path: "file1.kt",
          module: null,
          source_set: null,
          language: "kotlin",
          kind: "function",
          symbol_name: "bar",
          symbol_fqname: null,
          signature: null,
          start_line: 11,
          end_line: 20,
          text_raw: "b".repeat(400),
          text_sketch: "fun bar()",
          tags: null,
          annotations: null,
          defines: null,
          uses: null,
          content_hash: "h2",
          created_at: "",
        },
        score: 0.8,
        source: "lexical",
        rank: 2,
      },
      {
        chunk: {
          id: "3",
          repo_path: REPO_PATH,
          commit_sha: "abc",
          path: "file2.kt",
          module: null,
          source_set: null,
          language: "kotlin",
          kind: "class",
          symbol_name: "Baz",
          symbol_fqname: null,
          signature: null,
          start_line: 1,
          end_line: 10,
          text_raw: "c".repeat(400),
          text_sketch: "class Baz",
          tags: null,
          annotations: null,
          defines: null,
          uses: null,
          content_hash: "h3",
          created_at: "",
        },
        score: 0.7,
        source: "vector",
        rank: 3,
      },
    ];
  }

  it("should package results within token budget", () => {
    const results = makeMockResults();
    const packaged = packageResults(results, "sketch", 100);

    expect(packaged.totalTokens).toBeLessThanOrEqual(100);
    expect(packaged.results.length).toBeGreaterThan(0);
  });

  it("should use sketch view by default", () => {
    const results = makeMockResults();
    const packaged = packageResults(results, "sketch", 1000);

    for (const r of packaged.results) {
      // Sketch is shorter than raw
      expect(r.snippet.length).toBeLessThan(400);
    }
  });

  it("should use raw view when requested", () => {
    const results = makeMockResults();
    const packaged = packageResults(results, "raw", 10000);

    const hasRaw = packaged.results.some((r) => r.snippet.length >= 400);
    expect(hasRaw).toBe(true);
  });

  it("should apply diversity constraint (max per file)", () => {
    // Create 5 results from the same file
    const results: SearchResult[] = Array.from({ length: 5 }, (_, i) => ({
      chunk: {
        id: `same-file-${i}`,
        repo_path: REPO_PATH,
        commit_sha: "abc",
        path: "same-file.kt",
        module: null,
        source_set: null,
        language: "kotlin",
        kind: "function",
        symbol_name: `func${i}`,
        symbol_fqname: null,
        signature: null,
        start_line: i * 10,
        end_line: i * 10 + 9,
        text_raw: "x",
        text_sketch: "x",
        tags: null,
        annotations: null,
        defines: null,
        uses: null,
        content_hash: `h${i}`,
        created_at: "",
      },
      score: 1 - i * 0.1,
      source: "lexical" as const,
      rank: i + 1,
    }));

    const packaged = packageResults(results, "sketch", 10000);
    // Default maxChunksPerFile is 3
    expect(packaged.results.length).toBeLessThanOrEqual(3);
  });

  it("should mark truncated when budget exceeded", () => {
    const results = makeMockResults();
    const packaged = packageResults(results, "raw", 10); // Very small budget
    expect(packaged.truncated).toBe(true);
  });
});
