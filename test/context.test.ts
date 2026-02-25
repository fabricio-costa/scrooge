import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, insertChunk } from "../src/storage/db.js";
import { buildContext } from "../src/api/context.js";
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
    kind: "viewmodel",
    symbol_name: "SomeViewModel",
    symbol_fqname: "com.example.SomeViewModel",
    signature: "class SomeViewModel()",
    start_line: 1,
    end_line: 30,
    text_raw: "class SomeViewModel @Inject constructor() : ViewModel() { }",
    text_sketch: "class SomeViewModel @Inject constructor() : ViewModel()",
    tags: JSON.stringify(["hilt", "viewmodel"]),
    annotations: JSON.stringify(["@HiltViewModel", "@Inject"]),
    defines: JSON.stringify(["com.example.SomeViewModel"]),
    uses: JSON.stringify(["StateFlow", "MutableStateFlow"]),
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

describe("buildContext", () => {
  it("should aggregate annotations from multiple chunks", () => {
    insertChunk(db, makeChunk({
      id: "c1",
      annotations: JSON.stringify(["@HiltViewModel", "@Inject"]),
    }));
    insertChunk(db, makeChunk({
      id: "c2",
      annotations: JSON.stringify(["@HiltViewModel", "@Composable"]),
    }));
    insertChunk(db, makeChunk({
      id: "c3",
      annotations: JSON.stringify(["@HiltViewModel"]),
    }));

    const result = buildContext(db, REPO_PATH, { kind: "viewmodel" });

    expect(result.sampleCount).toBe(3);
    expect(result.commonAnnotations[0]).toBe("@HiltViewModel");
    expect(result.commonAnnotations).toContain("@Inject");
  });

  it("should aggregate tags from multiple chunks", () => {
    insertChunk(db, makeChunk({
      id: "c1",
      tags: JSON.stringify(["hilt", "viewmodel", "coroutine"]),
    }));
    insertChunk(db, makeChunk({
      id: "c2",
      tags: JSON.stringify(["hilt", "viewmodel"]),
    }));

    const result = buildContext(db, REPO_PATH, { kind: "viewmodel" });

    expect(result.commonTags[0]).toBe("hilt");
    expect(result.commonTags[1]).toBe("viewmodel");
    expect(result.commonTags).toContain("coroutine");
  });

  it("should aggregate uses as commonImports", () => {
    insertChunk(db, makeChunk({
      id: "c1",
      uses: JSON.stringify(["StateFlow", "viewModelScope", "MutableStateFlow"]),
    }));
    insertChunk(db, makeChunk({
      id: "c2",
      uses: JSON.stringify(["StateFlow", "viewModelScope"]),
    }));
    insertChunk(db, makeChunk({
      id: "c3",
      uses: JSON.stringify(["StateFlow"]),
    }));

    const result = buildContext(db, REPO_PATH, { kind: "viewmodel" });

    expect(result.commonImports[0]).toBe("StateFlow");
    expect(result.commonImports[1]).toBe("viewModelScope");
    expect(result.commonImports).toContain("MutableStateFlow");
  });

  it("should return example sketches capped at 3", () => {
    for (let i = 0; i < 5; i++) {
      insertChunk(db, makeChunk({
        id: `c${i}`,
        text_sketch: `class VM${i}()`,
      }));
    }

    const result = buildContext(db, REPO_PATH, { kind: "viewmodel" });

    expect(result.exampleSketches.length).toBeLessThanOrEqual(3);
    expect(result.sampleCount).toBe(5);
  });

  it("should filter by module when provided", () => {
    insertChunk(db, makeChunk({
      id: "c-auth",
      module: ":feature:auth",
      tags: JSON.stringify(["auth"]),
    }));
    insertChunk(db, makeChunk({
      id: "c-profile",
      module: ":feature:profile",
      tags: JSON.stringify(["profile"]),
    }));

    const result = buildContext(db, REPO_PATH, { kind: "viewmodel", module: ":feature:auth" });

    expect(result.sampleCount).toBe(1);
    expect(result.commonTags).toContain("auth");
    expect(result.commonTags).not.toContain("profile");
  });

  it("should return empty result for unknown kind", () => {
    insertChunk(db, makeChunk({ id: "c1", kind: "viewmodel" }));

    const result = buildContext(db, REPO_PATH, { kind: "nonexistent_kind" });

    expect(result.sampleCount).toBe(0);
    expect(result.commonAnnotations).toEqual([]);
    expect(result.commonTags).toEqual([]);
    expect(result.commonImports).toEqual([]);
    expect(result.exampleSketches).toEqual([]);
  });

  it("should handle null annotations/tags/uses gracefully", () => {
    insertChunk(db, makeChunk({
      id: "c1",
      annotations: null,
      tags: null,
      uses: null,
    }));

    const result = buildContext(db, REPO_PATH, { kind: "viewmodel" });

    expect(result.sampleCount).toBe(1);
    expect(result.commonAnnotations).toEqual([]);
    expect(result.commonTags).toEqual([]);
    expect(result.commonImports).toEqual([]);
  });

  it("should respect top-N limits for annotations and tags", () => {
    // Insert a chunk with many annotations
    const manyAnnotations = Array.from({ length: 10 }, (_, i) => `@Ann${i}`);
    insertChunk(db, makeChunk({
      id: "c1",
      annotations: JSON.stringify(manyAnnotations),
    }));

    const result = buildContext(db, REPO_PATH, { kind: "viewmodel" });

    // TOP_N is 5
    expect(result.commonAnnotations).toHaveLength(5);
  });
});
