import { chmodSync } from "node:fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const SCHEMA_VERSION = 3;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  path TEXT NOT NULL,
  module TEXT,
  source_set TEXT,
  language TEXT NOT NULL,
  kind TEXT NOT NULL,
  symbol_name TEXT,
  symbol_fqname TEXT,
  signature TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text_raw TEXT NOT NULL,
  text_sketch TEXT NOT NULL,
  tags TEXT,
  annotations TEXT,
  defines TEXT,
  uses TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_repo_path ON chunks(repo_path, path);
CREATE INDEX IF NOT EXISTS idx_chunks_language ON chunks(repo_path, language);
CREATE INDEX IF NOT EXISTS idx_chunks_kind ON chunks(repo_path, kind);
CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON chunks(repo_path, symbol_name);
CREATE INDEX IF NOT EXISTS idx_chunks_module ON chunks(repo_path, module);
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON chunks(content_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  symbol_name, symbol_fqname, text_raw, path, tags,
  content='chunks', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, symbol_name, symbol_fqname, text_raw, path, tags)
  VALUES (new.rowid, new.symbol_name, new.symbol_fqname, new.text_raw, new.path, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, symbol_name, symbol_fqname, text_raw, path, tags)
  VALUES ('delete', old.rowid, old.symbol_name, old.symbol_fqname, old.text_raw, old.path, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, symbol_name, symbol_fqname, text_raw, path, tags)
  VALUES ('delete', old.rowid, old.symbol_name, old.symbol_fqname, old.text_raw, old.path, old.tags);
  INSERT INTO chunks_fts(rowid, symbol_name, symbol_fqname, text_raw, path, tags)
  VALUES (new.rowid, new.symbol_name, new.symbol_fqname, new.text_raw, new.path, new.tags);
END;

CREATE TABLE IF NOT EXISTS index_meta (
  repo_path TEXT PRIMARY KEY,
  last_commit_sha TEXT,
  last_indexed_at TEXT,
  total_chunks INTEGER,
  total_files INTEGER
);
`;

export function openDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? (process.env.HOME ?? "~") + "/.scrooge/scrooge.db";
  const db = new Database(resolvedPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  sqliteVec.load(db);

  runMigrations(db);

  // Restrict file permissions (skip for in-memory DBs)
  if (resolvedPath !== ":memory:" && !resolvedPath.startsWith(":")) {
    try { chmodSync(resolvedPath, 0o600); } catch { /* may not own file */ }
  }

  // TTL cleanup: remove tool_calls older than 90 days
  try {
    db.prepare("DELETE FROM tool_calls WHERE called_at < datetime('now', '-90 days')").run();
  } catch { /* table may not exist yet on first run */ }

  return db;
}

const TOOL_CALLS_SQL = `
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  called_at TEXT DEFAULT (datetime('now')),
  duration_ms INTEGER,
  tokens_sent INTEGER DEFAULT 0,
  tokens_raw INTEGER DEFAULT 0,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_repo ON tool_calls(repo_path, called_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool, called_at);
