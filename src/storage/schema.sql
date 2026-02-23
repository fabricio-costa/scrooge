-- Scrooge schema v1

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
  tags TEXT,          -- JSON array
  annotations TEXT,   -- JSON array
  defines TEXT,       -- JSON array of fqnames defined
  uses TEXT,          -- JSON array of fqnames used
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

-- Triggers to keep FTS in sync
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
