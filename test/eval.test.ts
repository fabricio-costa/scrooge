import { describe, it, expect } from "vitest";
import { mrr, ndcgAtK, precisionAtK, recallAtK } from "../src/eval/metrics.js";

describe("mrr", () => {
  it("should return 1 when first result is relevant", () => {
    expect(mrr(["a", "b", "c"], new Set(["a"]))).toBe(1);
  });

  it("should return 0.5 when first relevant is at rank 2", () => {
    expect(mrr(["x", "a", "c"], new Set(["a"]))).toBe(0.5);
  });

  it("should return 1/3 when first relevant is at rank 3", () => {
    expect(mrr(["x", "y", "a"], new Set(["a", "b"]))).toBeCloseTo(1 / 3);
  });

  it("should return 0 when no relevant results", () => {
    expect(mrr(["x", "y", "z"], new Set(["a"]))).toBe(0);
  });

  it("should return 0 for empty results", () => {
    expect(mrr([], new Set(["a"]))).toBe(0);
  });

  it("should return 0 for empty relevant set", () => {
    expect(mrr(["a", "b"], new Set())).toBe(0);
  });
});

describe("ndcgAtK", () => {
  it("should return 1 for perfect ranking", () => {
    // Results in same order as expected
    const result = ndcgAtK(["a", "b", "c"], ["a", "b", "c"], 3);
    expect(result).toBeCloseTo(1);
  });

  it("should return less than 1 for imperfect ranking", () => {
    // Reversed order: c is most relevant but appears last in expected
    const result = ndcgAtK(["c", "b", "a"], ["a", "b", "c"], 3);
    expect(result).toBeLessThan(1);
    expect(result).toBeGreaterThan(0);
  });

  it("should return 0 when no relevant results in top K", () => {
    const result = ndcgAtK(["x", "y", "z"], ["a", "b"], 3);
    expect(result).toBe(0);
  });

  it("should return 0 for empty relevant list", () => {
    expect(ndcgAtK(["a", "b"], [], 3)).toBe(0);
  });

  it("should return 0 for empty results", () => {
    expect(ndcgAtK([], ["a", "b"], 3)).toBe(0);
  });

  it("should handle k larger than results", () => {
    const result = ndcgAtK(["a"], ["a", "b"], 5);
    // Only 1 result, DCG = relevance(a) / log2(2) = 2/1 = 2
    // IDCG = relevance(a)/log2(2) + relevance(b)/log2(3) = 2/1 + 1/log2(3)
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("should give higher score when relevant result is at top", () => {
    const topRank = ndcgAtK(["a", "x", "y"], ["a"], 3);
    const bottomRank = ndcgAtK(["x", "y", "a"], ["a"], 3);
    expect(topRank).toBeGreaterThan(bottomRank);
  });
});

describe("precisionAtK", () => {
  it("should return 1 when all top-K are relevant", () => {
    expect(precisionAtK(["a", "b", "c"], new Set(["a", "b", "c"]), 3)).toBe(1);
  });

  it("should return 0 when none are relevant", () => {
    expect(precisionAtK(["x", "y", "z"], new Set(["a"]), 3)).toBe(0);
  });

  it("should compute fraction correctly", () => {
    // 2 out of 5 relevant
    expect(precisionAtK(["a", "x", "b", "y", "z"], new Set(["a", "b"]), 5)).toBeCloseTo(0.4);
  });

  it("should handle k larger than results", () => {
    // 1 relevant out of k=5 but only 2 results
    expect(precisionAtK(["a", "x"], new Set(["a"]), 5)).toBeCloseTo(0.2);
  });

  it("should return 0 for empty results", () => {
    expect(precisionAtK([], new Set(["a"]), 3)).toBe(0);
  });

  it("should use k as denominator not result count", () => {
    // 1 relevant in 1 result, k=3 → precision = 1/3
    expect(precisionAtK(["a"], new Set(["a"]), 3)).toBeCloseTo(1 / 3);
  });
});

describe("recallAtK", () => {
  it("should return 1 when all relevant found", () => {
    expect(recallAtK(["a", "b", "x"], new Set(["a", "b"]), 3)).toBe(1);
  });

  it("should return 0 when none found", () => {
    expect(recallAtK(["x", "y", "z"], new Set(["a", "b"]), 3)).toBe(0);
  });

  it("should compute fraction of relevant found", () => {
    // Found 1 of 3 relevant
    expect(recallAtK(["a", "x", "y"], new Set(["a", "b", "c"]), 3)).toBeCloseTo(1 / 3);
  });

  it("should return 0 for empty relevant set", () => {
    expect(recallAtK(["a", "b"], new Set(), 3)).toBe(0);
  });

  it("should return 0 for empty results", () => {
    expect(recallAtK([], new Set(["a"]), 3)).toBe(0);
  });

  it("should respect k limit", () => {
    // Relevant "b" is at position 4, k=2 so it's not considered
    expect(recallAtK(["x", "a", "y", "b"], new Set(["a", "b"]), 2)).toBeCloseTo(0.5);
  });
});
