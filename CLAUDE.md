# Scrooge

Local MCP server for code-aware Repo Map + Hybrid RAG, reducing token spend in agent planning mode.

## Quick Start

```bash
npm install
npm test          # Run tests
npm run dev       # Start MCP server (stdio)
npm run typecheck # Type check without emitting
```

## Architecture

- **MCP Server** (`src/server/`): Stdio transport, 5 tools (search, map, lookup, reindex, status)
- **Indexer** (`src/indexer/`): Pipeline that classifies files, chunks them semantically (tree-sitter for Kotlin), generates sketches, and computes embeddings
- **Retrieval** (`src/retrieval/`): Hybrid search (FTS5 lexical + sqlite-vec vector) with RRF fusion and token-budgeted packaging
- **Repo Map** (`src/repomap/`): Directory tree and hierarchical summaries from indexed data
- **Storage** (`src/storage/`): SQLite with better-sqlite3, FTS5 for lexical search, sqlite-vec for vector search

## Key Conventions

- All code, comments, and commits in English
- TypeScript strict mode, ESM modules
- Tests with vitest in `test/`
- Conventional commits (feat:, fix:, refactor:, test:, etc.)
- Fixtures in `test/fixtures/`

## Testing

```bash
npm test              # All tests
npx vitest run test/chunkers.test.ts  # Specific file
npx vitest --watch    # Watch mode
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol
- `better-sqlite3` + `sqlite-vec` — Storage with vector search
- `tree-sitter` + `tree-sitter-kotlin` — Kotlin AST parsing
- `@xenova/transformers` — Local embeddings (all-MiniLM-L6-v2)
- `zod` — Schema validation
