import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kotlinChunker } from "../src/indexer/chunkers/kotlin.js";
import { typescriptChunker } from "../src/indexer/chunkers/typescript.js";
import { xmlAndroidChunker } from "../src/indexer/chunkers/xml-android.js";
import { gradleChunker } from "../src/indexer/chunkers/gradle.js";
import { genericChunker } from "../src/indexer/chunkers/generic.js";
import { dartChunker } from "../src/indexer/chunkers/dart.js";

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

    // LoginViewModel + LoginUiState sealed class = 2 chunks
    expect(chunks.length).toBe(2);

    const classChunk = chunks.find((c) => c.kind === "viewmodel");
    expect(classChunk).toBeDefined();
    expect(classChunk!.symbolName).toBe("LoginViewModel");
    expect(classChunk!.startLine).toBe(14);
    expect(classChunk!.endLine).toBe(61);
    expect(classChunk!.tags).toContain("hilt");
    expect(classChunk!.tags).toContain("state");
    expect(classChunk!.annotations).toContain("@HiltViewModel");
    expect(classChunk!.textSketch).toContain("authenticate");
    expect(classChunk!.defines).toContain("com.example.app.ui.login.LoginViewModel");
    expect(classChunk!.uses.length).toBeGreaterThan(0);
    expect(classChunk!.contentHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("should extract package-qualified names", () => {
    const content = fixture("LoginViewModel.kt");
    const chunks = kotlinChunker.chunk("LoginViewModel.kt", content);
    const classChunk = chunks.find((c) => c.symbolName === "LoginViewModel");

    expect(classChunk!.symbolFqname).toBe("com.example.app.ui.login.LoginViewModel");
  });

  it("should chunk ApiService as api_interface (interface_declaration)", () => {
    const content = fixture("ApiService.kt");
    const chunks = kotlinChunker.chunk("ApiService.kt", content);

    expect(chunks.length).toBe(1);
    const interfaceChunk = chunks[0];
    expect(interfaceChunk.symbolName).toBe("ApiService");
    expect(interfaceChunk.kind).toBe("api_interface");
    expect(interfaceChunk.symbolFqname).toBe("com.example.app.data.api.ApiService");
    expect(interfaceChunk.startLine).toBe(12);
    expect(interfaceChunk.endLine).toBe(25);
    expect(interfaceChunk.textSketch).toContain("login");
  });

  it("should chunk UserDao with entity and dao", () => {
    const content = fixture("UserDao.kt");
    const chunks = kotlinChunker.chunk("UserDao.kt", content);

    expect(chunks.length).toBe(2);

    const entityChunk = chunks.find((c) => c.symbolName === "UserEntity");
    expect(entityChunk).toBeDefined();
    expect(entityChunk!.kind).toBe("entity");
    expect(entityChunk!.tags).toContain("room");
    expect(entityChunk!.startLine).toBe(10);

    const daoChunk = chunks.find((c) => c.symbolName === "UserDao");
    expect(daoChunk).toBeDefined();
    expect(daoChunk!.kind).toBe("dao");
    expect(daoChunk!.tags).toContain("room");
    expect(daoChunk!.textSketch).toContain("getUser");
  });

  it("should chunk LoginScreen as composable", () => {
    const content = fixture("LoginScreen.kt");
    const chunks = kotlinChunker.chunk("LoginScreen.kt", content);

    expect(chunks.length).toBe(1);
    const composable = chunks[0];
    expect(composable.kind).toBe("composable");
    expect(composable.symbolName).toBe("LoginScreen");
    expect(composable.tags).toContain("compose");
    expect(composable.startLine).toBe(15);
  });

  it("should have valid chunk IDs", () => {
    const content = fixture("LoginViewModel.kt");
    const chunks = kotlinChunker.chunk("LoginViewModel.kt", content);

    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^[a-f0-9]{24}$/);
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  it("should split large classes into class + method chunks", () => {
    const content = fixture("LargeClass.kt");
    const chunks = kotlinChunker.chunk("app/src/main/DashboardViewModel.kt", content);

    // Should have the main class chunk + individual method chunks
    const classChunk = chunks.find((c) => c.kind === "viewmodel");
    expect(classChunk).toBeDefined();
    expect(classChunk!.symbolName).toBe("DashboardViewModel");

    // Methods should be extracted separately
    const methodChunks = chunks.filter((c) => c.kind === "function" || c.kind === "method" || c.kind === "composable");
    expect(methodChunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeGreaterThan(2);
  });

  it("should chunk HiltModule with DI annotations", () => {
    const content = fixture("HiltModule.kt");
    const chunks = kotlinChunker.chunk("di/HiltModule.kt", content);

    // Should detect the module objects and abstract class
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const networkModule = chunks.find((c) => c.symbolName === "NetworkModule");
    expect(networkModule).toBeDefined();

    const repoModule = chunks.find((c) => c.symbolName === "RepositoryModule");
    expect(repoModule).toBeDefined();
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

    // 2 activities + 1 service + 1 receiver = 4 components
    expect(chunks.length).toBe(4);

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
    expect(names).toContain(".ui.main.MainActivity");
    expect(names).toContain(".ui.login.LoginActivity");
    expect(names).toContain(".service.SyncService");
    expect(names).toContain(".receiver.BootReceiver");
  });

  it("should chunk navigation XML into destinations", () => {
    const content = fixture("nav_graph.xml");
    const chunks = xmlAndroidChunker.chunk("app/src/main/res/navigation/nav_graph.xml", content);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.kind).toBe("nav_destination");
      expect(chunk.tags).toContain("navigation");
    }

    const homeChunk = chunks.find((c) => c.symbolName === "homeFragment");
    expect(homeChunk).toBeDefined();
    // Home has actions pointing to detail, settings, profile
    expect(homeChunk!.uses.length).toBeGreaterThanOrEqual(1);
  });

  it("should chunk layout XML and extract IDs", () => {
    const content = fixture("activity_main.xml");
    const chunks = xmlAndroidChunker.chunk("app/src/main/res/layout/activity_main.xml", content);

    expect(chunks.length).toBe(1);
    const chunk = chunks[0];
    expect(chunk.kind).toBe("layout");
    expect(chunk.tags).toContain("layout");
    expect(chunk.symbolName).toBe("activity_main");
    // Should extract IDs
    expect(chunk.defines.length).toBeGreaterThanOrEqual(5);
    expect(chunk.defines).toContain("@+id/toolbar");
    expect(chunk.defines).toContain("@+id/fabAdd");
    expect(chunk.textSketch).toContain("ConstraintLayout");
  });

  it("should chunk values XML as single chunk", () => {
    const content = fixture("strings.xml");
    const chunks = xmlAndroidChunker.chunk("app/src/main/res/values/strings.xml", content);

    expect(chunks.length).toBe(1);
    expect(chunks[0].kind).toBe("values");
    expect(chunks[0].symbolName).toBe("strings");
  });
});

