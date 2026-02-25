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

### scrooge_context

Get project patterns for a given chunk kind. Returns common annotations, tags, imports, and example sketches — so the agent writes code that matches existing conventions without reading multiple files.

**Parameters:**
| Parameter   | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `kind`      | string | yes      | Chunk kind to query (e.g., `"viewmodel"`, `"composable"`, `"dao"`) |
| `module`    | string | no       | Filter to a specific module (e.g., `":feature:auth"`) |
| `repo_path` | string | no       | Path to the repository (defaults to current) |

**Example output:**
```json
{
  "kind": "viewmodel",
  "sampleCount": 5,
  "commonAnnotations": ["@HiltViewModel", "@Inject"],
  "commonTags": ["hilt", "viewmodel", "coroutine"],
  "commonImports": ["StateFlow", "MutableStateFlow", "viewModelScope"],
  "exampleSketches": [
    { "path": "feature/auth/LoginViewModel.kt", "sketch": "class LoginViewModel @Inject constructor(...)" }
  ]
}
```

### scrooge_deps

Get a compact dependency graph for a symbol: forward (what it uses) and reverse (who uses it). Optimized for refactoring decisions — returns only names, paths, and kinds, not full source.

**Parameters:**
| Parameter   | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `symbol`    | string | yes      | Symbol name (e.g., `"AuthRepository"`) |
| `direction` | string | no       | `"forward"`, `"reverse"`, or `"both"` (default) |
| `repo_path` | string | no       | Path to the repository (defaults to current) |

**Example output:**
```json
{
  "symbol": "AuthRepository",
  "definitions": [{ "symbol": "AuthRepository", "path": "data/AuthRepository.kt", "kind": "class", "module": ":data" }],
  "forward": [{ "symbol": "ApiService", "path": "api/ApiService.kt", "kind": "api_interface", "module": ":api" }],
  "reverse": [{ "symbol": "LoginViewModel", "path": "feature/auth/LoginViewModel.kt", "kind": "viewmodel", "module": ":feature:auth" }]
}
```

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
Raw equivalent:  120,000
Saved:           74,800 (62.3%)

### Savings by Tool
search: 1,200 delivered / 8,500 raw (85.9% saved)
lookup: 600 delivered / 3,500 raw (82.9% saved)
map:    200 delivered / 2,000 raw (90.0% saved)

### Usage (70 total calls)
search: 42 | map: 15 | lookup: 8 | reindex: 3 | status: 2

### Models
claude-opus-4-6: 30 calls (25,000 tokens)
claude-sonnet-4-5: 40 calls (20,200 tokens)

### Search Insights
Avg results/query: 5.2 | Avg tokens/query: 1,076
Sources: lexical 30% | vector 25% | both 45%
```

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `SCROOGE_MODEL` | AI model identifier (e.g., `claude-opus-4-6`). Recorded in telemetry for per-model usage breakdown. |

## Execution-Phase Hooks

Scrooge can automatically inject project patterns before Write/Edit operations, so the agent writes code matching existing conventions without manual tool calls.

### Claude Code (PreToolUse)

Add to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "node /absolute/path/to/scrooge/bin/scrooge-hook.mjs",
        "timeout": 3
      }]
    }]
  }
}
```

The hook reads the tool invocation from stdin, checks if the target file is a supported language (`.kt`, `.ts`, `.tsx`, `.dart`, `.py`), and injects project patterns as `additionalContext`. Timeout is 1.5s with silent failure.

### pi.dev (tool_call event)

The pi.dev extension automatically registers a `tool_call` hook that intercepts `write`/`edit` operations on supported file types. No additional configuration needed — it activates when the extension is installed.

## Architecture

- **API Layer** (`src/api/`): Transport-agnostic business logic shared by MCP and pi.dev — each function orchestrates openDb → ensureFresh → core → telemetry → close
- **MCP Server** (`src/server/`): Thin adapters — Zod schema, param mapping, calls `src/api/*` with `channel: "mcp"`, wraps result in MCP format
- **pi.dev Extension** (`packages/pi-extension/`): TypeBox schemas, calls `src/api/*` with `channel: "pi"`, registers tools via `pi.registerTool()`
- **Indexer** (`src/indexer/`): Pipeline that classifies files, chunks them semantically (tree-sitter for Kotlin, TypeScript, Dart, and Python), generates sketches, and computes embeddings
- **Retrieval** (`src/retrieval/`): Hybrid search (FTS5 lexical + sqlite-vec vector) with RRF fusion and token-budgeted packaging
- **Repo Map** (`src/repomap/`): Directory tree and hierarchical summaries from indexed data
- **Storage** (`src/storage/`): SQLite with better-sqlite3, FTS5 for lexical search, sqlite-vec for vector search
- **Auto-reindex**: Search, map, and lookup automatically refresh the index when HEAD differs from last indexed commit (`src/utils/freshness.ts`). No manual `scrooge_reindex` needed

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

Test fixtures are located in `test/fixtures/` (Kotlin, TypeScript, Dart, Python, XML, Gradle samples).

## Key Conventions

- All communication in English — code, comments, commits, and conversation responses
- TypeScript strict mode, ESM modules
- Tests with vitest in `test/`
- Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, etc.)
- Fixtures in `test/fixtures/`

## Dependencies

- `@modelcontextprotocol/sdk` -- MCP protocol
- `better-sqlite3` + `sqlite-vec` -- Storage with vector search
- `tree-sitter` + `tree-sitter-kotlin` + `tree-sitter-typescript` + `tree-sitter-dart` + `tree-sitter-python` -- AST parsing (Kotlin, TypeScript, Dart, Python)
- `@xenova/transformers` -- Local embeddings (all-MiniLM-L6-v2)
- `zod` -- Schema validation (MCP handlers)
- `@sinclair/typebox` -- Schema validation (pi.dev extension, in `packages/pi-extension/`)
