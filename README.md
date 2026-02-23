```
                                                                                                    
                                            @@                                                      
                                    @@@%###***%@@@@@                                                
                                 @@@@@@%******%@@@@@@@                                              
                               @@@@@@@@@#*****#@@@@@@@@                                             
                             @@@@@@@@@@@@*****#@@@@@@@@                                             
                             @@@@@@@@@@@@%*****@@@@@@@                                              
                            @@@@@@@@@@@@@@******@@@@@@                                              
                             @@@@@@@@@@@@@@*****@@@@@@                                              
                               @@@@@@@@@@@@@%**+*%%@%@                                              
                                @@@@@@@@%@@%++++*@@@@@                                              
                                 @@@@%@@@@@@*+*#%##**#%###%@                                        
                                   @@@@@@@@@##%@@@@@@@@@@@@@@%@                                     
                                   @@@@@%#%@@@@@@@@@@@@@@@@@@@@%@                                   
                                   @: =%@@@@@@@@@@@@@@%#%@@@@@@@%                                   
                            @@@@@@%::. -%*-.     .==      %@@@@@@                                   
                            %%%%%@@:-=.         =. .-=*:  %@@@@@@                                   
                             @@@@@%::.-          .*:  :: .:*@@@@                                    
                                 @++..-         --    ::    %@@                                     
                                 @:: .-   +    --  .. -:    +@                                      
                                 -:. .=       :=  ..  =     .@                                      
                             @@@+ :. :%  =.   +.%@%. :=      .*@@ @@                                
                           @@*: ..:. =@= +  :*.+@@@: =     ...  .*@                                 
                          *+.    ::: .@@%==+*. *@@%..:    . .      +@                               
                          @-  .%****-:=======*:.*+.:-:+*+==**      =#                               
                          %%:=  ::=*+===**+**+==:-=*+==*#****     :-@                               
                            @. ::::#=+*-:::::**======***:         :*#                               
                         @@%%%@#+-:**#*:::::::*=====#*  *.       .%@                                
                        @*==========##*-:::::%*===**@   @:*- ::-%@                                  
                          @@*====*%%+============*##@@    @%#@@                                     
                                @@@@%*=*#*+==*#**:-@%%@@                                            
     %:.:*  .-@@                       @@@%%=::  =%%%%%%@@@                                         
   @*=  =-  .: =@                       @%%@- .*%%%%%%%%%%@@                                        
 @% +=  @   =#%=.%@                    @@%%%%=%%%%%%%%%%%%%@@                                       
@#.%%+ :*  :@%##* *@              @@@%%@%%%%%%%%%%%%%@%#####%%@%@@@@@@@@                            
%.=##% .# :* .%##* +@@@@@@@@@@@@@%%#%%#%%%%%@%%%%%%@%##########%##%%####%@@@                        
%:*##@%==     :%%%. *%%%%%%%@%#########%@%%@%#@%%%%%#######################%@                   @@  
  @##@   +   *:      .@%%%%%%@%#########%%@%#%%@%%%#########################%@                 @#   
  @##@   @%.:=        *@%%%%%%@%#########%##*-##############################%@@@@             @:#   
  @%#%@    @*-%*:-    =@%%%%%%@%#########%%#%*##############################@%####@@@       @= .%   
  @@#%@      @%*-:+#%%@%%%%%%%@%###%@@@@@@@###############%%%###%%#########@%######%- :*-%:    .%   
   @%#@@        @@@@@@%%%%%%%%@@@@        @########################%%%%%%%###########=  :*-*   :@   
    @#%@         @@%%%%%%%%%@@@           @%#######################%%################%.   . .  .@   
    @%#%          @@@@@@@@@                %#######################%%#%###############@.       :@@@ 
    @@#%@                                  @######################%%%##################=       -%*  
     @%#@@                                 @%#####################%%%#%%###############*        :@  
      @##@                                  @####################%%%###################%.      =%@  
      @%#%@                                 @@##################@%@####################%-     -**   
       @##@                                  @@###############%%%%#####################%-    .%@    
       @%#%@                                   @%###########@%%%#######################%:    .%     
        @##@                                     @@@%%%%@%%%@%#########################%    .%      
         %#%@                                        @@#%##- =%#######################%+  :.%       
         @##%                                         @###@@*. -%####################%@@%.*@        
         @@#%@                                        @%#%@@@@@#=-%#################%%=%*@          
          @%#%@                                        @%#%@@ @*==+#@##############@*=%@            
          @@##@                                           @ @#*====%%@%##########%%===@             
           @%#%@                                            #===###*=#@@%######@@#====@             
            @##@@                              @@@@@@@     @%=**====*@  @@%%%@@ @*====#@@@          
            @%#%@                           @%#*++=======+==========+@          %*+====*+=*@        
             @%#@@                         @@=======##================*@@       *===++=====@        
              %##@                           @========+%*===============%@       @#*===*#*==#@      
              @##%@                           @%*+======+%*============#+#      @%%=======+==+*%@@  
               @@@                                 @@%=====******===++=#%%##***======+**====+***==%@
                                                      @%**+++**#*+**%@@*++*+==================+-=*=%
                                                                    @%========*##**=============+==%
                                                                     @%*+===========#%#+==========*@
                                                                         @*=============+##%%***=#  
                                                                           @#+====++==========#%@   
                                                                                     @@%*+*@@       
```

