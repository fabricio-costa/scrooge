import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, insertChunk, insertVecEmbedding } from "../src/storage/db.js";
import { lexicalSearch } from "../src/retrieval/lexical.js";
import type { SearchResult } from "../src/retrieval/types.js";
import type { ChunkRow } from "../src/storage/db.js";
import type Database from "better-sqlite3";

let db: Database.Database;

const REPO_PATH = "/test/repo";

/** Helper to create a minimal chunk row for insertion. */
function makeChunk(overrides: Partial<Omit<ChunkRow, "created_at">> & { id: string }): Omit<ChunkRow, "created_at"> {
  return {
    repo_path: REPO_PATH,
    commit_sha: "abc123",
    path: "src/Main.kt",
    module: null,
    source_set: null,
    language: "kotlin",
    kind: "class",
    symbol_name: null,
    symbol_fqname: null,
    signature: null,
    start_line: 1,
    end_line: 10,
    text_raw: "placeholder",
    text_sketch: "placeholder",
    tags: null,
    annotations: null,
    defines: null,
    uses: null,
    content_hash: `hash-${overrides.id}`,
    ...overrides,
  };
}

/**
 * Reference implementation of RRF fusion, matching the logic in hybrid.ts.
 * Used to verify expected behavior without calling the real hybridSearch
 * (which requires embed() / ML model loading).
 */
function rrfFuse(
  lexical: SearchResult[],
  vector: SearchResult[],
  k: number,
  maxResults: number,
): SearchResult[] {
  const scoreMap = new Map<string, { score: number; chunk: SearchResult["chunk"]; sources: Set<string> }>();

  for (const result of lexical) {
    const existing = scoreMap.get(result.chunk.id);
    const rrfScore = 1 / (k + result.rank);
    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("lexical");
    } else {
      scoreMap.set(result.chunk.id, {
        score: rrfScore,
        chunk: result.chunk,
        sources: new Set(["lexical"]),
      });
    }
  }

  for (const result of vector) {
    const existing = scoreMap.get(result.chunk.id);
    const rrfScore = 1 / (k + result.rank);
    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("vector");
    } else {
      scoreMap.set(result.chunk.id, {
        score: rrfScore,
        chunk: result.chunk,
        sources: new Set(["vector"]),
      });
    }
  }

  const merged = [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return merged.map((entry, index) => ({
    chunk: entry.chunk,
    score: entry.score,
    source: entry.sources.size === 2 ? "both" as const : (entry.sources.values().next().value as "lexical" | "vector"),
    rank: index + 1,
  }));
}

/** Build a mock SearchResult for RRF tests (no DB needed). */
function mockResult(id: string, rank: number, source: "lexical" | "vector"): SearchResult {
  return {
    chunk: {
      id,
      repo_path: REPO_PATH,
      commit_sha: "abc",
      path: `src/${id}.kt`,
      module: null,
      source_set: null,
      language: "kotlin",
      kind: "class",
      symbol_name: id,
      symbol_fqname: null,
      signature: null,
      start_line: 1,
      end_line: 10,
      text_raw: `code for ${id}`,
      text_sketch: `sketch for ${id}`,
      tags: null,
      annotations: null,
      defines: null,
      uses: null,
      content_hash: `h-${id}`,
      created_at: "",
    },
    score: source === "lexical" ? 10 - rank : 1 - rank * 0.1,
    source,
    rank,
  };
}