`;

export function runMigrations(db: Database.Database): void {
  const currentVersion = (db.pragma("user_version") as Array<{ user_version: number }>)[0].user_version;
  if (currentVersion >= SCHEMA_VERSION) return;

  if (currentVersion < 1) {
    const statements = splitStatements(SCHEMA_SQL);
    db.transaction(() => {
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (trimmed) {
          db.exec(trimmed);
        }
      }
    })();

    // Create the vec table separately (virtual tables can't be in transactions easily)
    ensureVecTable(db);
  }

  if (currentVersion < 2) {
    const statements = splitStatements(TOOL_CALLS_SQL);
    db.transaction(() => {
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (trimmed) {
          db.exec(trimmed);
        }
      }
    })();
  }

  if (currentVersion < 3) {
    db.exec("ALTER TABLE tool_calls ADD COLUMN channel TEXT DEFAULT 'mcp'");
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

function ensureVecTable(db: Database.Database): void {
  // Check if vec table exists
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'")
    .get();
  if (!exists) {
    db.exec(`
      CREATE VIRTUAL TABLE chunks_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384]
      );
    `);
  }
}

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inTrigger = false;

  for (const line of sql.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("--")) {
      continue;
    }

    if (/^CREATE\s+TRIGGER/i.test(trimmed)) {
      inTrigger = true;
    }

    current += line + "\n";

    if (inTrigger && /^END;/i.test(trimmed)) {
      statements.push(current);
      current = "";
      inTrigger = false;
    } else if (!inTrigger && trimmed.endsWith(";")) {
      statements.push(current);
      current = "";
    }
  }

  if (current.trim()) {
    statements.push(current);
  }

  return statements;
}

export interface IndexMeta {
  repo_path: string;
  last_commit_sha: string | null;
  last_indexed_at: string | null;
  total_chunks: number;
  total_files: number;
}

export function getIndexMeta(db: Database.Database, repoPath: string): IndexMeta | null {
  return db
    .prepare("SELECT * FROM index_meta WHERE repo_path = ?")
    .get(repoPath) as IndexMeta | null;
}

export function upsertIndexMeta(
  db: Database.Database,
  meta: IndexMeta,
): void {
  db.prepare(`
    INSERT INTO index_meta (repo_path, last_commit_sha, last_indexed_at, total_chunks, total_files)
    VALUES (@repo_path, @last_commit_sha, @last_indexed_at, @total_chunks, @total_files)
    ON CONFLICT(repo_path) DO UPDATE SET
      last_commit_sha = @last_commit_sha,
      last_indexed_at = @last_indexed_at,
      total_chunks = @total_chunks,
      total_files = @total_files
  `).run(meta);
}

export interface ChunkRow {
  id: string;
  repo_path: string;
  commit_sha: string;
  path: string;
  module: string | null;
  source_set: string | null;
  language: string;
  kind: string;
  symbol_name: string | null;
  symbol_fqname: string | null;
  signature: string | null;
  start_line: number;
  end_line: number;
  text_raw: string;
  text_sketch: string;
  tags: string | null;
  annotations: string | null;
  defines: string | null;
  uses: string | null;
  content_hash: string;
  created_at: string;
}

export function insertChunk(db: Database.Database, chunk: Omit<ChunkRow, "created_at">): void {
  db.prepare(`
    INSERT OR REPLACE INTO chunks
      (id, repo_path, commit_sha, path, module, source_set, language, kind,
       symbol_name, symbol_fqname, signature, start_line, end_line,
       text_raw, text_sketch, tags, annotations, defines, uses, content_hash)
    VALUES
      (@id, @repo_path, @commit_sha, @path, @module, @source_set, @language, @kind,
       @symbol_name, @symbol_fqname, @signature, @start_line, @end_line,
       @text_raw, @text_sketch, @tags, @annotations, @defines, @uses, @content_hash)
  `).run(chunk);
}

export function deleteChunksByPath(db: Database.Database, repoPath: string, filePath: string): void {
  db.prepare("DELETE FROM chunks WHERE repo_path = ? AND path = ?").run(repoPath, filePath);
}

export function deleteChunksByRepo(db: Database.Database, repoPath: string): void {
  db.prepare("DELETE FROM chunks WHERE repo_path = ?").run(repoPath);
}

export function insertVecEmbedding(db: Database.Database, id: string, embedding: Float32Array): void {
  db.prepare("INSERT OR REPLACE INTO chunks_vec(id, embedding) VALUES (?, ?)").run(id, embedding);
}

export function deleteVecByIds(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    db.prepare(`DELETE FROM chunks_vec WHERE id IN (${placeholders})`).run(...batch);
  }
}

export function getChunkIdsByPath(db: Database.Database, repoPath: string, filePath: string): string[] {
  const rows = db
    .prepare("SELECT id FROM chunks WHERE repo_path = ? AND path = ?")
    .all(repoPath, filePath) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export interface ToolCallRecord {
  tool: string;
  repo_path: string;
  duration_ms: number;
  tokens_sent: number;
  tokens_raw: number;
  channel?: string;
  metadata?: Record<string, unknown>;
}

export function recordToolCall(db: Database.Database, data: ToolCallRecord): void {
  db.prepare(`
    INSERT INTO tool_calls (tool, repo_path, duration_ms, tokens_sent, tokens_raw, channel, metadata)
    VALUES (@tool, @repo_path, @duration_ms, @tokens_sent, @tokens_raw, @channel, @metadata)
  `).run({
    tool: data.tool,
    repo_path: data.repo_path,
    duration_ms: data.duration_ms,
    tokens_sent: data.tokens_sent,
    tokens_raw: data.tokens_raw,
    channel: data.channel ?? "mcp",
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
  });
}
