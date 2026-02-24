/**
 * Scrooge pi.dev Extension
 *
 * Registers Scrooge's 6 code intelligence tools in pi.dev's tool system.
 * Each tool delegates to the shared API layer with channel: "pi" for telemetry.
 *
 * Installation:
 *   pi install /path/to/scrooge/packages/pi-extension
 */

import { Type } from "@sinclair/typebox";
import { search, lookup, map, reindex, status, statistics } from "scrooge/api";
import type { Channel } from "scrooge/api";

const CHANNEL: Channel = "pi";

// Minimal type for pi.dev's ExtensionAPI — avoids hard dep on @mariozechner/pi-coding-agent
interface PiExtensionAPI {
  registerTool(def: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: unknown,
      ctx: unknown,
    ): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
  }): void;
}

export default function (pi: PiExtensionAPI): void {
  // --- scrooge_search ---
  pi.registerTool({
    name: "scrooge_search",
    label: "Scrooge Search",
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
    async execute(_toolCallId, params) {
      const result = await search(
        {
          query: params.query as string,
          filters: params.filters as Record<string, unknown> | undefined,
          view: params.view as "sketch" | "raw" | undefined,
          maxResults: params.max_results as number | undefined,
          tokenBudget: params.token_budget as number | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- scrooge_lookup ---
  pi.registerTool({
    name: "scrooge_lookup",
    label: "Scrooge Lookup",
    description: "Look up a symbol by name: find its definition and all usages across the codebase.",
    parameters: Type.Object({
      symbol: Type.String({ minLength: 1, maxLength: 200, description: "Symbol name to look up" }),
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
      include_usages: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params) {
      const result = await lookup(
        {
          symbol: params.symbol as string,
          includeUsages: params.include_usages as boolean | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- scrooge_map ---
  pi.registerTool({
    name: "scrooge_map",
    label: "Scrooge Map",
    description: "Get a repository map: directory tree and hierarchical summaries.",
    parameters: Type.Object({
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
      level: Type.Optional(Type.Union([Type.Literal("repo"), Type.Literal("modules"), Type.Literal("files")])),
      module: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const result = await map(
        {
          level: params.level as "repo" | "modules" | "files" | undefined,
          module: params.module as string | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
      return { content: [{ type: "text", text: result.content }], details: {} };
    },
  });

  // --- scrooge_reindex ---
  pi.registerTool({
    name: "scrooge_reindex",
    label: "Scrooge Reindex",
    description: "Trigger indexing of a repository. Defaults to incremental mode.",
    parameters: Type.Object({
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
      incremental: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params) {
      const result = await reindex(
        { incremental: params.incremental as boolean | undefined },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- scrooge_status ---
  pi.registerTool({
    name: "scrooge_status",
    label: "Scrooge Status",
    description: "Get information about the Scrooge index for a repository.",
    parameters: Type.Object({
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    async execute(_toolCallId, params) {
      const result = await status(
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- scrooge_statistics ---
  pi.registerTool({
    name: "scrooge_statistics",
    label: "Scrooge Statistics",
    description: "Usage and token savings metrics for Scrooge.",
    parameters: Type.Object({
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
      period: Type.Optional(
        Type.Union([Type.Literal("today"), Type.Literal("week"), Type.Literal("month"), Type.Literal("all")]),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await statistics(
        { period: params.period as "today" | "week" | "month" | "all" | undefined },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined },
      );
      return { content: [{ type: "text", text: result.report }], details: {} };
    },
  });
}