describe("gradle chunker", () => {
  it("should support gradle files", () => {
    expect(gradleChunker.supports("build.gradle.kts", "gradle")).toBe(true);
  });

  it("should chunk build.gradle.kts into blocks", () => {
    const content = fixture("build.gradle.kts");
    const chunks = gradleChunker.chunk("build.gradle.kts", content);

    // plugins + android + dependencies = 3 blocks
    expect(chunks.length).toBe(3);

    const pluginsChunk = chunks.find((c) => c.kind === "gradle_plugins");
    expect(pluginsChunk).toBeDefined();

    const androidChunk = chunks.find((c) => c.kind === "gradle_android");
    expect(androidChunk).toBeDefined();

    const depsChunk = chunks.find((c) => c.kind === "gradle_dependencies");
    expect(depsChunk).toBeDefined();
    expect(depsChunk!.uses.length).toBe(9); // 9 dependency declarations
  });

  it("should extract dependency names", () => {
    const content = fixture("build.gradle.kts");
    const chunks = gradleChunker.chunk("build.gradle.kts", content);
    const depsChunk = chunks.find((c) => c.kind === "gradle_dependencies");

    expect(depsChunk!.uses).toContain("androidx.core:core-ktx:1.12.0");
    expect(depsChunk!.uses).toContain("com.google.dagger:hilt-android:2.50");
    expect(depsChunk!.uses).toContain("com.squareup.retrofit2:retrofit:2.9.0");
  });

  it("should chunk settings.gradle.kts as gradle_settings", () => {
    const content = fixture("settings.gradle.kts");
    const chunks = gradleChunker.chunk("settings.gradle.kts", content);

    expect(chunks.length).toBe(1);
    expect(chunks[0].kind).toBe("gradle_settings");
    expect(chunks[0].tags).toContain("gradle");
  });
});

