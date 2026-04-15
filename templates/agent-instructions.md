## Code Exploration (Scrooge)

This project is indexed by Scrooge, a local code intelligence server.
PREFER Scrooge tools over native tools for ALL code exploration:

| Intent | Use This | NOT This |
|--------|----------|----------|
| Find code by concept or name | `scrooge_search` | Grep, Glob |
| Understand project structure | `scrooge_map` | Glob + Read |
| Find symbol definition/usages | `scrooge_lookup` | Grep for definitions |
| Inspect exact code for a known symbol/chunk | `scrooge_source` | Read full file |
| Check dependencies before refactoring | `scrooge_deps` | Grep + Read imports |
| Understand conventions before writing | `scrooge_context` | Read multiple files |

**Rules:**
1. Start with `scrooge_map` (repo level) when orienting in the codebase
2. If you know the exact symbol name, use `scrooge_lookup` first
3. If you know the concept but not the symbol, use `scrooge_search`
4. If you already know the symbol or chunk and need the exact code, use `scrooge_source`
5. Use `scrooge_deps` before refactoring to understand blast radius
6. Do not use `Read` to discover code — use Scrooge first, then read only the exact file or slice you need
7. Before opening a full code file, prefer `scrooge_search` with `view: "implementation"` for focused code details; use `view: "raw"` only when you need the full chunk source
8. Fall back to native Read/Grep ONLY for: exact raw file content, non-code files, or regex on a known file path
9. Some Scrooge installations run in strict guardrail mode: blind native Read/Grep/Glob may be blocked, so keep native exploration for non-code files, regex on a known path, or guided follow-up reads after Scrooge

Index is automatic — no manual setup or reindex needed.
