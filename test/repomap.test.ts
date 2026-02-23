import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, insertChunk } from "../src/storage/db.js";
import { generateTree, renderTree } from "../src/repomap/tree.js";
import { getModuleSummaries, getFileSummaries } from "../src/repomap/summaries.js";
import type Database from "better-sqlite3";

let db: Database.Database;
const REPO_PATH = "/test/repo";

function seedData() {
  const files = [
    { path: "app/src/main/LoginViewModel.kt", module: ":app", language: "kotlin", kind: "viewmodel", symbol: "LoginViewModel" },
    { path: "app/src/main/AuthRepository.kt", module: ":app", language: "kotlin", kind: "class", symbol: "AuthRepository" },
    { path: "app/src/main/res/layout/activity_login.xml", module: ":app", language: "xml", kind: "layout", symbol: "activity_login" },
    { path: "core/src/main/ApiClient.kt", module: ":core", language: "kotlin", kind: "class", symbol: "ApiClient" },
    { path: "build.gradle.kts", module: null, language: "gradle", kind: "gradle_dependencies", symbol: "build.gradle.kts" },
  ];

  for (const f of files) {
    insertChunk(db, {
      id: `id-${f.symbol}`,
      repo_path: REPO_PATH,
      commit_sha: "abc",
      path: f.path,
      module: f.module,
      source_set: f.path.includes("/main/") ? "main" : null,
      language: f.language,
      kind: f.kind,
      symbol_name: f.symbol,
      symbol_fqname: `com.example.${f.symbol}`,
      signature: `${f.kind} ${f.symbol}`,
      start_line: 1,
      end_line: 20,
      text_raw: `content of ${f.symbol}`,
      text_sketch: `sketch of ${f.symbol}`,
      tags: null,
      annotations: null,
      defines: JSON.stringify([`com.example.${f.symbol}`]),
      uses: null,
      content_hash: `hash-${f.symbol}`,
    });
  }
}

beforeEach(() => {
  db = openDb(":memory:");
  seedData();
});

afterEach(() => {
  db.close();
});

describe("directory tree", () => {
  it("should generate tree from indexed files", () => {
    const tree = generateTree(db, REPO_PATH);
    expect(tree.type).toBe("dir");
    expect(tree.children).toBeDefined();
    // Top-level: app/, core/, build.gradle.kts = 3 entries
    expect(tree.children!.length).toBe(3);
  });

  it("should filter by module", () => {
    const tree = generateTree(db, REPO_PATH, ":app");
    const rendered = renderTree(tree);
    expect(rendered).toContain("app");
    expect(rendered).not.toContain("core");
  });

  it("should render tree as text", () => {
    const tree = generateTree(db, REPO_PATH);
    const text = renderTree(tree);
    expect(text).toContain("LoginViewModel.kt");
    expect(text).toContain("AuthRepository.kt");
    expect(text).toContain("app");
    expect(text).toContain("core");
    expect(text).toContain("build.gradle.kts");
  });
});

describe("module summaries", () => {
  it("should return summaries per module", () => {
    const summaries = getModuleSummaries(db, REPO_PATH);
    expect(summaries.length).toBeGreaterThan(0);

    const appModule = summaries.find((s) => s.module === ":app");
    expect(appModule).toBeDefined();
    expect(appModule!.fileCount).toBeGreaterThanOrEqual(2);
    expect(appModule!.languages.kotlin).toBeGreaterThan(0);
  });

  it("should include top symbols", () => {
    const summaries = getModuleSummaries(db, REPO_PATH);
    const appModule = summaries.find((s) => s.module === ":app");
    expect(appModule!.topSymbols).toContain("LoginViewModel");
  });
});

describe("file summaries", () => {
  it("should return summaries per file", () => {
    const files = getFileSummaries(db, REPO_PATH);
    expect(files.length).toBe(5);
  });

  it("should filter by module", () => {
    const files = getFileSummaries(db, REPO_PATH, ":core");
    expect(files.length).toBe(1);
    expect(files[0].path).toContain("core/");
  });

  it("should include symbols with kind and signature", () => {
    const files = getFileSummaries(db, REPO_PATH);
    const loginFile = files.find((f) => f.path.includes("LoginViewModel"));
    expect(loginFile!.symbols.length).toBeGreaterThan(0);
    expect(loginFile!.symbols[0].name).toBe("LoginViewModel");
  });
});