# Scrooge

**Local MCP server that indexes codebases and provides code-aware search, reducing token spend for AI agents by 80-90%.** Scrooge parses source code into semantic chunks, compresses them into sketches, and serves them through hybrid retrieval (lexical + vector search with RRF fusion) — so agents get the context they need without paying for the tokens they don't.

## Features

- **`scrooge_search`** — Hybrid code search combining FTS5 lexical and sqlite-vec vector search with Reciprocal Rank Fusion
- **`scrooge_map`** — Repository map with directory tree and hierarchical summaries at repo, module, or file level
- **`scrooge_lookup`** — Symbol lookup: find definitions and all usages across the codebase
- **`scrooge_reindex`** — Trigger full or incremental indexing of a repository
- **`scrooge_status`** — Check index freshness: last indexed commit, total chunks, staleness
- **`scrooge_statistics`** — Usage metrics and token savings breakdown over configurable time periods

## Prerequisites

- **Node.js** >= 20.0.0
- **Git**
- **C++ compiler** (required for native deps: `better-sqlite3`, `tree-sitter`)

| OS | Install command |
|----|-----------------|
| macOS | `xcode-select --install` |
| Ubuntu/Debian | `sudo apt install build-essential` |
| Windows | Visual Studio Build Tools or `npm install -g windows-build-tools` |

## Installation

```bash
git clone <repo-url>
cd scrooge
npm install
npm run build
```

## Registering with Claude Code

Register at **user scope** so Scrooge is available from any project directory:

```bash
# Production (uses compiled JS):
claude mcp add -s user scrooge -- node /absolute/path/to/scrooge/bin/scrooge-mcp.mjs

# Development (uses tsx for live reload):
claude mcp add scrooge -- npx tsx /absolute/path/to/scrooge/src/index.ts
```

### Self-healing launcher

The launcher script (`bin/scrooge-mcp.mjs`) automatically detects when native modules (`better-sqlite3`, `tree-sitter`) were compiled against a different Node.js version and rebuilds them before starting the server. This prevents the dreaded `NODE_MODULE_VERSION` mismatch error when switching Node versions between projects.

## Quick Start

Once registered, Scrooge tools are available in any Claude Code session.

**1. Index a repository**

```
> Use scrooge_reindex to index this repository
```

Scrooge walks the repo, classifies files, chunks them semantically (using tree-sitter for Kotlin and TypeScript), generates compressed sketches, computes embeddings, and stores everything in a local SQLite database.

**2. Search the codebase**

```
> Use scrooge_search to find authentication-related code
```

Returns ranked results with sketch-compressed snippets, staying within a token budget.

**3. Explore the repo map**

```
> Use scrooge_map at repo level to see the project structure
```

Returns a directory tree with hierarchical summaries of each module.

**4. Look up a symbol**

```
> Use scrooge_lookup to find where LoginViewModel is defined and used
```

**5. Check your savings**

```
> Use scrooge_statistics to see token savings
```

Shows how much Scrooge saved by comparing compressed responses to raw content costs.

