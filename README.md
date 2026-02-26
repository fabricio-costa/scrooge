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
- **`scrooge_context`** — Project patterns for a chunk kind: common annotations, tags, imports, and example sketches
- **`scrooge_deps`** — Compact dependency graph: forward (what a symbol uses) and reverse (who uses it)
- **`scrooge_reindex`** — Trigger full or incremental indexing of a repository
- **`scrooge_status`** — Check index freshness: last indexed commit, total chunks, staleness
- **`scrooge_statistics`** — Usage metrics and token savings breakdown over configurable time periods
- **Execution hooks** — Automatic context injection before Write/Edit, exploration nudges for Read/Grep/Glob, and session onboarding with index summary
- **Multi-channel** — Shared API layer supports Claude Code (MCP) and pi.dev (extension) with per-channel telemetry

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
git clone https://github.com/fabricio-costa/scrooge.git
cd scrooge
npm install
npm run setup
```

`npm run setup` builds the project, registers the MCP server with Claude Code (user scope), configures hooks (SessionStart onboarding, PreToolUse pattern injection + exploration nudges, PostToolUse observability), manages pi.dev AGENTS.md, and optionally installs the pi.dev extension.

To uninstall: `npm run uninstall`

<details>
<summary>Manual registration (advanced)</summary>

### Claude Code (MCP)

Register at **user scope** so Scrooge is available from any project directory:

```bash
# Build first:
npm run build

# Production (uses compiled JS):
claude mcp add -s user scrooge -- node /absolute/path/to/scrooge/bin/scrooge-mcp.mjs

# Development (uses tsx for live reload):
claude mcp add scrooge -- npx tsx /absolute/path/to/scrooge/src/index.ts
```

The launcher script (`bin/scrooge-mcp.mjs`) automatically detects when native modules (`better-sqlite3`, `tree-sitter`) were compiled against a different Node.js version and rebuilds them before starting the server.

### pi.dev (Extension)

```bash
pi install /path/to/scrooge/packages/pi-extension
```

Pi.dev loads TypeScript extensions via jiti — no build step needed for the extension itself. Hot-reload with `/reload`.

</details>

## Quick Start

Once registered, Scrooge tools are available in your agent sessions. **No manual indexing required** — the index is created and maintained automatically.

**1. Search the codebase**

```
> Use scrooge_search to find authentication-related code
```

On the first query, Scrooge automatically indexes the repository. On subsequent queries, if the repo has new commits, an incremental reindex runs transparently before returning results. You never need to think about `scrooge_reindex` — the index stays fresh automatically.

Returns ranked results with sketch-compressed snippets, staying within a token budget.

**2. Explore the repo map**

```
> Use scrooge_map at repo level to see the project structure
```

Returns a directory tree with hierarchical summaries of each module.

**3. Look up a symbol**

```
> Use scrooge_lookup to find where LoginViewModel is defined and used
```

**4. Check your savings**

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
| `filters.language` | string | no | — | Language: `kotlin`, `typescript`, `dart`, `python`, `xml`, `gradle` |
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

### scrooge_context

Get project patterns for a given chunk kind — so the agent writes code matching existing conventions.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `kind` | string | yes | — | Chunk kind (e.g. `"viewmodel"`, `"composable"`, `"dao"`) |
| `module` | string | no | — | Filter to a specific module |
| `repo_path` | string | no | cwd | Path to the repository |

**Example response:**

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

Compact dependency graph for refactoring decisions: who a symbol depends on and who depends on it.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `symbol` | string | yes | — | Symbol name (e.g. `"AuthRepository"`) |
| `direction` | string | no | `"both"` | `"forward"`, `"reverse"`, or `"both"` |
| `repo_path` | string | no | cwd | Path to the repository |

**Example response:**

```json
{
  "symbol": "AuthRepository",
  "definitions": [{ "symbol": "AuthRepository", "path": "data/AuthRepository.kt", "kind": "class", "module": ":data" }],
  "forward": [{ "symbol": "ApiService", "path": "api/ApiService.kt", "kind": "api_interface", "module": ":api" }],
  "reverse": [{ "symbol": "LoginViewModel", "path": "feature/auth/LoginViewModel.kt", "kind": "viewmodel", "module": ":feature:auth" }]
}
```

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
| `SCROOGE_MODEL` | AI model identifier (e.g., `claude-opus-4-6`). Recorded in telemetry for per-model usage breakdown in `scrooge_statistics`. |

## Hooks

Scrooge registers several hooks to integrate seamlessly with agent workflows. `npm run setup` configures all hooks automatically.

| Hook | Trigger | Purpose |
|------|---------|---------|
| **SessionStart** | Session begins | Injects index summary + tool preference directives for indexed repos |
| **PreToolUse** (Write\|Edit) | Before file writes | Injects project patterns (annotations, imports, sketches) |
| **PreToolUse** (Read\|Grep\|Glob) | Before exploration | Suggests Scrooge alternatives (rate-limited: 3/session) |
| **PostToolUse** | After any tool call | Records tool usage to `~/.scrooge/observed.jsonl` for coverage metrics |

All hooks return `{}` for non-indexed repos (zero overhead) and fail silently on timeout.

<details>
<summary>Manual hook configuration (Claude Code)</summary>

Add to `~/.claude/settings.json` (user scope) or your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "node /path/to/scrooge/bin/scrooge-session.mjs", "timeout": 3 }]
    }],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "node /path/to/scrooge/bin/scrooge-hook.mjs", "timeout": 3 }]
      },
      {
        "matcher": "Read|Grep|Glob",
        "hooks": [{ "type": "command", "command": "node /path/to/scrooge/bin/scrooge-nudge.mjs", "timeout": 2 }]
      }
    ],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node /path/to/scrooge/bin/scrooge-observe.mjs", "timeout": 3 }]
    }]
  }
}
```

