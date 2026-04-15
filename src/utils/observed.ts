/**
 * Observed tool call utilities
 *
 * Reads and aggregates the ~/.scrooge/observed.jsonl file written by
 * PostToolUse hooks (Claude Code) and tool_result events (pi.dev).
 * Computes agent coverage: what % of code exploration used Scrooge.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ObservedRecord {
  t: string;
  tool: string;
  repo: string;
  sid: string;
  path?: string;
  isCodeFile?: boolean;
  selector?: string;
  offset?: number;
  limit?: number;
  guidedBy?: string;
  policyMode?: "off" | "warn" | "strict";
  reasonCode?: string;
}

export type ToolCategory = "scrooge_exploration" | "native_exploration" | "scrooge_admin" | "other";

// Scrooge exploration tools — search, lookup, map, context, deps, source
// Claude Code: mcp__*scrooge*__scrooge_search or mcp__scrooge__scrooge_search
// pi.dev: pi:scrooge_search
const SCROOGE_EXPLORATION = /^(?:mcp__.*scrooge.*__(?:scrooge_)?|pi:scrooge_)(search|lookup|map|context|deps|source)$/;

// Native exploration tools that Scrooge replaces
// Claude Code: Read, Grep, Glob (PascalCase)
// pi.dev: pi:read, pi:grep, pi:glob (lowercase with prefix)
const NATIVE_EXPLORATION = /^(?:Read|Grep|Glob|pi:(?:read|grep|glob))$/;

// Scrooge admin/utility tools — not exploration
const SCROOGE_ADMIN = /^(?:mcp__.*scrooge.*__(?:scrooge_)?|pi:scrooge_)(status|statistics|export|reindex)$/;

export function categorize(toolName: string): ToolCategory {
  if (SCROOGE_EXPLORATION.test(toolName)) return "scrooge_exploration";
  if (NATIVE_EXPLORATION.test(toolName)) return "native_exploration";
  if (SCROOGE_ADMIN.test(toolName)) return "scrooge_admin";
  return "other";
}

/**
 * Short display name for a tool (strips mcp__*__ prefix and pi: prefix).
 */
export function shortName(toolName: string): string {
  const mcpMatch = toolName.match(/^mcp__.*__(?:scrooge_)?(.+)$/);
  if (mcpMatch) return mcpMatch[1];

  const piScroogeMatch = toolName.match(/^pi:scrooge_(.+)$/);
  if (piScroogeMatch) return piScroogeMatch[1];

  const piMatch = toolName.match(/^pi:(.+)$/);
  if (piMatch) return piMatch[1].charAt(0).toUpperCase() + piMatch[1].slice(1);

  return toolName;
}

function getObservedPath(): string {
  return join(homedir(), ".scrooge", "observed.jsonl");
}

/**
 * Read observed records from JSONL file, optionally filtered by repo and date.
 */
export function readObserved(repoPath?: string, since?: string | null): ObservedRecord[] {
  const filePath = getObservedPath();
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf-8");
  const records: ObservedRecord[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as ObservedRecord;

      if (repoPath && record.repo !== repoPath) continue;
      if (since && record.t < since) continue;

      records.push(record);
    } catch {
      // Skip malformed lines
    }
  }

  return records;
}

export interface CodeReadExtensionStats {
  total: number;
  guided: number;
  blind: number;
}

export interface CoverageReport {
  scroogeExploration: Map<string, number>;
  nativeExploration: Map<string, number>;
  other: Map<string, number>;
  coveragePct: number;
  totalExploration: number;
  codeReads: number;
  guidedCodeReads: number;
  blindCodeReads: number;
  guidedReadBy: Map<string, number>;
  codeReadByExtension: Map<string, CodeReadExtensionStats>;
  blindReadPaths: Map<string, number>;
  grepSelectors: Map<string, number>;
  globSelectors: Map<string, number>;
  nativeReasonCodes: Map<string, number>;
}

function isCodeRead(record: ObservedRecord): boolean {
  return categorize(record.tool) === "native_exploration"
    && shortName(record.tool) === "Read"
    && record.isCodeFile === true;
}