## Tools Reference

### scrooge_search

Hybrid code search combining FTS5 lexical search and sqlite-vec vector search with RRF fusion.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Natural language or code identifier |
| `repo_path` | string | no | cwd | Absolute path to the repository |
| `filters.module` | string | no | — | Gradle module (e.g. `":app"`) |
| `filters.language` | string | no | — | Language: `kotlin`, `typescript`, `xml`, `gradle` |
| `filters.kind` | string | no | — | Chunk kind: `class`, `function`, `composable`, etc. |
| `filters.tags` | string[] | no | — | Tags: `["hilt", "compose"]` |
| `view` | string | no | `"sketch"` | `"sketch"` (compressed) or `"raw"` (full source) |
| `max_results` | number | no | 8 | Maximum number of results |
| `token_budget` | number | no | 3000 | Max tokens in response |

**Example response:**

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
  ],
  "totalTokens": 1076,
  "truncated": false
}
```

### scrooge_map

Repository map providing directory tree and hierarchical summaries.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `repo_path` | string | no | cwd | Path to the repository |
| `level` | string | no | `"repo"` | Detail: `"repo"`, `"modules"`, or `"files"` |
| `module` | string | no | — | Focus on a specific module |

### scrooge_lookup

Find a symbol's definition and all usages across the codebase.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `symbol` | string | yes | — | Symbol name (e.g. `"LoginViewModel"`) |
| `repo_path` | string | no | cwd | Path to the repository |
| `include_usages` | boolean | no | `true` | Include usage locations |

### scrooge_reindex

Trigger indexing of a repository.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `repo_path` | string | no | cwd | Path to the repository |
| `incremental` | boolean | no | `true` | Only index files changed since last index |

### scrooge_status

Get information about the current index state.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `repo_path` | string | no | cwd | Path to the repository |

### scrooge_statistics

Usage and token savings metrics.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `repo_path` | string | no | cwd | Path to the repository |
| `period` | string | no | `"all"` | `"today"`, `"week"`, `"month"`, or `"all"` |

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

```
src/
├── index.ts              # Entry point — starts MCP server
├── server/
│   ├── mcp.ts            # MCP server creation and tool registration
│   └── tools/            # One file per tool (search, map, lookup, reindex, status, statistics)
├── indexer/
│   ├── pipeline.ts       # Orchestrates: classify → chunk → sketch → embed → store
│   ├── classifier.ts     # File type detection (Kotlin, TypeScript, XML, Gradle, generic)
│   ├── chunkers/         # Language-specific chunkers (tree-sitter for Kotlin/TypeScript, regex for others)
│   └── sketcher.ts       # Compresses chunks into token-efficient sketches
├── retrieval/
│   ├── hybrid.ts         # Orchestrates lexical + vector search with RRF fusion
│   ├── lexical.ts        # FTS5 full-text search with CamelCase splitting
│   ├── vector.ts         # sqlite-vec cosine similarity search
│   └── packager.ts       # Token-budgeted result packaging with diversity constraints
├── repomap/
│   ├── tree.ts           # Directory tree generation
│   └── summaries.ts      # Hierarchical module/file summaries from indexed data
├── storage/
│   └── db.ts             # SQLite schema, migrations, CRUD operations
└── utils/
    ├── config.ts          # Configuration with defaults
    ├── tokens.ts          # Token count estimation
    ├── git.ts             # Git operations (diff, log, file listing)
    └── embeddings.ts      # Local embeddings via @xenova/transformers
```

## How It Works

### Indexing pipeline

```
Repository files
       │
       ▼
  ┌─────────┐     ┌──────────┐     ┌──────────┐     ┌─────────┐     ┌─────────┐
  │ Classify │────▶│  Chunk   │────▶│  Sketch  │────▶│  Embed  │────▶│  Store  │
  │  (type)  │     │ (parse)  │     │(compress)│     │(384-dim)│     │(SQLite) │
  └─────────┘     └──────────┘     └──────────┘     └─────────┘     └─────────┘
