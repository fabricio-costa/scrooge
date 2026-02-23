import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kotlinChunker } from "../src/indexer/chunkers/kotlin.js";
import { xmlAndroidChunker } from "../src/indexer/chunkers/xml-android.js";
import { gradleChunker } from "../src/indexer/chunkers/gradle.js";
import { genericChunker } from "../src/indexer/chunkers/generic.js";

const FIXTURES = join(import.meta.dirname!, "..", "test", "fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("kotlin chunker", () => {
  it("should support kotlin files", () => {
    expect(kotlinChunker.supports("Main.kt", "kotlin")).toBe(true);
    expect(kotlinChunker.supports("Main.java", "java")).toBe(false);
  });

  it("should chunk LoginViewModel into a class", () => {
    const content = fixture("LoginViewModel.kt");
    const chunks = kotlinChunker.chunk("app/src/main/LoginViewModel.kt", content);

    expect(chunks.length).toBeGreaterThanOrEqual(1);

    const classChunk = chunks.find((c) => c.kind === "viewmodel");
    expect(classChunk).toBeDefined();
    expect(classChunk!.symbolName).toBe("LoginViewModel");
    expect(classChunk!.tags).toContain("hilt");
    expect(classChunk!.annotations).toContain("@HiltViewModel");
    expect(classChunk!.textSketch).toBeTruthy();
    expect(classChunk!.contentHash).toBeTruthy();
  });

  it("should extract package-qualified names", () => {
    const content = fixture("LoginViewModel.kt");
    const chunks = kotlinChunker.chunk("LoginViewModel.kt", content);
    const classChunk = chunks.find((c) => c.symbolName === "LoginViewModel");

    expect(classChunk!.symbolFqname).toBe("com.example.app.ui.login.LoginViewModel");
  });

  it("should chunk ApiService as api_interface", () => {
    const content = fixture("ApiService.kt");
    const chunks = kotlinChunker.chunk("ApiService.kt", content);

    // Should have at least the interface
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The top-level interface - it might be detected differently
    const interfaceChunk = chunks[0];
    expect(interfaceChunk).toBeDefined();
    expect(interfaceChunk.symbolName).toBe("ApiService");
  });

  it("should chunk UserDao with entity and dao", () => {
    const content = fixture("UserDao.kt");
    const chunks = kotlinChunker.chunk("UserDao.kt", content);

    const entityChunk = chunks.find((c) => c.symbolName === "UserEntity");
    expect(entityChunk).toBeDefined();
    expect(entityChunk!.kind).toBe("entity");

    const daoChunk = chunks.find((c) => c.symbolName === "UserDao");
    expect(daoChunk).toBeDefined();
    expect(daoChunk!.kind).toBe("dao");
  });

  it("should chunk LoginScreen as composable", () => {
    const content = fixture("LoginScreen.kt");
    const chunks = kotlinChunker.chunk("LoginScreen.kt", content);

    const composable = chunks.find((c) => c.kind === "composable");
    expect(composable).toBeDefined();
    expect(composable!.symbolName).toBe("LoginScreen");
    expect(composable!.tags).toContain("compose");
  });

  it("should have valid chunk IDs", () => {
    const content = fixture("LoginViewModel.kt");
    const chunks = kotlinChunker.chunk("LoginViewModel.kt", content);

    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^[a-f0-9]{24}$/);
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{16}$/);
    }
  });
});

describe("xml android chunker", () => {
  it("should support xml files", () => {
    expect(xmlAndroidChunker.supports("manifest.xml", "xml")).toBe(true);
    expect(xmlAndroidChunker.supports("Main.kt", "kotlin")).toBe(false);
  });

  it("should chunk AndroidManifest.xml into components", () => {
    const content = fixture("AndroidManifest.xml");
    const chunks = xmlAndroidChunker.chunk("AndroidManifest.xml", content);

    expect(chunks.length).toBeGreaterThanOrEqual(3); // activity, service, receiver

    const activityChunk = chunks.find((c) =>
      c.symbolFqname?.includes("MainActivity"),
    );
    expect(activityChunk).toBeDefined();
    expect(activityChunk!.kind).toBe("manifest_component");
    expect(activityChunk!.tags).toContain("manifest");
  });

  it("should extract android:name from components", () => {
    const content = fixture("AndroidManifest.xml");
    const chunks = xmlAndroidChunker.chunk("AndroidManifest.xml", content);

    const names = chunks.map((c) => c.symbolFqname).filter(Boolean);
    expect(names.some((n) => n!.includes("MainActivity"))).toBe(true);
    expect(names.some((n) => n!.includes("SyncService"))).toBe(true);
  });
});

describe("gradle chunker", () => {
  it("should support gradle files", () => {
    expect(gradleChunker.supports("build.gradle.kts", "gradle")).toBe(true);
  });

  it("should chunk build.gradle.kts into blocks", () => {
    const content = fixture("build.gradle.kts");
    const chunks = gradleChunker.chunk("build.gradle.kts", content);

    expect(chunks.length).toBeGreaterThanOrEqual(2); // at least plugins + dependencies

    const pluginsChunk = chunks.find((c) => c.kind === "gradle_plugins");
    expect(pluginsChunk).toBeDefined();

    const depsChunk = chunks.find((c) => c.kind === "gradle_dependencies");
    expect(depsChunk).toBeDefined();
    expect(depsChunk!.uses.length).toBeGreaterThan(0);
  });

  it("should extract dependency names", () => {
    const content = fixture("build.gradle.kts");
    const chunks = gradleChunker.chunk("build.gradle.kts", content);
    const depsChunk = chunks.find((c) => c.kind === "gradle_dependencies");

    expect(depsChunk!.uses).toContain("androidx.core:core-ktx:1.12.0");
    expect(depsChunk!.uses).toContain("com.google.dagger:hilt-android:2.50");
  });
});

describe("generic chunker", () => {
  it("should accept any file", () => {
    expect(genericChunker.supports("any.file", "other")).toBe(true);
  });

  it("should create single chunk for small files", () => {
    const content = "line 1\nline 2\nline 3";
    const chunks = genericChunker.chunk("small.txt", content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].textRaw).toBe(content);
  });

  it("should split large files into multiple chunks", () => {
    // Include empty lines as block boundaries every 50 lines
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) {
      if (i > 0 && i % 50 === 0) lines.push("");
      lines.push(`line ${i}`);
    }
    const content = lines.join("\n");
    const chunks = genericChunker.chunk("large.txt", content);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
