## Code Exploration (Scrooge)

This project is indexed by Scrooge, a local code intelligence server.
PREFER Scrooge tools over native tools for ALL code exploration:

| Intent | Use This | NOT This |
|--------|----------|----------|
| Find code by concept or name | `scrooge_search` | Grep, Glob |
| Understand project structure | `scrooge_map` | Glob + Read |
| Find symbol definition/usages | `scrooge_lookup` | Grep for definitions |
| Check dependencies before refactoring | `scrooge_deps` | Grep + Read imports |
| Understand conventions before writing | `scrooge_context` | Read multiple files |

**Rules:**
1. Start with `scrooge_map` (repo level) when orienting in the codebase
2. Use `scrooge_search` for "where is X" or "how does Y work"
3. Use `scrooge_lookup` when you know the exact symbol name
4. Use `scrooge_deps` before refactoring to understand blast radius
5. Fall back to native Read/Grep ONLY for: exact raw file content, non-code files, or regex on a known file path

Index is automatic — no manual setup or reindex needed.
