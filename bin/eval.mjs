#!/usr/bin/env node

/**
 * Scrooge Eval CLI
 *
 * Usage:
 *   npm run eval                                    # Run with defaults
 *   npm run eval -- --rrf-k 100                     # Override RRF k
 *   npm run eval -- --queries eval/custom.jsonl     # Custom queries
 *   npm run eval -- --compare '{"rrfK":60}' '{"rrfK":100}'  # Compare configs
 */

import { resolve } from "node:path";

const args = process.argv.slice(2);

// Parse arguments
let queriesPath = resolve("eval/queries.jsonl");
let k = 5;
let compareMode = false;
const compareConfigs = [];
const overrides = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--queries" && args[i + 1]) {
    queriesPath = resolve(args[++i]);
  } else if (arg === "--k" && args[i + 1]) {
    k = parseInt(args[++i], 10);
  } else if (arg === "--rrf-k" && args[i + 1]) {
    overrides.rrfK = parseInt(args[++i], 10);
  } else if (arg === "--compare") {
    compareMode = true;
    // Collect remaining args as JSON configs
    while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      compareConfigs.push(JSON.parse(args[++i]));
    }
  } else if (arg === "--help" || arg === "-h") {
    console.log(`Scrooge Eval — evaluate search quality against ground-truth queries

Usage:
  npm run eval                                     Run with default config
  npm run eval -- --rrf-k 100                      Override RRF k parameter
  npm run eval -- --k 10                           Use @10 instead of @5
  npm run eval -- --queries path/to/queries.jsonl  Custom query file
  npm run eval -- --compare '{"rrfK":60}' '{"rrfK":100}'  Compare configs`);
    process.exit(0);
  }
}

// Dynamic import to support tsx
const { runEval, formatEvalReport, formatComparisonReport } = await import("../src/eval/runner.js");

if (compareMode && compareConfigs.length >= 2) {
  const results = [];
  const labels = [];

  for (const config of compareConfigs) {
    const label = JSON.stringify(config);
    labels.push(label);
    const result = await runEval({
      queriesPath,
      configOverrides: config,
      k,
    });
    results.push(result);
  }

  console.log(formatComparisonReport(results, labels));
} else {
  const configOverrides = Object.keys(overrides).length > 0 ? overrides : undefined;
  const result = await runEval({
    queriesPath,
    configOverrides,
    k,
  });

  console.log(formatEvalReport(result));
}
