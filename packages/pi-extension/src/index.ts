/**
 * Scrooge pi.dev Extension
 *
 * Registers Scrooge's 6 code intelligence tools in pi.dev's tool system.
 * Each tool delegates to the shared API layer with channel: "pi" for telemetry.
 *
 * Installation:
 *   pi install npm:@fabricio-costa/pi-scrooge
 *   pi install /path/to/scrooge/packages/pi-extension
 */

import { Type } from "@sinclair/typebox";
import { search, lookup, map, reindex, status, statistics } from "scrooge/api";
import type { Channel } from "scrooge/api";

const CHANNEL: Channel = "pi";

// pi.dev extension interface (declared inline to avoid dependency on pi.dev types)
interface PiContext {
  registerTool(def: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (params: Record<string, unknown>) => Promise<unknown>;
  }): void;
}

export function activate(ctx: PiContext): void {
  // --- scrooge_search ---
  ctx.registerTool({
    name: "scrooge_search",
    description:
      "Hybrid code search (lexical + vector) across an indexed repository. Returns ranked chunks with token-budgeted snippets.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 1000, description: "Search query" }),
      repo_path: Type.Optional(Type.String({ maxLength: 500, description: "Absolute path to the repository" })),
      filters: Type.Optional(
        Type.Object({
          module: Type.Optional(Type.String()),
          language: Type.Optional(Type.String()),
          kind: Type.Optional(Type.String()),
          tags: Type.Optional(Type.Array(Type.String())),
        }),
      ),
      view: Type.Optional(Type.Union([Type.Literal("sketch"), Type.Literal("raw")])),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      token_budget: Type.Optional(Type.Integer({ minimum: 100, maximum: 50000 })),
    }),
    execute: async (params) => {
      return search(
        {
          query: params.query as string,
          filters: params.filters as Record<string, unknown> | undefined,
          view: params.view as "sketch" | "raw" | undefined,
          maxResults: params.max_results as number | undefined,
          tokenBudget: params.token_budget as number | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
    },
  });

  // --- scrooge_lookup ---
  ctx.registerTool({
    name: "scrooge_lookup",
    description: "Look up a symbol by name: find its definition and all usages across the codebase.",
    parameters: Type.Object({
      symbol: Type.String({ minLength: 1, maxLength: 200, description: "Symbol name to look up" }),
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
      include_usages: Type.Optional(Type.Boolean()),
    }),
    execute: async (params) => {
      return lookup(
        {
          symbol: params.symbol as string,
          includeUsages: params.include_usages as boolean | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
    },
  });

  // --- scrooge_map ---
  ctx.registerTool({
    name: "scrooge_map",
    description: "Get a repository map: directory tree and hierarchical summaries.",
    parameters: Type.Object({
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
      level: Type.Optional(Type.Union([Type.Literal("repo"), Type.Literal("modules"), Type.Literal("files")])),
      module: Type.Optional(Type.String()),
    }),
    execute: async (params) => {
      return map(
        {
          level: params.level as "repo" | "modules" | "files" | undefined,
          module: params.module as string | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
    },
  });

  // --- scrooge_reindex ---
  ctx.registerTool({
    name: "scrooge_reindex",
    description: "Trigger indexing of a repository. Defaults to incremental mode.",
    parameters: Type.Object({
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
      incremental: Type.Optional(Type.Boolean()),
    }),
    execute: async (params) => {
      return reindex(
        { incremental: params.incremental as boolean | undefined },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
    },
  });

  // --- scrooge_status ---
  ctx.registerTool({
    name: "scrooge_status",
    description: "Get information about the Scrooge index for a repository.",
    parameters: Type.Object({
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    execute: async (params) => {
      return status(
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
    },
  });

  // --- scrooge_statistics ---
  ctx.registerTool({
    name: "scrooge_statistics",
    description: "Usage and token savings metrics for Scrooge.",
    parameters: Type.Object({
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
      period: Type.Optional(
        Type.Union([Type.Literal("today"), Type.Literal("week"), Type.Literal("month"), Type.Literal("all")]),
      ),
    }),
    execute: async (params) => {
      return statistics(
        { period: params.period as "today" | "week" | "month" | "all" | undefined },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
    },
  });
}
