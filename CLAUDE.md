# Scrooge

Local MCP server for code-aware Repo Map + Hybrid RAG, reducing token spend in agent planning mode.

## Prerequisites

- **Node.js** >= 20.0.0
- **Git**
- **C++ compiler** (required for native dependencies: `better-sqlite3`, `tree-sitter`)
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install build-essential`
  - Windows: Visual Studio Build Tools or `npm install -g windows-build-tools`

## Quick Start

```bash
npm install
npm test
npm run build
```

## Register as MCP Server in Claude Code

The launcher script (`bin/scrooge-mcp.mjs`) auto-detects Node.js version mismatches and rebuilds native modules when needed. Register at **user scope** so it works from all projects:

```bash
# Build first:
npm run build

# Register (user scope — available in all projects):
claude mcp add -s user scrooge -- node /absolute/path/to/scrooge/bin/scrooge-mcp.mjs

# Development:
claude mcp add scrooge -- npx tsx /absolute/path/to/scrooge/src/index.ts
```

## Tools Reference

### scrooge_search

Hybrid code search combining FTS5 lexical search and sqlite-vec vector search with RRF fusion.

**Parameters:**
| Parameter      | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `query`        | string | yes      | Natural language or code search query |
| `repo_path`    | string | no       | Path to the repository (defaults to current) |
| `filters`      | object | no       | Filter by `module`, `language`, `kind`, `tags` |
| `view`         | string | no       | `"sketch"` (default) or `"raw"` for full content |
| `max_results`  | number | no       | Maximum number of results to return |
| `token_budget` | number | no       | Token budget for result packaging |

**Example output:**
```json
{
  "results": [
    {
      "file": "src/auth/LoginViewModel.kt",
      "kind": "class",
      "name": "LoginViewModel",
      "sketch": "class LoginViewModel : ViewModel() { fun login(email, password) ... }",
      "score": 0.85
    }
  ]
}
```

### scrooge_map

Repository map providing a directory tree with hierarchical summaries.

**Parameters:**
| Parameter   | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `repo_path` | string | no       | Path to the repository |
| `level`     | string | no       | `"repo"`, `"modules"`, or `"files"` |
| `module`    | string | no       | Filter to a specific module |

### scrooge_lookup

Symbol lookup: find a symbol's definition and its usages across the codebase.

**Parameters:**
| Parameter        | Type    | Required | Description |
|------------------|---------|----------|-------------|
| `symbol`         | string  | yes      | Symbol name to look up |
| `repo_path`      | string  | no       | Path to the repository |
| `include_usages` | boolean | no       | Include usage locations (default: true) |

### scrooge_reindex

Trigger indexing of a repository. Supports full and incremental modes.

**Parameters:**
| Parameter     | Type    | Required | Description |
|---------------|---------|----------|-------------|
| `repo_path`   | string  | no       | Path to the repository |
| `incremental` | boolean | no       | Only index changed files (default: true) |

### scrooge_status

Get information about the current index state.

**Parameters:**
| Parameter   | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `repo_path` | string | no       | Path to the repository |

### scrooge_statistics

Usage and token savings metrics. Shows how much Scrooge saves by comparing compressed responses to raw content costs.

**Parameters:**
| Parameter   | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `repo_path` | string | no       | Path to the repository |
| `period`    | string | no       | `"today"`, `"week"`, `"month"`, `"all"` (default: `"all"`) |

**Example output:**
```
## Scrooge Statistics — kotlin-pdv
Period: all time (since Feb 20, 2026)

### Token Savings
Tokens delivered: 45,200
Raw equivalent:  312,000
Saved:           266,800 (85.5%)

### Usage (70 total calls)
search: 42 | map: 15 | lookup: 8 | reindex: 3 | status: 2

### Search Insights
Avg results/query: 5.2 | Avg tokens/query: 1,076
Sources: lexical 30% | vector 25% | both 45%
```

## Architecture

- **MCP Server** (`src/server/`): Stdio transport, 6 tools (search, map, lookup, reindex, status, statistics)
- **Indexer** (`src/indexer/`): Pipeline that classifies files, chunks them semantically (tree-sitter for Kotlin, TypeScript, and Dart), generates sketches, and computes embeddings
- **Retrieval** (`src/retrieval/`): Hybrid search (FTS5 lexical + sqlite-vec vector) with RRF fusion and token-budgeted packaging
- **Repo Map** (`src/repomap/`): Directory tree and hierarchical summaries from indexed data
- **Storage** (`src/storage/`): SQLite with better-sqlite3, FTS5 for lexical search, sqlite-vec for vector search

## Database

- **Location**: `~/.scrooge/scrooge.db`
- **Engine**: SQLite with WAL mode for concurrent reads
- **Extensions**: FTS5 (full-text search), sqlite-vec (vector similarity)
- **Reset**: Delete the database file to force a full reindex:
  ```bash
  rm ~/.scrooge/scrooge.db
  ```

## Testing

```bash
npm test                                   # All tests
npx vitest run test/chunkers.test.ts       # Specific file
npx vitest --watch                         # Watch mode
```

Test fixtures are located in `test/fixtures/` (Kotlin, TypeScript, XML, Gradle samples).

## Key Conventions

- All code, comments, and commits in English
- TypeScript strict mode, ESM modules
- Tests with vitest in `test/`
- Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, etc.)
- Fixtures in `test/fixtures/`

## Dependencies

- `@modelcontextprotocol/sdk` -- MCP protocol
- `better-sqlite3` + `sqlite-vec` -- Storage with vector search
- `tree-sitter` + `tree-sitter-kotlin` + `tree-sitter-typescript` -- AST parsing (Kotlin, TypeScript)
- `@xenova/transformers` -- Local embeddings (all-MiniLM-L6-v2)
- `zod` -- Schema validation
