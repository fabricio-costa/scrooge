import type { SearchResult } from "./lexical.js";
import { estimateTokens } from "../utils/tokens.js";
import { getConfig } from "../utils/config.js";

export type ViewMode = "sketch" | "raw";

export interface PackagedResult {
  results: PackagedChunk[];
  totalTokens: number;
  truncated: boolean;
}

export interface PackagedChunk {
  path: string;
  lines: string;
  symbolName: string | null;
  kind: string;
  score: number;
  source: string;
  snippet: string;
}

/**
 * Package search results within a token budget.
 * Applies diversity constraints and view mode selection.
 */
export function packageResults(
  results: SearchResult[],
  view: ViewMode = "sketch",
  tokenBudget?: number,
): PackagedResult {
  const config = getConfig();
  const budget = tokenBudget ?? config.defaultTokenBudget;
  const maxPerFile = config.maxChunksPerFile;

  // Apply diversity: max N chunks from the same file
  const fileCount = new Map<string, number>();
  const diverse: SearchResult[] = [];

  for (const result of results) {
    const path = result.chunk.path;
    const count = fileCount.get(path) ?? 0;
    if (count >= maxPerFile) continue;
    fileCount.set(path, count + 1);
    diverse.push(result);
  }

  // Package with token budget
  const packaged: PackagedChunk[] = [];
  let totalTokens = 0;

  for (const result of diverse) {
    const snippet = view === "sketch" ? result.chunk.text_sketch : result.chunk.text_raw;
    const tokens = estimateTokens(snippet);

    if (totalTokens + tokens > budget) {
      return { results: packaged, totalTokens, truncated: true };
    }

    packaged.push({
      path: result.chunk.path,
      lines: `${result.chunk.start_line}-${result.chunk.end_line}`,
      symbolName: result.chunk.symbol_name,
      kind: result.chunk.kind,
      score: Math.round(result.score * 10000) / 10000,
      source: result.source,
      snippet,
    });

    totalTokens += tokens;
  }

  return { results: packaged, totalTokens, truncated: false };
}