```

1. **Classify** — Detect file type (Kotlin, TypeScript, XML, Gradle, or generic)
2. **Chunk** — Parse into semantic units using tree-sitter (Kotlin, TypeScript) or regex patterns. Each chunk represents a class, function, interface, enum, composable, XML resource, or Gradle block
3. **Sketch** — Compress each chunk into a token-efficient summary preserving signatures and structure but dropping implementation details
4. **Embed** — Compute 384-dimensional vectors using all-MiniLM-L6-v2 (runs locally, no API calls)
5. **Store** — Write chunks, sketches, and vectors to SQLite with FTS5 and sqlite-vec indexes

### Search flow

```
Query
  │
  ├──────────────┬────────────────┐
  ▼              ▼                │
┌─────┐    ┌──────────┐          │
│FTS5 │    │sqlite-vec│          │
│lexic│    │  vector  │          │
└──┬──┘    └────┬─────┘          │
   │            │                │
   ▼            ▼                │
 ┌──────────────────┐            │
 │   RRF Fusion     │            │
 │ (k=60, weighted) │            │
 └────────┬─────────┘            │
          ▼                      │
  ┌───────────────┐     ┌───────┴───────┐
  │  Packager     │◀────│ Token Budget  │
  │ (diversity +  │     │   (default    │
  │  dedup)       │     │    3000)      │
  └───────┬───────┘     └───────────────┘
          ▼
    Ranked results
    (sketch or raw)
```

1. **Lexical search** — FTS5 with CamelCase splitting for identifier-aware matching
2. **Vector search** — Embed the query and find cosine-similar chunks via sqlite-vec
3. **RRF Fusion** — Merge both ranked lists using Reciprocal Rank Fusion (k=60)
4. **Packaging** — Select top results within the token budget, enforcing diversity (max 3 chunks per file) and deduplication

## Configuration

All settings have sensible defaults. Override via `getConfig()` in code:

| Setting | Default | Description |
|---------|---------|-------------|
| `dbPath` | `~/.scrooge/scrooge.db` | SQLite database location |
| `defaultTokenBudget` | `3000` | Max tokens per search response |
| `defaultMaxResults` | `8` | Max results per search |
| `maxChunksPerFile` | `3` | Diversity limit: max chunks from one file |
| `sketchMaxTokens` | `200` | Max tokens per sketch |
| `rrfK` | `60` | RRF fusion constant (higher = more weight to lower ranks) |
| `embeddingModel` | `Xenova/all-MiniLM-L6-v2` | Local embedding model |
| `embeddingDims` | `384` | Embedding vector dimensions |

## Database

| | |
|---|---|
| **Location** | `~/.scrooge/scrooge.db` |
| **Engine** | SQLite with WAL mode for concurrent reads |
| **Extensions** | FTS5 (full-text search), sqlite-vec (vector similarity) |
| **Schema version** | Managed via `PRAGMA user_version` with automatic migrations |

To force a full reindex, delete the database:

```bash
rm ~/.scrooge/scrooge.db
```

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests (vitest) |
| `npm run test:watch` | Watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run from source via tsx |
| `npm run lint` | ESLint check |
| `npm run typecheck` | Type check without emitting |

### Test fixtures

Test fixtures in `test/fixtures/` include Kotlin source files, TypeScript/TSX modules, Android XML layouts, and Gradle build scripts — covering the primary file types Scrooge indexes.

### Conventions

- TypeScript strict mode, ESM modules
- All code, comments, and commits in English
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- Tests with vitest in `test/`

## Tech Stack

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.12.0 | MCP protocol implementation |
| `better-sqlite3` | ^11.7.0 | SQLite database driver (native) |
| `sqlite-vec` | ^0.1.6 | Vector similarity search extension |
| `tree-sitter` | ^0.21.1 | Incremental parsing framework (native) |
| `tree-sitter-kotlin` | ^0.3.8 | Kotlin grammar for tree-sitter |
| `tree-sitter-typescript` | ^0.23.2 | TypeScript/TSX grammar for tree-sitter |
| `@xenova/transformers` | ^2.17.0 | Local ML embeddings (all-MiniLM-L6-v2) |
| `zod` | ^3.24.0 | Runtime schema validation |
| `typescript` | ^5.7.0 | Type system and compiler |
| `vitest` | ^4.0.18 | Test framework |
| `eslint` | ^10.0.1 | Linting |

## License

Not yet specified.