### pi.dev

The pi.dev extension handles all hooks automatically via the `tool_call` event — no additional configuration needed. During installation, `npm run setup` also appends Scrooge instructions to `~/.pi/agent/AGENTS.md` (with HTML markers for safe updates/removal).

</details>

## Architecture

```
src/
├── index.ts              # Entry point — starts MCP server
├── api/                  # Transport-agnostic API layer (shared by MCP + pi.dev)
│   ├── index.ts          # Barrel export
│   ├── types.ts          # Shared request/response interfaces, Channel type
│   ├── search.ts         # search() — orchestrates hybrid search + telemetry
│   ├── lookup.ts         # lookup() — symbol definitions + usages + telemetry
│   ├── map.ts            # map() — repo tree + summaries + telemetry
│   ├── context.ts        # context() — project pattern aggregation + telemetry
│   ├── deps.ts           # deps() — dependency graph extraction + telemetry
│   ├── reindex.ts        # reindex() — pipeline trigger + telemetry
│   ├── status.ts         # status() — index freshness check + telemetry
│   └── statistics.ts     # statistics() + buildStatisticsReport()
├── server/
│   ├── mcp.ts            # MCP server creation and tool registration
│   └── tools/            # Thin MCP adapters: Zod schema → API call → JSON response
├── indexer/
│   ├── pipeline.ts       # Orchestrates: classify → chunk → sketch → embed → store
│   ├── classifier.ts     # File type detection (Kotlin, TypeScript, Dart, Python, XML, Gradle, generic)
│   ├── chunkers/         # Language-specific chunkers (tree-sitter for Kotlin/TypeScript/Dart/Python, regex for others)
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
    ├── freshness.ts       # Auto-reindex: ensures index is fresh before queries
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

1. **Classify** — Detect file type by extension (`.kt` → Kotlin, `.ts`/`.tsx` → TypeScript, `.dart` → Dart, `.py` → Python, `.xml` → XML, `.gradle.kts` → Gradle, everything else → generic)
2. **Chunk** — Parse into semantic units. See [Supported Languages](#supported-languages) below
3. **Sketch** — Compress each chunk into a token-efficient summary. See [Sketches](#sketches) below
4. **Embed** — Compute vector embeddings for semantic search. See [Embeddings](#embeddings) below
5. **Store** — Write chunks, sketches, and vectors to SQLite with FTS5 and sqlite-vec indexes

### Supported languages

| Language | Parser | Chunk kinds |
|----------|--------|-------------|
| **Kotlin** | tree-sitter AST | `class`, `viewmodel`, `composable`, `function`, `method`, `api_interface`, `dao`, `entity` |
| **TypeScript/TSX** | tree-sitter AST | `class`, `function`, `method`, `interface`, `type_alias`, `enum` |
| **Dart/Flutter** | tree-sitter AST | `class`, `function`, `method`, `enum`, `mixin`, `extension`, `type_alias` |
| **Python** | tree-sitter AST | `class`, `dataclass`, `function`, `method` |
| **XML** (Android) | Regex patterns | `manifest_component`, `nav_destination`, `layout`, `values` |
| **Gradle** | Regex patterns | `gradle_plugins`, `gradle_android`, `gradle_dependencies`, `gradle_settings` |
| **Other** | Line-based splitter | `generic_block`, `generic_file` |

Tree-sitter chunkers extract semantic boundaries (class/function/interface declarations), while regex-based chunkers match structural patterns. Large classes (>400 lines) are automatically split into a class-level chunk plus individual method chunks.

### Sketches

Sketches are compressed representations of code chunks that preserve structure while dropping implementation details. They typically reduce token count by 80-90% compared to raw source.

What a sketch preserves:
- **Signatures** — function/method signatures, class declarations, type annotations
- **Doc comments** — JSDoc (`/** */`) and KDoc comments
- **Annotations** — `@HiltViewModel`, `@Composable`, `@GET`, etc.
- **Class skeleton** — property declarations and method signatures (no bodies)
- **Interface members** — property and method signatures
- **Enum members** — member names and values

Each sketch is capped at 200 tokens (configurable via `sketchMaxTokens`). Longer sketches are truncated with a `... (truncated)` marker.

### Embeddings

Scrooge uses [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) via `@xenova/transformers` for local embedding generation — no external API calls, no network dependency. The model is vendored in `models/` and remote downloads are blocked at runtime, eliminating supply-chain risk from HuggingFace Hub.

| Property | Value |
|----------|-------|
| Model | `Xenova/all-MiniLM-L6-v2` (quantized ONNX) |
| Dimensions | 384 |
| Pooling | Mean pooling over all output tokens |
| Normalization | L2-normalized (unit vectors), enabling cosine similarity via dot product |
| Runtime | In-process via ONNX Runtime (Node.js) |
| Storage | Vendored in `models/` (~23MB, committed to git) |

During indexing, Scrooge embeds each chunk's **sketch** (not the raw source). This is intentional — the sketch contains the semantic essence (signatures, names, structure) without implementation noise, producing higher-quality embeddings for code search.

During search, the user's query is embedded with the same model and compared against all stored vectors using sqlite-vec's cosine distance.

### Auto-reindex

Scrooge automatically keeps the index fresh. Before every `search`, `map`, or `lookup` call, it compares the repository's current `HEAD` with the last indexed commit. If they differ, an incremental reindex runs transparently before returning results.

```
Tool called (search/map/lookup)
       │
       ▼
  HEAD == last_indexed_sha?
  ├─ yes → proceed normally
  └─ no  → incremental reindex → proceed
