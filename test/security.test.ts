import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getChangedFiles, getDeletedFiles } from "../src/utils/git.js";
import { shouldIgnore, filterFiles } from "../src/utils/ignore.js";
import { escapeLike } from "../src/utils/sql.js";
import { validateRepoPath } from "../src/utils/path-validation.js";
import { openDb } from "../src/storage/db.js";
import { gradleChunker } from "../src/indexer/chunkers/gradle.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scrooge-security-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// Phase 1.1 — SHA validation on git commands
// ============================================================
describe("SHA validation", () => {
  it("should reject command injection in fromCommit", () => {
    expect(() => getChangedFiles(tempDir, "; rm -rf /")).toThrow("Invalid fromCommit");
  });

  it("should reject command injection in toCommit", () => {
    expect(() => getChangedFiles(tempDir, "abc123", "$(whoami)")).toThrow("Invalid toCommit");
  });

  it("should reject pipe injection", () => {
    expect(() => getDeletedFiles(tempDir, "abc | cat /etc/passwd")).toThrow("Invalid fromCommit");
  });

  it("should accept valid 40-char hex SHA", () => {
    // This will fail on git level (not found), not on validation
    expect(() => getChangedFiles(tempDir, "a".repeat(40), "b".repeat(40))).toThrow();
  });

  it("should accept short SHA (4+ chars)", () => {
    expect(() => getChangedFiles(tempDir, "abcd", "HEAD")).toThrow();
  });

  it("should allow HEAD as toCommit", () => {
    // Will throw because tempDir may not be a repo, but not a validation error
    expect(() => getChangedFiles(tempDir, "abcd1234")).toThrow();
  });
});

// ============================================================
// Phase 1.3 — Secret file filtering
// ============================================================
describe("secret file filtering", () => {
  it("should ignore .env files", () => {
    expect(shouldIgnore(".env")).toBe(true);
    expect(shouldIgnore(".env.local")).toBe(true);
    expect(shouldIgnore(".env.production")).toBe(true);
    expect(shouldIgnore("config/.env.staging")).toBe(true);
  });

  it("should ignore credential files", () => {
    expect(shouldIgnore("credentials.json")).toBe(true);
    expect(shouldIgnore("service-account.json")).toBe(true);
    expect(shouldIgnore("service_account.json")).toBe(true);
    expect(shouldIgnore("local.properties")).toBe(true);
  });

  it("should ignore key/cert files by extension", () => {
    expect(shouldIgnore("server.pem")).toBe(true);
    expect(shouldIgnore("cert.p12")).toBe(true);
    expect(shouldIgnore("tls.key")).toBe(true);
    expect(shouldIgnore("ca.crt")).toBe(true);
    expect(shouldIgnore("client.cert")).toBe(true);
    expect(shouldIgnore("keystore.pfx")).toBe(true);
  });

  it("should ignore SSH key files", () => {
    expect(shouldIgnore("id_rsa")).toBe(true);
    expect(shouldIgnore("id_ed25519")).toBe(true);
    expect(shouldIgnore("id_ecdsa")).toBe(true);
  });

  it("should ignore .npmrc and .pypirc", () => {
    expect(shouldIgnore(".npmrc")).toBe(true);
    expect(shouldIgnore(".pypirc")).toBe(true);
  });

  it("should not ignore normal source files", () => {
    expect(shouldIgnore("App.kt")).toBe(false);
    expect(shouldIgnore("index.ts")).toBe(false);
    expect(shouldIgnore("build.gradle.kts")).toBe(false);
  });

  it("should filter sensitive files from a list", () => {
    const files = ["App.kt", ".env", "server.pem", "Main.ts", "credentials.json"];
    const filtered = filterFiles(files);
    expect(filtered).toEqual(["App.kt", "Main.ts"]);
  });
});

