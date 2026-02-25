import { join, dirname } from "node:path";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface ScroogeConfig {
  dbPath: string;
  defaultTokenBudget: number;
  defaultMaxResults: number;
  maxChunksPerFile: number;
  sketchMaxTokens: number;
  rrfK: number;
  embeddingModel: string;
  embeddingDims: number;
  modelPath: string;
}

const DEFAULT_CONFIG: ScroogeConfig = {
  dbPath: join(process.env.HOME ?? "~", ".scrooge", "scrooge.db"),
  defaultTokenBudget: 3000,
  defaultMaxResults: 8,
  maxChunksPerFile: 3,
  sketchMaxTokens: 200,
  rrfK: 60,
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
  embeddingDims: 384,
  modelPath: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "models"),
};

let _config: ScroogeConfig | null = null;

export function getConfig(overrides?: Partial<ScroogeConfig>): ScroogeConfig {
  if (_config && !overrides) return _config;
  _config = { ...DEFAULT_CONFIG, ...overrides };

  // Ensure db directory exists with restrictive permissions
  const dbDir = join(_config.dbPath, "..");
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  } else {
    try { chmodSync(dbDir, 0o700); } catch { /* may not own dir */ }
  }

  return _config;
}

