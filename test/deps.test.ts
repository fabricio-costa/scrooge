import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, insertChunk } from "../src/storage/db.js";
import { buildDeps } from "../src/api/deps.js";
import type Database from "better-sqlite3";

let db: Database.Database;

const REPO_PATH = "/test/repo";

function makeChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: `chunk-${Math.random().toString(36).slice(2)}`,
    repo_path: REPO_PATH,
    commit_sha: "abc123",
    path: "app/src/main/SomeFile.kt",
    module: ":app",
    source_set: "main",
    language: "kotlin",
    kind: "class",
    symbol_name: "SomeClass",
    symbol_fqname: "com.example.SomeClass",
    signature: "class SomeClass()",
    start_line: 1,
    end_line: 30,
    text_raw: "class SomeClass() { }",
    text_sketch: "class SomeClass()",
    tags: null,
    annotations: null,
    defines: JSON.stringify(["com.example.SomeClass"]),
    uses: JSON.stringify([]),
    content_hash: `hash-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("buildDeps", () => {
  it("should find forward dependencies", () => {
    insertChunk(db, makeChunk({
      id: "chunk-a",
      symbol_name: "A",
      symbol_fqname: "com.A",
      path: "src/A.kt",
      uses: JSON.stringify(["B", "C"]),
    }));
    insertChunk(db, makeChunk({
      id: "chunk-b",
      symbol_name: "B",
      symbol_fqname: "com.B",
      path: "src/B.kt",
      uses: JSON.stringify([]),
    }));
    insertChunk(db, makeChunk({
      id: "chunk-c",
      symbol_name: "C",
      symbol_fqname: "com.C",
      path: "src/C.kt",
      uses: JSON.stringify([]),
    }));

    const result = buildDeps(db, REPO_PATH, { symbol: "A" });

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].symbol).toBe("A");
    expect(result.forward).toHaveLength(2);
    const forwardSymbols = result.forward.map((d) => d.symbol).sort();
    expect(forwardSymbols).toEqual(["B", "C"]);
  });

  it("should find reverse dependencies", () => {
    insertChunk(db, makeChunk({
      id: "chunk-a",
      symbol_name: "A",
      symbol_fqname: "com.A",
      path: "src/A.kt",
      uses: JSON.stringify([]),
    }));
    insertChunk(db, makeChunk({
      id: "chunk-b",
      symbol_name: "B",
      symbol_fqname: "com.B",
      path: "src/B.kt",
      uses: JSON.stringify(["A"]),
    }));
    insertChunk(db, makeChunk({
      id: "chunk-c",
      symbol_name: "C",
      symbol_fqname: "com.C",
      path: "src/C.kt",
      uses: JSON.stringify(["A"]),
    }));

    const result = buildDeps(db, REPO_PATH, { symbol: "A" });

    expect(result.reverse).toHaveLength(2);
    const reverseSymbols = result.reverse.map((d) => d.symbol).sort();
    expect(reverseSymbols).toEqual(["B", "C"]);
  });

  it("should respect direction: forward", () => {
    insertChunk(db, makeChunk({
      id: "chunk-a",
      symbol_name: "A",
      symbol_fqname: "com.A",
      path: "src/A.kt",
      uses: JSON.stringify(["B"]),
    }));
    insertChunk(db, makeChunk({
      id: "chunk-b",
      symbol_name: "B",
      symbol_fqname: "com.B",
      path: "src/B.kt",
      uses: JSON.stringify(["A"]),
    }));

    const result = buildDeps(db, REPO_PATH, { symbol: "A", direction: "forward" });

    expect(result.forward).toHaveLength(1);
    expect(result.forward[0].symbol).toBe("B");
    expect(result.reverse).toEqual([]);
  });

  it("should respect direction: reverse", () => {
    insertChunk(db, makeChunk({
      id: "chunk-a",
      symbol_name: "A",
      symbol_fqname: "com.A",
      path: "src/A.kt",
      uses: JSON.stringify(["B"]),
    }));
    insertChunk(db, makeChunk({
      id: "chunk-b",
      symbol_name: "B",
      symbol_fqname: "com.B",
      path: "src/B.kt",
      uses: JSON.stringify(["A"]),
    }));

    const result = buildDeps(db, REPO_PATH, { symbol: "A", direction: "reverse" });

    expect(result.forward).toEqual([]);
    expect(result.reverse).toHaveLength(1);
    expect(result.reverse[0].symbol).toBe("B");
  });

  it("should return empty for unknown symbol", () => {
    insertChunk(db, makeChunk({
      id: "chunk-a",
      symbol_name: "A",
      symbol_fqname: "com.A",
      path: "src/A.kt",
    }));

    const result = buildDeps(db, REPO_PATH, { symbol: "NonExistent" });

    expect(result.definitions).toEqual([]);
    expect(result.forward).toEqual([]);
    expect(result.reverse).toEqual([]);
  });

  it("should include module in dep entries", () => {
    insertChunk(db, makeChunk({
      id: "chunk-a",
      symbol_name: "A",
      symbol_fqname: "com.A",
      path: "feature/auth/A.kt",
      module: ":feature:auth",
      uses: JSON.stringify(["B"]),
    }));
    insertChunk(db, makeChunk({
      id: "chunk-b",
      symbol_name: "B",
      symbol_fqname: "com.B",
      path: "data/B.kt",
      module: ":data",
      uses: JSON.stringify([]),
    }));

    const result = buildDeps(db, REPO_PATH, { symbol: "A" });

    expect(result.definitions[0].module).toBe(":feature:auth");
    expect(result.forward[0].module).toBe(":data");
  });

  it("should not include the symbol itself in reverse deps", () => {
    insertChunk(db, makeChunk({
      id: "chunk-a",
      symbol_name: "A",
      symbol_fqname: "com.A",
      path: "src/A.kt",
      uses: JSON.stringify(["A"]),
    }));
    insertChunk(db, makeChunk({
      id: "chunk-b",
      symbol_name: "B",
      symbol_fqname: "com.B",
      path: "src/B.kt",
      uses: JSON.stringify(["A"]),
    }));

    const result = buildDeps(db, REPO_PATH, { symbol: "A" });

    expect(result.reverse).toHaveLength(1);
    expect(result.reverse[0].symbol).toBe("B");
  });

  it("should find definitions by fqname", () => {
    insertChunk(db, makeChunk({
      id: "chunk-a",
      symbol_name: "AImpl",
      symbol_fqname: "com.example.AuthRepository",
      path: "src/AImpl.kt",
      uses: JSON.stringify([]),
    }));

    const result = buildDeps(db, REPO_PATH, { symbol: "AuthRepository" });

    // Should find via fqname LIKE match
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].symbol).toBe("AImpl");
  });
});