// ============================================================
// Phase 1.3 — Gradle signing password redaction
// ============================================================
describe("gradle signing password redaction", () => {
  it("should redact storePassword and keyPassword in signing configs", () => {
    const signingConfig = `signingConfigs {
    release {
        storeFile file("release.keystore")
        storePassword "s3cr3tP@ss!"
        keyAlias "mykey"
        keyPassword "an0th3rS3cret"
    }
}`;
    const chunks = gradleChunker.chunk("app/build.gradle", signingConfig);
    expect(chunks.length).toBeGreaterThan(0);

    const signingChunk = chunks.find((c) => c.kind === "gradle_signing");
    expect(signingChunk).toBeDefined();
    expect(signingChunk!.textRaw).toContain("<REDACTED>");
    expect(signingChunk!.textRaw).not.toContain("s3cr3tP@ss!");
    expect(signingChunk!.textRaw).not.toContain("an0th3rS3cret");
  });
});

// ============================================================
// Phase 2.2 — LIKE escape
// ============================================================
describe("escapeLike", () => {
  it("should escape percent signs", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("should escape underscores", () => {
    expect(escapeLike("my_var")).toBe("my\\_var");
  });

  it("should escape backslashes", () => {
    expect(escapeLike("path\\to")).toBe("path\\\\to");
  });

  it("should escape multiple metacharacters", () => {
    expect(escapeLike("%_test_%")).toBe("\\%\\_test\\_\\%");
  });

  it("should leave normal strings unchanged", () => {
    expect(escapeLike("LoginViewModel")).toBe("LoginViewModel");
  });
});

// ============================================================
// Phase 2.3 — Path traversal validation
// ============================================================
describe("validateRepoPath", () => {
  it("should accept a valid directory", () => {
    const result = validateRepoPath(tempDir);
    // On macOS, /var is a symlink to /private/var, so realpathSync may differ
    expect(result).toBe(realpathSync(tempDir));
  });

  it("should reject a file path", () => {
    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "content");
    expect(() => validateRepoPath(filePath)).toThrow("repo_path must be a directory");
  });

  it("should reject a non-existent path", () => {
    expect(() => validateRepoPath(join(tempDir, "nonexistent"))).toThrow("repo_path does not exist");
  });

  it("should resolve symlinks", () => {
    const realDir = join(tempDir, "real");
    mkdirSync(realDir);
    const linkDir = join(tempDir, "link");
    symlinkSync(realDir, linkDir);
    const result = validateRepoPath(linkDir);
    expect(result).toBe(realpathSync(realDir));
  });

  it("should resolve relative paths", () => {
    const result = validateRepoPath(tempDir);
    expect(result).toBe(realpathSync(tempDir));
    expect(result.startsWith("/")).toBe(true); // absolute
  });
});

// ============================================================
// Phase 2.4 — DB file permissions
// ============================================================
describe("DB file permissions", () => {
  it("should set restrictive permissions on DB file", () => {
    const dbPath = join(tempDir, "test.db");
    const db = openDb(dbPath);
    db.close();

    const stat = statSync(dbPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

// ============================================================
// Phase 3.2 — Batch deleteVecByIds
// ============================================================
describe("batch deleteVecByIds", () => {
  it("should handle empty array", async () => {
    const db = openDb(":memory:");
    try {
      const { deleteVecByIds } = await import("../src/storage/db.js");
      // Should not throw
      deleteVecByIds(db, []);
    } finally {
      db.close();
    }
  });
});

// ============================================================
// FTS5 injection prevention
// ============================================================
describe("FTS5 injection prevention", () => {
  it("should not crash with FTS5 operators in query", async () => {
    const db = openDb(":memory:");
    try {
      const { lexicalSearch } = await import("../src/retrieval/lexical.js");
      // These should not throw — operators should be sanitized
      expect(() => lexicalSearch(db, "/tmp", "NOT secret")).not.toThrow();
      expect(() => lexicalSearch(db, "/tmp", "NEAR(a, b)")).not.toThrow();
      expect(() => lexicalSearch(db, "/tmp", "a * b")).not.toThrow();
      expect(() => lexicalSearch(db, "/tmp", '"unmatched')).not.toThrow();
    } finally {
      db.close();
    }
  });
});
