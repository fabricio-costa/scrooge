import { describe, it, expect } from "vitest";
import { shouldIgnore, filterFiles } from "../src/utils/ignore.js";
import { estimateTokens, truncateToTokenBudget } from "../src/utils/tokens.js";
import { classifyFile } from "../src/indexer/classifier.js";

describe("ignore rules", () => {
  it("should ignore node_modules", () => {
    expect(shouldIgnore("node_modules/foo/bar.js")).toBe(true);
  });

  it("should ignore .git directories", () => {
    expect(shouldIgnore(".git/config")).toBe(true);
  });

  it("should ignore build directories", () => {
    expect(shouldIgnore("app/build/outputs/apk/debug.apk")).toBe(true);
  });

  it("should ignore binary extensions", () => {
    expect(shouldIgnore("image.png")).toBe(true);
    expect(shouldIgnore("file.jar")).toBe(true);
    expect(shouldIgnore("file.apk")).toBe(true);
  });

  it("should ignore lock files", () => {
    expect(shouldIgnore("package-lock.json")).toBe(true);
    expect(shouldIgnore("yarn.lock")).toBe(true);
  });

  it("should not ignore source files", () => {
    expect(shouldIgnore("app/src/main/LoginViewModel.kt")).toBe(false);
    expect(shouldIgnore("app/src/main/res/layout/activity_main.xml")).toBe(false);
    expect(shouldIgnore("build.gradle.kts")).toBe(false);
  });

  it("should filter a list of files", () => {
    const files = [
      "app/src/main/Main.kt",
      "node_modules/foo/index.js",
      "app/build/output.apk",
      "build.gradle.kts",
      ".git/HEAD",
    ];
    const filtered = filterFiles(files);
    expect(filtered).toEqual(["app/src/main/Main.kt", "build.gradle.kts"]);
  });
});

describe("token estimation", () => {
  it("should estimate tokens for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate ~1 token per 4 characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("should round up partial tokens", () => {
    expect(estimateTokens("abc")).toBe(1); // 3/4 = 0.75 -> 1
  });

  it("should truncate text to token budget", () => {
    const text = "a".repeat(100); // 25 tokens
    const truncated = truncateToTokenBudget(text, 10); // 40 chars
    expect(truncated.length).toBeLessThan(100);
    expect(truncated).toContain("truncated");
  });

  it("should not truncate text within budget", () => {
    const text = "hello";
    const result = truncateToTokenBudget(text, 100);
    expect(result).toBe(text);
  });
});

describe("file classifier", () => {
  it("should classify .kt files as kotlin", () => {
    expect(classifyFile("app/src/main/LoginViewModel.kt")).toBe("kotlin");
  });

  it("should classify .gradle.kts as gradle", () => {
    expect(classifyFile("app/build.gradle.kts")).toBe("gradle");
  });

  it("should classify .xml as xml", () => {
    expect(classifyFile("app/src/main/res/layout/activity_main.xml")).toBe("xml");
  });

  it("should classify build.gradle as gradle", () => {
    expect(classifyFile("build.gradle")).toBe("gradle");
  });

  it("should classify unknown extensions as other", () => {
    expect(classifyFile("README.md")).toBe("other");
    expect(classifyFile("Dockerfile")).toBe("other");
  });
});