// ---------------------------------------------------------------------------
// A. Lexical search with filters
// ---------------------------------------------------------------------------
describe("lexicalSearch with filters", () => {
  beforeEach(() => {
    db = openDb(":memory:");

    insertChunk(db, makeChunk({
      id: "vm-1",
      path: "app/LoginViewModel.kt",
      kind: "viewmodel",
      symbol_name: "LoginViewModel",
      text_raw: "class LoginViewModel : ViewModel() { fun login() {} }",
      text_sketch: "class LoginViewModel",
      tags: JSON.stringify(["hilt", "viewmodel"]),
    }));

    insertChunk(db, makeChunk({
      id: "repo-1",
      path: "app/AuthRepository.kt",
      kind: "class",
      symbol_name: "AuthRepository",
      text_raw: "class AuthRepository { fun login(email: String): Result<Token> }",
      text_sketch: "class AuthRepository",
      tags: JSON.stringify(["hilt"]),
    }));

    insertChunk(db, makeChunk({
      id: "api-1",
      path: "app/ApiService.kt",
      kind: "api_interface",
      symbol_name: "ApiService",
      text_raw: "interface ApiService { fun fetchData(): Response }",
      text_sketch: "interface ApiService",
      tags: JSON.stringify(["retrofit"]),
    }));

    insertChunk(db, makeChunk({
      id: "xml-1",
      path: "app/res/layout/activity_main.xml",
      language: "xml",
      kind: "layout",
      symbol_name: "activity_main",
      text_raw: '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" />',
      text_sketch: "layout: activity_main",
      tags: JSON.stringify(["layout"]),
    }));
  });

  afterEach(() => {
    db.close();
  });

  it("should filter results by kind", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", { kind: "viewmodel" });
    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe("vm-1");
  });

  it("should filter results by kind returning no matches", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", { kind: "layout" });
    expect(results.length).toBe(0);
  });

  it("should filter results by tags", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", { tags: ["hilt"] });
    expect(results.length).toBe(2);
    const ids = results.map((r) => r.chunk.id).sort();
    expect(ids).toEqual(["repo-1", "vm-1"]);
  });

  it("should filter by tags with multiple required tags", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", { tags: ["hilt", "viewmodel"] });
    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe("vm-1");
  });

  it("should filter by language", () => {
    const results = lexicalSearch(db, REPO_PATH, "android", { language: "xml" });
    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe("xml-1");
  });

  it("should combine kind and tags filters", () => {
    const results = lexicalSearch(db, REPO_PATH, "login", { kind: "class", tags: ["hilt"] });
    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe("repo-1");
  });
});

