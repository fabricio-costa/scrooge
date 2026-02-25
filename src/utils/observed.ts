/**
 * Observed tool call utilities
 *
 * Reads and aggregates the ~/.scrooge/observed.jsonl file written by
 * PostToolUse hooks (Claude Code) and tool_call events (pi.dev).
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
}

export type ToolCategory = "scrooge_exploration" | "native_exploration" | "scrooge_admin" | "other";

// Scrooge exploration tools — search, lookup, map, context, deps
// Claude Code: mcp__*scrooge*__scrooge_search or mcp__scrooge__scrooge_search
// pi.dev: pi:scrooge_search
const SCROOGE_EXPLORATION = /^(?:mcp__.*scrooge.*__(?:scrooge_)?|pi:scrooge_)(search|lookup|map|context|deps)$/;

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
  // mcp__plugin_scrooge__scrooge_search → search
  const mcpMatch = toolName.match(/^mcp__.*__(?:scrooge_)?(.+)$/);
  if (mcpMatch) return mcpMatch[1];

  // pi:scrooge_search → search
  const piScroogeMatch = toolName.match(/^pi:scrooge_(.+)$/);
  if (piScroogeMatch) return piScroogeMatch[1];

  // pi:read → Read
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

      // Filter by repo path if provided
      if (repoPath && record.repo !== repoPath) continue;

      // Filter by date if provided
      if (since && record.t < since) continue;

      records.push(record);
    } catch {
      // Skip malformed lines
    }
  }

  return records;
}

export interface CoverageReport {
  scroogeExploration: Map<string, number>;
  nativeExploration: Map<string, number>;
  other: Map<string, number>;
  coveragePct: number;
  totalExploration: number;
}

/**
 * Compute agent coverage from observed records.
 */
export function computeCoverage(records: ObservedRecord[]): CoverageReport {
  const scroogeExploration = new Map<string, number>();
  const nativeExploration = new Map<string, number>();
  const other = new Map<string, number>();

  for (const record of records) {
    const category = categorize(record.tool);
    const name = shortName(record.tool);

    switch (category) {
      case "scrooge_exploration": {
        scroogeExploration.set(name, (scroogeExploration.get(name) ?? 0) + 1);
        break;
      }
      case "native_exploration": {
        nativeExploration.set(name, (nativeExploration.get(name) ?? 0) + 1);
        break;
      }
      case "scrooge_admin":
      case "other": {
        other.set(name, (other.get(name) ?? 0) + 1);
        break;
      }
    }
  }

  const scroogeTotal = [...scroogeExploration.values()].reduce((a, b) => a + b, 0);
  const nativeTotal = [...nativeExploration.values()].reduce((a, b) => a + b, 0);
  const totalExploration = scroogeTotal + nativeTotal;
  const coveragePct = totalExploration > 0 ? (scroogeTotal / totalExploration) * 100 : 0;

  return { scroogeExploration, nativeExploration, other, coveragePct, totalExploration };
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
      // Drop malformed lines
      removed++;
    }
  }

  writeFileSync(filePath, kept.length > 0 ? kept.join("\n") + "\n" : "");
  return removed;
}

/**
 * Format the Agent Coverage section for the statistics report.
 * Returns null if no observed data exists.
 */
export function formatCoverageSection(repoPath: string, since?: string | null): string | null {
  const records = readObserved(repoPath, since);
  if (records.length === 0) return null;

  const coverage = computeCoverage(records);

  // Skip if there are no exploration calls at all
  const scroogeTotal = [...coverage.scroogeExploration.values()].reduce((a, b) => a + b, 0);
  const nativeTotal = [...coverage.nativeExploration.values()].reduce((a, b) => a + b, 0);
  if (scroogeTotal + nativeTotal === 0 && coverage.other.size === 0) return null;

  const lines: string[] = [];

  // Scrooge exploration line
  if (scroogeTotal > 0) {
    const parts = [...coverage.scroogeExploration.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`);
    lines.push(`Scrooge exploration: ${scroogeTotal} calls (${parts.join(", ")})`);
  } else {
    lines.push("Scrooge exploration: 0 calls");
  }

  // Native exploration line
  if (nativeTotal > 0) {
    const parts = [...coverage.nativeExploration.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`);
    lines.push(`Native exploration:  ${nativeTotal} calls (${parts.join(", ")})`);
  } else {
    lines.push("Native exploration:  0 calls");
  }

  // Other calls
  const otherTotal = [...coverage.other.values()].reduce((a, b) => a + b, 0);
  if (otherTotal > 0) {
    const parts = [...coverage.other.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`);
    lines.push(`Other agent calls:   ${otherTotal} (${parts.join(", ")})`);
  }

  // Coverage percentage
  if (coverage.totalExploration > 0) {
    lines.push("─────────────────");
    lines.push(
      `Coverage: ${coverage.coveragePct.toFixed(1)}% of exploration calls used Scrooge (${scroogeTotal} of ${coverage.totalExploration})`,
    );
  }

  return lines.join("\n");
}
