#!/usr/bin/env node

/**
 * Scrooge Export CLI
 *
 * Usage:
 *   npm run export                          # All records, JSONL to stdout
 *   npm run export -- --period week         # Last 7 days
 *   npm run export -- --tool search         # Search calls only
 *   npm run export -- --format csv          # CSV format
 *   npm run export -- --anonymize           # Strip PII
 *   npm run export -- --out report.jsonl    # Write to file
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

// Parse arguments
const params = {};
let outFile = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--period" && args[i + 1]) {
    params.period = args[++i];
  } else if (arg === "--tool" && args[i + 1]) {
    params.tool = args[++i];
  } else if (arg === "--format" && args[i + 1]) {
    params.format = args[++i];
  } else if (arg === "--limit" && args[i + 1]) {
    params.limit = parseInt(args[++i], 10);
  } else if (arg === "--anonymize") {
    params.anonymize = true;
  } else if (arg === "--out" && args[i + 1]) {
    outFile = resolve(args[++i]);
  } else if (arg === "--help" || arg === "-h") {
    console.log(`Scrooge Export — export telemetry data as JSONL or CSV

Usage:
  npm run export                          All records, JSONL to stdout
  npm run export -- --period week         Last 7 days
  npm run export -- --tool search         Search calls only
  npm run export -- --format csv          CSV format
  npm run export -- --anonymize           Strip repo paths and queries
  npm run export -- --limit 100           Max 100 records
  npm run export -- --out report.jsonl    Write to file`);
    process.exit(0);
  }
}

const { exportData, formatAsJsonl, formatAsCsv } = await import("../dist/api/export.js");

const result = await exportData(params, { channel: "cli", repoPath: process.cwd() });
const text = result.format === "csv"
  ? formatAsCsv(result.records)
  : formatAsJsonl(result.records);

if (outFile) {
  writeFileSync(outFile, text + "\n", "utf-8");
  console.error(`Exported ${result.count} records to ${outFile}`);
} else {
  if (text) {
    console.log(text);
  } else {
    console.error("No records found.");
  }
}
