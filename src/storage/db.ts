import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;
  _db = openDb(dbPath);
  return _db;
}

export function openDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? join(process.env.HOME ?? "~", ".scrooge", "scrooge.db");
  const db = new Database(resolvedPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  sqliteVec.load(db);

  runMigrations(db);
  return db;
}

export function runMigrations(db: Database.Database): void {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");

  // Split on semicolons but preserve content inside trigger blocks
  const statements = splitStatements(schema);

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

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
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
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM chunks_vec WHERE id IN (${placeholders})`).run(...ids);
}

export function getChunkIdsByPath(db: Database.Database, repoPath: string, filePath: string): string[] {
  const rows = db
    .prepare("SELECT id FROM chunks WHERE repo_path = ? AND path = ?")
    .all(repoPath, filePath) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