function getPathExtension(filePath?: string): string {
  if (!filePath) return "(unknown)";
  const base = filePath.split("/").pop() ?? filePath;
  if (/\.d\.ts$/i.test(base)) return ".d.ts";
  const lastDot = base.lastIndexOf(".");
  if (lastDot === -1) return "(no ext)";
  return base.slice(lastDot).toLowerCase();
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function incrementCodeReadExtension(
  map: Map<string, CodeReadExtensionStats>,
  extension: string,
  guided: boolean,
): void {
  const current = map.get(extension) ?? { total: 0, guided: 0, blind: 0 };
  current.total += 1;
  if (guided) {
    current.guided += 1;
  } else {
    current.blind += 1;
  }
  map.set(extension, current);
}

/**
 * Compute agent coverage from observed records.
 */
export function computeCoverage(records: ObservedRecord[]): CoverageReport {
  const scroogeExploration = new Map<string, number>();
  const nativeExploration = new Map<string, number>();
  const other = new Map<string, number>();
  const guidedReadBy = new Map<string, number>();
  const codeReadByExtension = new Map<string, CodeReadExtensionStats>();
  const blindReadPaths = new Map<string, number>();
  const grepSelectors = new Map<string, number>();
  const globSelectors = new Map<string, number>();
  const nativeReasonCodes = new Map<string, number>();

  let codeReads = 0;
  let guidedCodeReads = 0;
  let blindCodeReads = 0;

  for (const record of records) {
    const category = categorize(record.tool);
    const name = shortName(record.tool);

    switch (category) {
      case "scrooge_exploration": {
        incrementCount(scroogeExploration, name);
        break;
      }
      case "native_exploration": {
        incrementCount(nativeExploration, name);
        if (name === "Grep" && record.selector) {
          incrementCount(grepSelectors, record.selector);
        }
        if (name === "Glob" && record.selector) {
          incrementCount(globSelectors, record.selector);
        }
        if (record.reasonCode) {
          incrementCount(nativeReasonCodes, record.reasonCode);
        }
        break;
      }
      case "scrooge_admin":
      case "other": {
        incrementCount(other, name);
        break;
      }
    }

    if (isCodeRead(record)) {
      codeReads += 1;
      const guided = !!record.guidedBy;
      const extension = getPathExtension(record.path);
      incrementCodeReadExtension(codeReadByExtension, extension, guided);

      if (guided && record.guidedBy) {
        guidedCodeReads += 1;
        incrementCount(guidedReadBy, record.guidedBy);
      } else {
        blindCodeReads += 1;
        if (record.path) {
          incrementCount(blindReadPaths, record.path);
        }
      }
    }
  }

  const scroogeTotal = [...scroogeExploration.values()].reduce((a, b) => a + b, 0);
  const nativeTotal = [...nativeExploration.values()].reduce((a, b) => a + b, 0);
  const totalExploration = scroogeTotal + nativeTotal;
  const coveragePct = totalExploration > 0 ? (scroogeTotal / totalExploration) * 100 : 0;

  return {
    scroogeExploration,
    nativeExploration,
    other,
    coveragePct,
    totalExploration,
    codeReads,
    guidedCodeReads,
    blindCodeReads,
    guidedReadBy,
    codeReadByExtension,
    blindReadPaths,
    grepSelectors,
    globSelectors,
    nativeReasonCodes,
  };
}

/**
 * Remove observed records older than the specified number of days.
 */
export function cleanupObserved(daysToKeep = 90): number {
  const filePath = getObservedPath();
  if (!existsSync(filePath)) return 0;

  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  const content = readFileSync(filePath, "utf-8");
  const kept: string[] = [];
  let removed = 0;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as ObservedRecord;
      if (record.t >= cutoff) {
        kept.push(line);
      } else {
        removed++;
      }
    } catch {
      removed++;
    }
  }

  writeFileSync(filePath, kept.length > 0 ? kept.join("\n") + "\n" : "");
  return removed;
}