```

This means you never need to call `scrooge_reindex` manually — the index is always up to date when you query it. The first query on an unindexed repo triggers a full index automatically.

When auto-reindex occurs, a `_note` field is included in the response with timing and file count details.

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

1. **Lexical search** — FTS5 full-text search with BM25 ranking. Queries are tokenized with CamelCase splitting (`LoginViewModel` → `login OR view OR model OR loginviewmodel`) so both exact identifiers and sub-words match. Supports filtering by module, language, kind, and tags
2. **Vector search** — The query is embedded with MiniLM-L6-v2 and compared against all chunk vectors via sqlite-vec cosine distance. Results are ranked by similarity (1 - distance). Same filters apply post-query
3. **RRF Fusion** — Both ranked lists are merged using Reciprocal Rank Fusion: `score(doc) = Σ 1/(k + rank)` where `k=60`. Documents appearing in both lists accumulate scores from each, naturally rising to the top
4. **Packaging** — Results are packed within a token budget (default 3000). A diversity constraint limits each file to at most 3 chunks, preventing a single large file from dominating results. In `sketch` view, the compressed sketch is returned; in `raw` view, full source code

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
| `modelPath` | `<project>/models` | Path to vendored ONNX model files |

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
| `npm run setup` | Build, register MCP server, configure hooks |
| `npm run uninstall` | Remove all registrations and hooks |
| `npm test` | Run all tests (vitest) |
| `npm run test:watch` | Watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run from source via tsx |
| `npm run lint` | ESLint check |
| `npm run typecheck` | Type check without emitting |

### Test fixtures

Test fixtures in `test/fixtures/` include Kotlin source files, TypeScript/TSX modules, Dart/Flutter files, Python modules, Android XML layouts, and Gradle build scripts — covering the primary file types Scrooge indexes.

### Conventions

- TypeScript strict mode, ESM modules
- All communication in English — code, comments, commits, and conversation responses
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
| `tree-sitter-dart` | github:UserNobody14#c1222f5 | Dart grammar for tree-sitter (ABI 14 compatible) |
| `tree-sitter-python` | ^0.21.0 | Python grammar for tree-sitter |
| `@xenova/transformers` | ^2.17.0 | Local ML embeddings (all-MiniLM-L6-v2) |
| `zod` | ^3.24.0 | Runtime schema validation |
| `typescript` | ^5.7.0 | Type system and compiler |
| `vitest` | ^4.0.18 | Test framework |
| `@sinclair/typebox` | ^0.34.0 | Schema validation for pi.dev extension |
| `eslint` | ^10.0.1 | Linting |

## License

Not yet specified.
