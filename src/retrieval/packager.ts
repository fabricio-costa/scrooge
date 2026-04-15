import type { SearchResult } from "./lexical.js";
import { estimateTokens, truncateToTokenBudget } from "../utils/tokens.js";
import { getConfig } from "../utils/config.js";
import { extractSearchTerms } from "./query.js";

export type ViewMode = "sketch" | "implementation" | "raw";

export interface PackagerStats {
  inputCount: number;
  afterDiversity: number;
  diversityRejected: number;
  uniqueFiles: number;
  tokenBudget: number;
  tokenBudgetUsed: number;
  tokenBudgetUtilization: number;
}

export interface PackagedResult {
  results: PackagedChunk[];
  totalTokens: number;
  truncated: boolean;
  stats: PackagerStats;
}

export interface PackagedChunk {
  id: string;
  path: string;
  lines: string;
  symbolName: string | null;
  kind: string;
  score: number;
  source: string;
  snippet: string;
  module: string | null;
  language: string;
  signature: string | null;
  uses?: string[];
  highlights?: string[];
}

/**
 * Package search results within a token budget.
 * Applies diversity constraints and view mode selection.
 */
export function packageResults(
  results: SearchResult[],
  view: ViewMode = "sketch",
  tokenBudget?: number,
  query?: string,
): PackagedResult {
  const config = getConfig();
  const budget = tokenBudget ?? getDefaultTokenBudget(view, config.defaultTokenBudget);
  const maxPerFile = getMaxChunksPerFile(view, config.maxChunksPerFile);

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

  const uniqueFiles = new Set(diverse.map((r) => r.chunk.path)).size;

  // Package with token budget
  const packaged: PackagedChunk[] = [];
  let totalTokens = 0;

  for (const result of diverse) {
    const uses = parseStringArray(result.chunk.uses).slice(0, 5);
    const highlights = collectHighlights(result.chunk.text_raw, result.chunk.signature, query);
    const snippet = buildSnippet(result, view, highlights, uses);

    const packagedChunk: PackagedChunk = {
      id: result.chunk.id,
      path: result.chunk.path,
      lines: `${result.chunk.start_line}-${result.chunk.end_line}`,
      symbolName: result.chunk.symbol_name,
      kind: result.chunk.kind,
      score: Math.round(result.score * 10000) / 10000,
      source: result.source,
      snippet,
      module: result.chunk.module,
      language: result.chunk.language,
      signature: result.chunk.signature,
      ...(uses.length > 0 ? { uses } : {}),
      ...(view !== "raw" && highlights.length > 0 ? { highlights } : {}),
    };

    const tokens = estimateTokens(JSON.stringify(packagedChunk));

    if (totalTokens + tokens > budget) {
      const stats: PackagerStats = {
        inputCount: results.length,
        afterDiversity: diverse.length,
        diversityRejected: results.length - diverse.length,
        uniqueFiles,
        tokenBudget: budget,
        tokenBudgetUsed: totalTokens,
        tokenBudgetUtilization: budget > 0 ? totalTokens / budget : 0,
      };
      return { results: packaged, totalTokens, truncated: true, stats };
    }

    packaged.push(packagedChunk);
    totalTokens += tokens;
  }

  const stats: PackagerStats = {
    inputCount: results.length,
    afterDiversity: diverse.length,
    diversityRejected: results.length - diverse.length,
    uniqueFiles,
    tokenBudget: budget,
    tokenBudgetUsed: totalTokens,
    tokenBudgetUtilization: budget > 0 ? totalTokens / budget : 0,
  };
  return { results: packaged, totalTokens, truncated: false, stats };
}

export function getDefaultTokenBudget(view: ViewMode, baseBudget: number): number {
  switch (view) {
    case "implementation":
      return Math.round(baseBudget * 1.5);
    case "raw":
      return baseBudget * 2;
    case "sketch":
    default:
      return baseBudget;
  }
}

function getMaxChunksPerFile(view: ViewMode, baseMaxPerFile: number): number {
  if (view === "sketch") return baseMaxPerFile;
  return baseMaxPerFile + 1;
}

function buildSnippet(
  result: SearchResult,
  view: ViewMode,
  highlights: string[],
  uses: string[],
): string {
  switch (view) {
    case "raw":
      return result.chunk.text_raw;
    case "implementation":
      return buildImplementationSnippet(result, highlights, uses);
    case "sketch":
    default:
      return result.chunk.text_sketch;
  }
}

function buildImplementationSnippet(
  result: SearchResult,
  highlights: string[],
  uses: string[],
): string {
  const config = getConfig();
  const implementationMaxTokens = Math.max(config.sketchMaxTokens * 2, 320);
  const parts: string[] = [];

  const annotations = parseStringArray(result.chunk.annotations);
  if (annotations.length > 0) {
    parts.push(annotations.join(" "));
  }

  if (result.chunk.signature) {
    parts.push(result.chunk.signature);
  }

  const filteredHighlights = highlights.filter((line) => line !== result.chunk.signature?.trim());
  if (filteredHighlights.length > 0) {
    parts.push(filteredHighlights.map((line) => `  ${line}`).join("\n"));
  } else if (result.chunk.text_sketch.trim()) {
    parts.push(result.chunk.text_sketch.trim());
  }

  if (uses.length > 0) {
    parts.push(`Uses: ${uses.join(", ")}`);
  }

  return truncateToTokenBudget(parts.filter(Boolean).join("\n"), implementationMaxTokens);
}

function collectHighlights(textRaw: string, signature: string | null, query?: string): string[] {
  const lines = textRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "{" && line !== "}");

  if (lines.length === 0) return [];

  const terms = extractQueryTerms(query);
  const scored = lines.map((line, index) => ({
    line,
    index,
    score: scoreLine(line, terms, signature),
  }));

  const matching = scored.filter((entry) => entry.score > 0);
  const selected = (matching.length > 0 ? matching : scored)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index);

  return selected.map((entry) => entry.line);
}

function scoreLine(line: string, terms: string[], signature: string | null): number {
  let score = 0;
  const normalized = line.toLowerCase();

  if (signature && line.trim() === signature.trim()) {
    score += 3;
  }

  for (const term of terms) {
    if (normalized.includes(term)) {
      score += normalized === term ? 4 : 2;
    }
  }

  return score;
}

function extractQueryTerms(query?: string): string[] {
  if (!query) return [];
  return extractSearchTerms(query);
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}