function formatTopCounts(map: Map<string, number>, limit: number = 5): string {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => `${value}: ${count}`)
    .join(" | ");
}

function formatExtensionMix(map: Map<string, CodeReadExtensionStats>, limit: number = 5): string {
  return [...map.entries()]
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([extension, stats]) => {
      const blindPct = stats.total > 0 ? ((stats.blind / stats.total) * 100).toFixed(1) : "0.0";
      return `${extension}: ${stats.total} (${stats.blind} blind, ${blindPct}% blind)`;
    })
    .join(" | ");
}

/**
 * Format the Agent Coverage section for the statistics report.
 * Returns null if no observed data exists.
 */
export function formatCoverageSection(repoPath: string, since?: string | null): string | null {
  const records = readObserved(repoPath, since);
  if (records.length === 0) return null;

  const coverage = computeCoverage(records);

  const scroogeTotal = [...coverage.scroogeExploration.values()].reduce((a, b) => a + b, 0);
  const nativeTotal = [...coverage.nativeExploration.values()].reduce((a, b) => a + b, 0);
  if (scroogeTotal + nativeTotal === 0 && coverage.other.size === 0) return null;

  const lines: string[] = [];

  if (scroogeTotal > 0) {
    const parts = [...coverage.scroogeExploration.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`);
    lines.push(`Scrooge exploration: ${scroogeTotal} calls (${parts.join(", ")})`);
  } else {
    lines.push("Scrooge exploration: 0 calls");
  }

  if (nativeTotal > 0) {
    const parts = [...coverage.nativeExploration.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`);
    lines.push(`Native exploration:  ${nativeTotal} calls (${parts.join(", ")})`);
  } else {
    lines.push("Native exploration:  0 calls");
  }

  if (coverage.codeReads > 0) {
    const blindPct = coverage.codeReads > 0 ? ((coverage.blindCodeReads / coverage.codeReads) * 100).toFixed(1) : "0.0";
    lines.push(
      `Code reads:          ${coverage.codeReads} (${coverage.guidedCodeReads} guided, ${coverage.blindCodeReads} blind)`,
    );
    lines.push(`Blind read rate:     ${blindPct}% of code reads skipped Scrooge`);

    if (coverage.codeReadByExtension.size > 0) {
      lines.push(`Code read mix:       ${formatExtensionMix(coverage.codeReadByExtension)}`);
    }

    if (coverage.blindReadPaths.size > 0) {
      lines.push(`Blind hotspots:      ${formatTopCounts(coverage.blindReadPaths)}`);
    }

    if (coverage.guidedReadBy.size > 0) {
      const bounceParts = [...coverage.guidedReadBy.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => {
          const base = coverage.scroogeExploration.get(name) ?? 0;
          const pct = base > 0 ? ` (${((count / base) * 100).toFixed(1)}% of ${name})` : "";
          return `${name}→Read ${count}${pct}`;
        });
      lines.push(`Read bounce:         ${bounceParts.join(" | ")}`);
    }
  }

  if (coverage.grepSelectors.size > 0) {
    lines.push(`Grep bypasses:       ${formatTopCounts(coverage.grepSelectors)}`);
  }

  if (coverage.globSelectors.size > 0) {
    lines.push(`Glob bypasses:       ${formatTopCounts(coverage.globSelectors)}`);
  }

  if (coverage.nativeReasonCodes.size > 0) {
    lines.push(`Bypass reasons:      ${formatTopCounts(coverage.nativeReasonCodes)}`);
  }

  const otherTotal = [...coverage.other.values()].reduce((a, b) => a + b, 0);
  if (otherTotal > 0) {
    const parts = [...coverage.other.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`);
    lines.push(`Other agent calls:   ${otherTotal} (${parts.join(", ")})`);
  }

  if (coverage.totalExploration > 0) {
    lines.push("─────────────────");
    lines.push(
      `Coverage: ${coverage.coveragePct.toFixed(1)}% of exploration calls used Scrooge (${scroogeTotal} of ${coverage.totalExploration})`,
    );
  }

  return lines.join("\n");
}