describe("typescript chunker", () => {
  it("should support typescript files", () => {
    expect(typescriptChunker.supports("file.ts", "typescript")).toBe(true);
    expect(typescriptChunker.supports("file.tsx", "typescript")).toBe(true);
    expect(typescriptChunker.supports("file.js", "javascript")).toBe(false);
  });

  it("should chunk UserService.ts into a class", () => {
    const content = fixture("UserService.ts");
    const chunks = typescriptChunker.chunk("src/services/UserService.ts", content);

    const classChunk = chunks.find((c) => c.kind === "class");
    expect(classChunk).toBeDefined();
    expect(classChunk!.symbolName).toBe("UserService");
    expect(classChunk!.signature).toContain("export class UserService");
    expect(classChunk!.tags).toContain("async");
    expect(classChunk!.tags).toContain("export");
    expect(classChunk!.textSketch).toBeTruthy();
    expect(classChunk!.defines).toContain("src/services/UserService.ts.UserService");
    expect(classChunk!.contentHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("should chunk types.ts interface", () => {
    const content = fixture("types.ts");
    const chunks = typescriptChunker.chunk("src/types.ts", content);

    const interfaceChunk = chunks.find((c) => c.kind === "interface");
    expect(interfaceChunk).toBeDefined();
    expect(interfaceChunk!.symbolName).toBe("User");
  });

  it("should chunk types.ts type alias", () => {
    const content = fixture("types.ts");
    const chunks = typescriptChunker.chunk("src/types.ts", content);

    const typeAliasChunks = chunks.filter((c) => c.kind === "type_alias");
    expect(typeAliasChunks.length).toBeGreaterThanOrEqual(1);

    const createUserDto = typeAliasChunks.find((c) => c.symbolName === "CreateUserDto");
    expect(createUserDto).toBeDefined();
  });

  it("should chunk types.ts enum", () => {
    const content = fixture("types.ts");
    const chunks = typescriptChunker.chunk("src/types.ts", content);

    const enumChunk = chunks.find((c) => c.kind === "enum");
    expect(enumChunk).toBeDefined();
    expect(enumChunk!.symbolName).toBe("UserRole");
    expect(enumChunk!.textSketch).toContain("Admin");
  });

  it("should chunk types.ts top-level const", () => {
    const content = fixture("types.ts");
    const chunks = typescriptChunker.chunk("src/types.ts", content);

    const constChunk = chunks.find((c) => c.symbolName === "DEFAULT_PAGE_SIZE");
    expect(constChunk).toBeDefined();
    expect(constChunk!.kind).toBe("function");
  });

  it("should chunk TSX file without errors", () => {
    const content = fixture("ApiClient.tsx");
    const chunks = typescriptChunker.chunk("src/components/ApiClient.tsx", content);

    expect(chunks.length).toBeGreaterThan(0);
    // Should find the ApiClient arrow function component
    const apiClient = chunks.find((c) => c.symbolName === "ApiClient");
    expect(apiClient).toBeDefined();
  });

  it("should extract imports into uses", () => {
    const content = fixture("UserService.ts");
    const chunks = typescriptChunker.chunk("src/services/UserService.ts", content);

    const classChunk = chunks.find((c) => c.kind === "class");
    expect(classChunk).toBeDefined();
    expect(classChunk!.uses.length).toBeGreaterThan(0);
  });

  it("should have valid chunk IDs", () => {
    const content = fixture("UserService.ts");
    const chunks = typescriptChunker.chunk("src/services/UserService.ts", content);

    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^[a-f0-9]{24}$/);
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  it("should include JSDoc in sketch", () => {
    const content = fixture("UserService.ts");
    const chunks = typescriptChunker.chunk("src/services/UserService.ts", content);

    const classChunk = chunks.find((c) => c.kind === "class");
    expect(classChunk).toBeDefined();
    expect(classChunk!.textSketch).toContain("Service responsible for user management");
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

describe("dart chunker", () => {
  it("should support dart files", () => {
    expect(dartChunker.supports("main.dart", "dart")).toBe(true);
    expect(dartChunker.supports("main.ts", "typescript")).toBe(false);
  });

  it("should chunk StatelessWidget class with flutter/widget tags", () => {
    const content = fixture("home_screen.dart");
    const chunks = dartChunker.chunk("lib/ui/home_screen.dart", content);

    const classChunk = chunks.find((c) => c.kind === "class");
    expect(classChunk).toBeDefined();
    expect(classChunk!.symbolName).toBe("HomeScreen");
    expect(classChunk!.language).toBe("dart");
    expect(classChunk!.tags).toContain("flutter");
    expect(classChunk!.tags).toContain("widget");
    expect(classChunk!.defines).toContain("lib/ui/home_screen.dart.HomeScreen");
  });

  it("should chunk enum with members in sketch", () => {
    const content = fixture("models.dart");
    const chunks = dartChunker.chunk("lib/models.dart", content);

    const enumChunk = chunks.find((c) => c.kind === "enum");
    expect(enumChunk).toBeDefined();
    expect(enumChunk!.symbolName).toBe("UserRole");
    expect(enumChunk!.textSketch).toContain("admin");
  });

  it("should chunk mixin", () => {
    const content = fixture("models.dart");
    const chunks = dartChunker.chunk("lib/models.dart", content);

    const mixinChunk = chunks.find((c) => c.kind === "mixin");
    expect(mixinChunk).toBeDefined();
    expect(mixinChunk!.symbolName).toBe("Validatable");
  });

  it("should chunk typedef", () => {
    const content = fixture("models.dart");
    const chunks = dartChunker.chunk("lib/models.dart", content);

    const typeAliasChunk = chunks.find((c) => c.kind === "type_alias");
    expect(typeAliasChunk).toBeDefined();
    expect(typeAliasChunk!.symbolName).toBe("UserMap");
  });

  it("should chunk extension", () => {
    const content = fixture("models.dart");
    const chunks = dartChunker.chunk("lib/models.dart", content);

    const extensionChunk = chunks.find((c) => c.kind === "extension");
    expect(extensionChunk).toBeDefined();
    expect(extensionChunk!.symbolName).toBe("StringFormatting");
  });

  it("should chunk abstract class with async methods", () => {
    const content = fixture("user_repository.dart");
    const chunks = dartChunker.chunk("lib/data/user_repository.dart", content);

    const abstractChunk = chunks.find((c) => c.symbolName === "Repository");
    expect(abstractChunk).toBeDefined();
    expect(abstractChunk!.kind).toBe("class");
    expect(abstractChunk!.tags).toContain("async");
  });

  it("should extract imports into uses", () => {
    const content = fixture("user_repository.dart");
    const chunks = dartChunker.chunk("lib/data/user_repository.dart", content);

    const repoChunk = chunks.find((c) => c.symbolName === "UserRepository");
    expect(repoChunk).toBeDefined();
    expect(repoChunk!.uses.length).toBeGreaterThan(0);
  });

  it("should have valid chunk IDs", () => {
    const content = fixture("home_screen.dart");
    const chunks = dartChunker.chunk("lib/ui/home_screen.dart", content);

    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^[a-f0-9]{24}$/);
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  it("should include doc comment in chunk text", () => {
    const content = fixture("home_screen.dart");
    const chunks = dartChunker.chunk("lib/ui/home_screen.dart", content);

    const classChunk = chunks.find((c) => c.kind === "class");
    expect(classChunk).toBeDefined();
    expect(classChunk!.textRaw).toContain("/// A simple home screen widget");
  });

  it("should detect freezed tag from annotation", () => {
    const content = fixture("models.dart");
    const chunks = dartChunker.chunk("lib/models.dart", content);

    const userChunk = chunks.find((c) => c.symbolName === "User");
    expect(userChunk).toBeDefined();
    expect(userChunk!.tags).toContain("freezed");
  });
});
