import type { PackagedChunk } from "../retrieval/packager.js";
import type { ViewMode } from "../retrieval/packager.js";
import type { IndexStats } from "../indexer/pipeline.js";

export type Channel = "mcp" | "pi" | "cli" | "test";

export interface ApiContext {
  channel: Channel;
  repoPath?: string;
  /** Override dbPath for testing (e.g., ":memory:") */
  dbPath?: string;
  /** AI model identifier (e.g., "claude-opus-4-6") from SCROOGE_MODEL env var */
  model?: string;
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
  id: string;
  path: string;
  lines: string;
  kind: string;
  symbol: string | null;
  module: string | null;
  language: string;
  signature: string | null;
  sketch: string;
}

export interface LookupResponse {
  symbol: string;
  definitions: LookupChunk[];
  usages?: LookupChunk[];
  _note?: string;
}

// --- Source ---

export interface SourceParams {
  chunkId?: string;
  symbol?: string;
  before?: number;
  after?: number;
}

export interface SourceContext {
  lines: string;
  text: string;
}

export interface SourceChunk {
  id: string;
  path: string;
  lines: string;
  kind: string;
  symbol: string | null;
  module: string | null;
  language: string;
  signature: string | null;
  source: string;
  beforeContext?: SourceContext;
  afterContext?: SourceContext;
}

export interface SourceResponse {
  chunkId?: string;
  symbol?: string;
  before: number;
  after: number;
  chunks: SourceChunk[];
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

// --- Context ---

export interface ContextParams {
  kind: string;
  module?: string;
}

export interface ContextResponse {
  kind: string;
  sampleCount: number;
  commonAnnotations: string[];
  commonTags: string[];
  commonImports: string[];
  exampleSketches: Array<{ path: string; sketch: string }>;
}

// --- Deps ---

export interface DepsParams {
  symbol: string;
  direction?: "forward" | "reverse" | "both";
}

export interface DepEntry {
  symbol: string;
  path: string;
  kind: string;
  module: string | null;
}

export interface DepsResponse {
  symbol: string;
  definitions: DepEntry[];
  forward: DepEntry[];
  reverse: DepEntry[];
}

// --- Statistics ---

export type StatisticsPeriod = "today" | "week" | "month" | "all";
export type StatisticsFormat = "text" | "json";

export interface StatisticsParams {
  period?: StatisticsPeriod;
  format?: StatisticsFormat;
}

export interface StatisticsTotals {
  totalCalls: number;
  tokensDelivered: number;
  rawEquivalent: number;
  tokensSaved: number;
  savingsPct: number;
}

export interface StatisticsToolSummary {
  tool: string;
  callCount: number;
  tokensSent: number;
  tokensRaw: number;
  tokensSaved: number;
  savingsPct: number | null;
}

export interface StatisticsChannelSummary {
  channel: string;
  callCount: number;
}

export interface StatisticsModelSummary {
  model: string;
  callCount: number;
  tokensSent: number;
}

export interface StatisticsSearchInsights {
  callCount: number;
  avgResults: number;
  avgTokens: number;
  sourceCounts: { lexical: number; vector: number; both: number };
  sourceMixPct: { lexical: number; vector: number; both: number };
}

export interface StatisticsToolCount {
  tool: string;
  count: number;
}

export interface StatisticsPathCount {
  path: string;
  count: number;
}

export interface StatisticsSelectorCount {
  selector: string;
  count: number;
}

export interface StatisticsReasonCount {
  reasonCode: string;
  count: number;
}

export interface StatisticsCodeReadExtensionSummary {
  extension: string;
  total: number;
  guided: number;
  blind: number;
  blindRatePct: number;
}

export interface StatisticsGuidedReadSummary {
  tool: string;
  count: number;
  bouncePct: number | null;
}

export interface StatisticsCoverageSummary {
  scroogeExplorationTotal: number;
  nativeExplorationTotal: number;
  totalExploration: number;
  coveragePct: number;
  scroogeExplorationByTool: StatisticsToolCount[];
  nativeExplorationByTool: StatisticsToolCount[];
  codeReads: {
    total: number;
    guided: number;
    blind: number;
    blindRatePct: number;
    byExtension: StatisticsCodeReadExtensionSummary[];
    guidedBy: StatisticsGuidedReadSummary[];
    blindHotspots: StatisticsPathCount[];
  };
  grepBypasses: StatisticsSelectorCount[];
  globBypasses: StatisticsSelectorCount[];
  bypassReasons: StatisticsReasonCount[];
  otherCalls: StatisticsToolCount[];
}

export interface StatisticsData {
  repo: {
    path: string;
    name: string;
  };
  period: {
    key: StatisticsPeriod;
    label: string;
    since: string | null;
    firstCallAt: string | null;
  };
  generatedAt: string;
  empty: boolean;
  message?: string;
  totals: StatisticsTotals;
  usageByTool: StatisticsToolSummary[];
  savingsByTool: StatisticsToolSummary[];
  channels: StatisticsChannelSummary[];
  models: StatisticsModelSummary[];
  searchInsights: StatisticsSearchInsights | null;
  coverage: StatisticsCoverageSummary | null;
}

export interface StatisticsResponse {
  format: StatisticsFormat;
  report: string;
  data: StatisticsData;
}

// --- Export ---

export interface ExportParams {
  period?: "today" | "week" | "month" | "all";
  tool?: string;
  format?: "jsonl" | "csv";
  anonymize?: boolean;
  limit?: number;
}

export interface ExportRecord {
  id: number;
  tool: string;
  repo: string;
  called_at: string;
  duration_ms: number;
  tokens_sent: number;
  tokens_raw: number;
  channel: string;
  model: string | null;
  [key: string]: unknown;
}

export interface ExportResponse {
  records: ExportRecord[];
  format: "jsonl" | "csv";
  count: number;
}
