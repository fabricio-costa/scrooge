import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export interface ScroogeConfig {
  dbPath: string;
  defaultTokenBudget: number;
  defaultMaxResults: number;
  maxChunksPerFile: number;
  sketchMaxTokens: number;
  rrfK: number;
  embeddingModel: string;
  embeddingDims: number;
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
};

let _config: ScroogeConfig | null = null;

export function getConfig(overrides?: Partial<ScroogeConfig>): ScroogeConfig {
  if (_config && !overrides) return _config;
  _config = { ...DEFAULT_CONFIG, ...overrides };

  // Ensure db directory exists
  const dbDir = join(_config.dbPath, "..");
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  return _config;
}

