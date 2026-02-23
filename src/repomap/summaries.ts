import type Database from "better-sqlite3";

export interface ModuleSummary {
  module: string;
  fileCount: number;
  chunkCount: number;
  languages: Record<string, number>;
  topSymbols: string[];
}

export interface FileSummary {
  path: string;
  language: string;
  chunkCount: number;
  symbols: Array<{ name: string; kind: string; signature: string | null }>;
}

/**
 * Generate module-level summaries from indexed data.
 */
export function getModuleSummaries(db: Database.Database, repoPath: string): ModuleSummary[] {
  const modules = db
    .prepare(`
      SELECT module, COUNT(DISTINCT path) as file_count, COUNT(*) as chunk_count
      FROM chunks WHERE repo_path = ? AND module IS NOT NULL
      GROUP BY module ORDER BY chunk_count DESC
    `)
    .all(repoPath) as Array<{ module: string; file_count: number; chunk_count: number }>;

  return modules.map((m) => {
    const langs = db
      .prepare(`
        SELECT language, COUNT(*) as cnt
        FROM chunks WHERE repo_path = ? AND module = ?
        GROUP BY language ORDER BY cnt DESC
      `)
      .all(repoPath, m.module) as Array<{ language: string; cnt: number }>;

    const symbols = db
      .prepare(`
        SELECT symbol_name FROM chunks
        WHERE repo_path = ? AND module = ? AND symbol_name IS NOT NULL
          AND kind IN ('class', 'object', 'viewmodel', 'api_interface', 'dao', 'entity')
        ORDER BY kind, symbol_name LIMIT 20
      `)
      .all(repoPath, m.module) as Array<{ symbol_name: string }>;

    return {
      module: m.module,
      fileCount: m.file_count,
      chunkCount: m.chunk_count,
      languages: Object.fromEntries(langs.map((l) => [l.language, l.cnt])),
      topSymbols: symbols.map((s) => s.symbol_name),
    };
  });
}

/**
 * Generate file-level summaries with exported symbols.
 */
export function getFileSummaries(
  db: Database.Database,
  repoPath: string,
  module?: string,
): FileSummary[] {
  let sql = `
    SELECT DISTINCT path, language, COUNT(*) as chunk_count
    FROM chunks WHERE repo_path = ?
  `;
  const params: unknown[] = [repoPath];

  if (module) {
    sql += " AND module = ?";
    params.push(module);
  }

  sql += " GROUP BY path ORDER BY path";

  const files = db.prepare(sql).all(...params) as Array<{
    path: string;
    language: string;
    chunk_count: number;
  }>;

  return files.map((f) => {
    const symbols = db
      .prepare(`
        SELECT symbol_name, kind, signature FROM chunks
        WHERE repo_path = ? AND path = ? AND symbol_name IS NOT NULL
        ORDER BY start_line
      `)
      .all(repoPath, f.path) as Array<{
      symbol_name: string;
      kind: string;
      signature: string | null;
    }>;

    return {
      path: f.path,
      language: f.language,
      chunkCount: f.chunk_count,
      symbols: symbols.map((s) => ({
        name: s.symbol_name,
        kind: s.kind,
        signature: s.signature,
      })),
    };
  });
}
