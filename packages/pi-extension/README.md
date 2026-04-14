# @fabricio-costa/pi-scrooge

Scrooge code intelligence tools for [pi.dev](https://pi.dev) — hybrid RAG search, repo maps, symbol lookup, and exact source retrieval powered by local embeddings and SQLite.

## Installation

```bash
# Build scrooge first (generates dist/api/ that the extension imports):
cd /path/to/scrooge
npm install && npm run build

# Install the extension (pi.dev loads TypeScript via jiti — no build needed):
pi install /path/to/scrooge/packages/pi-extension
```

Pi.dev auto-discovers extensions from `~/.pi/agent/extensions/` and project-local `.pi/extensions/`. Hot-reload with `/reload`.

## Prerequisites

- **Node.js** >= 20.0.0
- **C++ compiler** (for native dependencies: `better-sqlite3`, `tree-sitter`)
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install build-essential`

## Available Tools

| Tool | Description |
|------|-------------|
| `scrooge_search` | Hybrid code search with query rewriting, lexical + vector retrieval, and sketch/implementation/raw snippets |
| `scrooge_lookup` | Find symbol definitions and usages across the codebase |
| `scrooge_source` | Fetch the exact raw source for a known chunk or symbol |
| `scrooge_map` | Repository map with directory tree and hierarchical summaries |
| `scrooge_context` | Learn project patterns before writing code |
| `scrooge_deps` | Inspect forward and reverse dependencies for a symbol |
| `scrooge_reindex` | Trigger full or incremental repository indexing |
| `scrooge_status` | Check index state and freshness |
| `scrooge_statistics` | Usage and token savings metrics in text or structured JSON |

## How It Works

This extension wraps Scrooge's API layer (`scrooge/api`) and registers each tool with pi.dev's tool system. All calls are tagged with `channel: "pi"` for telemetry tracking.

The index is stored at `~/.scrooge/scrooge.db` and is shared with the Claude Code MCP integration — both channels read from and write to the same database.

## Configuration

By default, the extension uses Scrooge's standard settings:
- **Database**: `~/.scrooge/scrooge.db`
- **Embedding model**: all-MiniLM-L6-v2 (local, vendored)
- **Auto-reindex**: Search, map, and lookup automatically refresh when HEAD changes
- **Native exploration policy**: `warn` (nudges native `read`/`grep`/`glob` toward Scrooge first)

Optional environment variables:
- `SCROOGE_MODEL` — tag telemetry with the active model identifier
- `SCROOGE_NATIVE_EXPLORATION_POLICY=off|warn|strict` — choose whether native exploration is ignored, nudged, or blocked when it bypasses Scrooge on indexed repos
- `SCROOGE_NATIVE_EXPLORATION_OVERRIDE_REASON=known_raw_content|known_path_regex|non_code_file|final_verification` — operator override reason code recorded in diagnostics when native bypasses are intentionally allowed

Tool note:
- `scrooge_statistics` accepts `format: "text" | "json"`; use `json` when you want structured totals, per-tool breakdowns, and coverage diagnostics for dashboards or scripts