// ---------------------------------------------------------------------------
// B. Vector search with synthetic embeddings
// ---------------------------------------------------------------------------
describe("vector search via chunks_vec", () => {
  beforeEach(() => {
    db = openDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  /** Create a Float32Array embedding with a dominant dimension. */
  function syntheticEmbedding(dominantDim: number, value: number = 1.0): Float32Array {
    const dims = 384;
    const arr = new Float32Array(dims);
    arr[dominantDim] = value;
    return arr;
  }

  it("should store and retrieve vector embeddings", () => {
    insertChunk(db, makeChunk({ id: "vec-a", symbol_name: "Alpha", text_raw: "alpha code" }));
    insertVecEmbedding(db, "vec-a", syntheticEmbedding(0));

    const row = db.prepare("SELECT id FROM chunks_vec WHERE id = ?").get("vec-a") as { id: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.id).toBe("vec-a");
  });

  it("should rank closer embeddings higher via cosine distance", () => {
    // Insert 3 chunks with embeddings pointing in different directions
    insertChunk(db, makeChunk({ id: "close", symbol_name: "Close", text_raw: "close match" }));
    insertChunk(db, makeChunk({ id: "medium", symbol_name: "Medium", text_raw: "medium match" }));
    insertChunk(db, makeChunk({ id: "far", symbol_name: "Far", text_raw: "far match" }));

    // close: same direction as query (dim 0)
    insertVecEmbedding(db, "close", syntheticEmbedding(0));
    // medium: partial overlap with query (dims 0 and 1)
    const medEmb = new Float32Array(384);
    medEmb[0] = 0.5;
    medEmb[1] = 0.866; // ~30 degrees from query
    insertVecEmbedding(db, "medium", medEmb);
    // far: orthogonal to query (dim 2 only)
    insertVecEmbedding(db, "far", syntheticEmbedding(2));

    // Query embedding points in dim 0 -- "close" should be nearest
    const queryEmb = syntheticEmbedding(0);

    const rows = db
      .prepare(`
        SELECT v.id, v.distance
        FROM chunks_vec v
        WHERE v.embedding MATCH ? AND k = 3
        ORDER BY v.distance
      `)
      .all(queryEmb) as Array<{ id: string; distance: number }>;

    expect(rows.length).toBe(3);
    expect(rows[0].id).toBe("close");
    expect(rows[0].distance).toBeLessThan(rows[1].distance);
    expect(rows[1].distance).toBeLessThan(rows[2].distance);
  });

  it("should limit vector results with k parameter", () => {
    for (let i = 0; i < 5; i++) {
      insertChunk(db, makeChunk({ id: `vk-${i}`, symbol_name: `Sym${i}`, text_raw: `code ${i}` }));
      insertVecEmbedding(db, `vk-${i}`, syntheticEmbedding(i % 384));
    }

    const queryEmb = syntheticEmbedding(0);
    const rows = db
      .prepare(`
        SELECT v.id, v.distance
        FROM chunks_vec v
        WHERE v.embedding MATCH ? AND k = 2
        ORDER BY v.distance
      `)
      .all(queryEmb) as Array<{ id: string; distance: number }>;

    expect(rows.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// C. RRF fusion algorithm
// ---------------------------------------------------------------------------
describe("RRF fusion", () => {
  const K = 60; // Default config rrfK

  it("should combine overlapping results with higher score", () => {
    // "shared" appears in both lists; "lex-only" and "vec-only" appear in one each
    const lexical: SearchResult[] = [
      mockResult("shared", 1, "lexical"),
      mockResult("lex-only", 2, "lexical"),
    ];
    const vector: SearchResult[] = [
      mockResult("shared", 1, "vector"),
      mockResult("vec-only", 2, "vector"),
    ];

    const fused = rrfFuse(lexical, vector, K, 10);

    // "shared" should be first with combined score from both lists
    expect(fused[0].chunk.id).toBe("shared");
    expect(fused[0].source).toBe("both");

    // Its score should be 2 * 1/(60+1) since rank=1 in both
    const expectedSharedScore = 2 * (1 / (K + 1));
    expect(fused[0].score).toBeCloseTo(expectedSharedScore, 10);

    // "lex-only" and "vec-only" should have equal score: 1/(60+2)
    const singleScore = 1 / (K + 2);
    const otherScores = fused.slice(1).map((r) => r.score);
    for (const s of otherScores) {
      expect(s).toBeCloseTo(singleScore, 10);
    }
  });

  it("should sort by descending RRF score", () => {
    const lexical: SearchResult[] = [
      mockResult("A", 1, "lexical"),
      mockResult("B", 2, "lexical"),
      mockResult("C", 3, "lexical"),
    ];
    const vector: SearchResult[] = [
      mockResult("C", 1, "vector"), // C is rank 1 in vector but rank 3 in lexical
      mockResult("B", 2, "vector"), // B is rank 2 in both
      mockResult("D", 3, "vector"),
    ];

    const fused = rrfFuse(lexical, vector, K, 10);

    // B: 1/(60+2) + 1/(60+2) = 2/(62) = 0.03226
    // C: 1/(60+3) + 1/(60+1) = 1/63 + 1/61 = 0.03222
    // A: 1/(60+1) = 1/61 = 0.01639
    // D: 1/(60+3) = 1/63 = 0.01587
    expect(fused[0].chunk.id).toBe("B");
    expect(fused[0].source).toBe("both");
    expect(fused[1].chunk.id).toBe("C");
    expect(fused[1].source).toBe("both");

    // Verify strictly descending scores
    for (let i = 1; i < fused.length; i++) {
      expect(fused[i - 1].score).toBeGreaterThan(fused[i].score);
    }
  });

  it("should assign sequential rank starting from 1", () => {
    const lexical: SearchResult[] = [
      mockResult("X", 1, "lexical"),
      mockResult("Y", 2, "lexical"),
    ];
    const vector: SearchResult[] = [
      mockResult("Z", 1, "vector"),
    ];

    const fused = rrfFuse(lexical, vector, K, 10);

    for (let i = 0; i < fused.length; i++) {
      expect(fused[i].rank).toBe(i + 1);
    }
  });

  it("should respect maxResults limit", () => {
    const lexical: SearchResult[] = Array.from({ length: 10 }, (_, i) =>
      mockResult(`lex-${i}`, i + 1, "lexical"),
    );
    const vector: SearchResult[] = Array.from({ length: 10 }, (_, i) =>
      mockResult(`vec-${i}`, i + 1, "vector"),
    );

    const fused = rrfFuse(lexical, vector, K, 5);
    expect(fused.length).toBe(5);
  });

  it("should handle one empty lexical list", () => {
    const lexical: SearchResult[] = [];
    const vector: SearchResult[] = [
      mockResult("only-vec-1", 1, "vector"),
      mockResult("only-vec-2", 2, "vector"),
    ];

    const fused = rrfFuse(lexical, vector, K, 10);

    expect(fused.length).toBe(2);
    expect(fused[0].chunk.id).toBe("only-vec-1");
    expect(fused[0].source).toBe("vector");
    expect(fused[1].chunk.id).toBe("only-vec-2");
    expect(fused[1].source).toBe("vector");
  });

  it("should handle one empty vector list", () => {
    const lexical: SearchResult[] = [
      mockResult("only-lex-1", 1, "lexical"),
      mockResult("only-lex-2", 2, "lexical"),
    ];
    const vector: SearchResult[] = [];

    const fused = rrfFuse(lexical, vector, K, 10);

    expect(fused.length).toBe(2);
    expect(fused[0].chunk.id).toBe("only-lex-1");
    expect(fused[0].source).toBe("lexical");
  });

  it("should handle both lists empty", () => {
    const fused = rrfFuse([], [], K, 10);
    expect(fused.length).toBe(0);
  });

  it("should handle single result in one list", () => {
    const lexical: SearchResult[] = [mockResult("solo", 1, "lexical")];
    const vector: SearchResult[] = [];

    const fused = rrfFuse(lexical, vector, K, 10);

    expect(fused.length).toBe(1);
    expect(fused[0].chunk.id).toBe("solo");
    expect(fused[0].score).toBeCloseTo(1 / (K + 1), 10);
    expect(fused[0].rank).toBe(1);
    expect(fused[0].source).toBe("lexical");
  });

  it("should compute correct scores with different k values", () => {
    const lexical: SearchResult[] = [mockResult("item", 1, "lexical")];
    const vector: SearchResult[] = [mockResult("item", 3, "vector")];

    const k10 = rrfFuse(lexical, vector, 10, 10);
    // score = 1/(10+1) + 1/(10+3) = 1/11 + 1/13
    expect(k10[0].score).toBeCloseTo(1 / 11 + 1 / 13, 10);

    const k100 = rrfFuse(lexical, vector, 100, 10);
    // score = 1/(100+1) + 1/(100+3) = 1/101 + 1/103
    expect(k100[0].score).toBeCloseTo(1 / 101 + 1 / 103, 10);
  });

  it("should produce scores that are the sum of reciprocal ranks", () => {
    // Verify the formula: score(doc) = sum of 1/(k + rank_i) for each list containing doc
    const lexical: SearchResult[] = [
      mockResult("A", 1, "lexical"),
      mockResult("B", 4, "lexical"),
    ];
    const vector: SearchResult[] = [
      mockResult("A", 2, "vector"),
      mockResult("B", 1, "vector"),
    ];

    const fused = rrfFuse(lexical, vector, K, 10);

    // A: 1/(60+1) + 1/(60+2) = 1/61 + 1/62
    const scoreA = 1 / 61 + 1 / 62;
    // B: 1/(60+4) + 1/(60+1) = 1/64 + 1/61
    const scoreB = 1 / 64 + 1 / 61;

    const resultA = fused.find((r) => r.chunk.id === "A")!;
    const resultB = fused.find((r) => r.chunk.id === "B")!;

    expect(resultA.score).toBeCloseTo(scoreA, 10);
    expect(resultB.score).toBeCloseTo(scoreB, 10);
    // A should rank higher than B
    expect(resultA.rank).toBeLessThan(resultB.rank);
  });
});
