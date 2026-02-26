# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-02-26

### Added

- **SessionStart hook** (`bin/scrooge-session.mjs`): Injects repository index summary and behavioral directives at session start. Queries `index_meta` for file/chunk counts and last indexed commit. Returns `{}` for non-indexed repos (zero overhead).
- **PreToolUse nudge hook** (`bin/scrooge-nudge.mjs`): Intercepts Read/Grep/Glob operations and suggests Scrooge alternatives. Rate-limited to 3 nudges per session. Only activates on code files in indexed repos.
- **Pi.dev exploration nudge**: Extended `tool_call` handler with `maybeNudge()` for read/grep/glob tools. In-memory rate limiting (3/session) with `isRepoIndexed()` cache.
- **Agent instructions template** (`templates/agent-instructions.md`): Reusable markdown with tool preference table and behavioral rules. Content core for all adoption mechanisms.
- **Pi.dev AGENTS.md management**: Setup appends Scrooge instructions to `~/.pi/agent/AGENTS.md` using HTML markers (`<!-- scrooge:start v1 -->` / `<!-- scrooge:end -->`). Backup before modification, never overwrites user content.
- **Template distribution**: Setup copies `agent-instructions.md` to `~/.scrooge/` for manual integration with other agents.

### Changed

- **Setup script** (`bin/setup.mjs`): Consolidated all hook registrations into single settings.json read/write cycle. Now registers SessionStart, PreToolUse (nudge), and manages pi.dev AGENTS.md in addition to existing hooks.
- **Uninstall script** (`bin/uninstall.mjs`): Now removes SessionStart hook, nudge hook, Scrooge section from pi.dev AGENTS.md (preserving user content), and generated template file.
- **Project settings** (`.claude/settings.json`): Now includes SessionStart and nudge hooks alongside existing Write/Edit and observability hooks.

## [0.1.0] - 2026-02-20

### Added

- Initial release with 8 tools: `scrooge_search`, `scrooge_map`, `scrooge_lookup`, `scrooge_context`, `scrooge_deps`, `scrooge_reindex`, `scrooge_status`, `scrooge_statistics`
- Hybrid retrieval engine: FTS5 lexical + sqlite-vec vector search with RRF fusion
- Tree-sitter parsing for Kotlin, TypeScript/TSX, Dart, and Python
- Sketch compression (80-90% token reduction)
- Local embeddings via all-MiniLM-L6-v2 (in-process, no external deps)
- Auto-reindex on HEAD change (transparent to users)
- PreToolUse hook for Write/Edit context injection
- PostToolUse hook for agent coverage tracking
- Multi-channel support: Claude Code (MCP) and pi.dev (extension)
- Token-budgeted result packaging with diversity constraints
- One-command setup (`npm run setup`) and uninstall (`npm run uninstall`)
