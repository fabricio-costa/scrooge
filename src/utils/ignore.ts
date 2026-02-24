import { basename, extname } from "node:path";

const ALWAYS_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".gradle",
  ".idea",
  ".vscode",
  "build",
  "dist",
  ".cxx",
  ".kotlin",
  "__pycache__",
]);

const ALWAYS_IGNORE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".zip",
  ".tar",
  ".gz",
  ".jar",
  ".aar",
  ".apk",
  ".aab",
  ".keystore",
  ".jks",
  ".so",
  ".dylib",
  ".dll",
  ".class",
  ".dex",
  ".lock",
  ".db",
  ".db-journal",
  ".db-wal",
  ".bin",
  ".dat",
]);

const ALWAYS_IGNORE_FILES = new Set([
  "gradlew",
  "gradlew.bat",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".DS_Store",
  "Thumbs.db",
]);

const SENSITIVE_FILES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.staging",
  ".env.test",
  "credentials.json",
  "service-account.json",
  "service_account.json",
  "local.properties",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
]);

const SENSITIVE_EXTENSIONS = new Set([
  ".pem",
  ".p12",
  ".pfx",
  ".key",
  ".crt",
  ".cert",
]);

export function shouldIgnore(filePath: string): boolean {
  const parts = filePath.split("/");
  const fileName = basename(filePath);
  const ext = extname(filePath).toLowerCase();

  // Check directory-level ignores
  for (const part of parts) {
    if (ALWAYS_IGNORE_DIRS.has(part)) return true;
  }

  // Check file-level ignores
  if (ALWAYS_IGNORE_FILES.has(fileName)) return true;

  // Check extension ignores
  if (ALWAYS_IGNORE_EXTENSIONS.has(ext)) return true;

  // Check sensitive files (secrets, credentials, keys)
  if (SENSITIVE_FILES.has(fileName)) return true;
  if (SENSITIVE_EXTENSIONS.has(ext)) return true;

  return false;
}

export function filterFiles(files: string[]): string[] {
  return files.filter((f) => !shouldIgnore(f));
}
