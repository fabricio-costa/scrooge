# @fabricio-costa/pi-scrooge

Scrooge code intelligence tools for [pi.dev](https://pi.dev) — hybrid RAG search, repo maps, and symbol lookup powered by local embeddings and SQLite.

## Installation

```bash
# From npm:
pi install npm:@fabricio-costa/pi-scrooge

# Local development:
pi install /path/to/scrooge/packages/pi-extension
```

## Prerequisites

- **Node.js** >= 20.0.0
- **C++ compiler** (for native dependencies: `better-sqlite3`, `tree-sitter`)
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install build-essential`

## Available Tools

| Tool | Description |
|------|-------------|
| `scrooge_search` | Hybrid code search (lexical + vector) with token-budgeted snippets |
| `scrooge_lookup` | Find symbol definitions and usages across the codebase |
| `scrooge_map` | Repository map with directory tree and hierarchical summaries |
| `scrooge_reindex` | Trigger full or incremental repository indexing |
| `scrooge_status` | Check index state and freshness |
| `scrooge_statistics` | Usage and token savings metrics |

## How It Works

This extension wraps Scrooge's API layer (`scrooge/api`) and registers each tool with pi.dev's tool system. All calls are tagged with `channel: "pi"` for telemetry tracking.

The index is stored at `~/.scrooge/scrooge.db` and is shared with the Claude Code MCP integration — both channels read from and write to the same database.

## Configuration

No configuration needed. The extension uses Scrooge's default settings:
- **Database**: `~/.scrooge/scrooge.db`
- **Embedding model**: all-MiniLM-L6-v2 (local, vendored)
- **Auto-reindex**: Search, map, and lookup automatically refresh when HEAD changes
