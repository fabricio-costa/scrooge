import type { PackagedChunk } from "../retrieval/packager.js";
import type { ViewMode } from "../retrieval/packager.js";
import type { IndexStats } from "../indexer/pipeline.js";

export type Channel = "mcp" | "pi" | "cli" | "test";

export interface ApiContext {
  channel: Channel;
  repoPath?: string;
  /** Override dbPath for testing (e.g., ":memory:") */
  dbPath?: string;
}

// --- Search ---

export interface SearchParams {
  query: string;
  filters?: {
    module?: string;
    language?: string;
    kind?: string;
    tags?: string[];
  };
  view?: ViewMode;
  maxResults?: number;
  tokenBudget?: number;
}

export interface SearchResponse {
  results: PackagedChunk[];
  totalTokens: number;
  truncated: boolean;
  sources: { lexical: number; vector: number; both: number };
  _note?: string;
}

// --- Lookup ---

export interface LookupParams {
  symbol: string;
  includeUsages?: boolean;
}

export interface LookupChunk {
  path: string;
  lines: string;
  kind: string;
  symbol: string | null;
  module: string | null;
  sketch: string;
}

export interface LookupResponse {
  symbol: string;
  definitions: LookupChunk[];
  usages?: LookupChunk[];
  _note?: string;
}

// --- Map ---

export type MapLevel = "repo" | "modules" | "files";

export interface MapParams {
  level?: MapLevel;
  module?: string;
}

export interface MapResponse {
  content: string;
}

// --- Reindex ---

export interface ReindexParams {
  incremental?: boolean;
}

export interface ReindexResponse {
  status: "success" | "error";
  repo: string;
  error?: string;
  stats?: IndexStats;
}

// --- Status ---

export interface StatusResponse {
  status: "indexed" | "not_indexed";
  repo: string;
  message?: string;
  last_commit_sha?: string | null;
  last_indexed_at?: string | null;
  total_chunks?: number;
  total_files?: number;
  freshness?: string;
}

// --- Statistics ---

export interface StatisticsParams {
  period?: "today" | "week" | "month" | "all";
}

export interface StatisticsResponse {
  report: string;
}
