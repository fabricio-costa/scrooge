/**
 * Scrooge pi.dev Extension
 *
 * Registers Scrooge's 10 code intelligence tools in pi.dev's tool system.
 * Each tool delegates to the shared API layer with channel: "pi" for telemetry.
 *
 * Also registers hooks for automatic context injection before write/edit
 * operations, native-exploration guardrails before read/grep/glob, and
 * observability after tool execution.
 *
 * Installation:
 *   pi install /path/to/scrooge/packages/pi-extension
 */

import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { search, lookup, source, map, reindex, status, statistics, context, deps } from "scrooge/api";
import type { Channel } from "scrooge/api";
import {
  buildObservedRecord,
  createSessionState,
  getGuardrailDecision,
  getToolInputPath,
  MAX_NUDGES,
  type SessionState,
} from "./adoption.js";

const CHANNEL: Channel = "pi";

const SUPPORTED_EXTENSIONS = ["kt", "ts", "tsx", "dart", "py"];
let repoIndexedCache: boolean | null = null;
const sessionStates = new Map<string, SessionState>();

async function isRepoIndexed(): Promise<boolean> {
  if (repoIndexedCache !== null) return repoIndexedCache;

  const dbPath = join(homedir(), ".scrooge", "scrooge.db");
  if (!existsSync(dbPath)) {
    repoIndexedCache = false;
    return false;
  }

  try {
    const result = await status(
      { channel: CHANNEL, repoPath: undefined, model: process.env.SCROOGE_MODEL },
    );
    repoIndexedCache = (result.total_chunks ?? 0) > 0;
  } catch {
    repoIndexedCache = false;
  }
  return repoIndexedCache;
}

function getSessionId(ctx: unknown): string {
  const sessionManager = (ctx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager;
  try {
    const sessionId = sessionManager?.getSessionId?.();
    if (sessionId) return sessionId;
  } catch {
    // Ignore and fall back below
  }
  return `${process.pid}:${process.cwd()}`;
}

function getRepoPath(ctx: unknown): string {
  const cwd = (ctx as { cwd?: string } | undefined)?.cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();
}

function getSessionState(sessionId: string): SessionState {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = createSessionState();
    sessionStates.set(sessionId, state);
  }
  return state;
}

async function maybeGuardrail(
  toolName: string,
  input: Record<string, unknown> | undefined,
  state: SessionState,
): Promise<{ additionalContext: string } | { block: true; reason: string } | undefined> {
  const indexed = await isRepoIndexed();
  if (!indexed) return;

  const decision = getGuardrailDecision(toolName, input, state);
  if (!decision) return;

  if (decision.action === "block") {
    return { block: true, reason: decision.message };
  }

  if (decision.rateLimited && state.nudgeCount >= MAX_NUDGES) return;

  if (decision.rateLimited) {
    state.nudgeCount += 1;
  }

  return { additionalContext: decision.message };
}

function observeToolResult(
  toolName: string,
  input: Record<string, unknown> | undefined,
  repoPath: string,
  sessionId: string,
  state: SessionState,
): void {
  try {
    const scroogeDir = join(homedir(), ".scrooge");
    mkdirSync(scroogeDir, { recursive: true });

    const record = buildObservedRecord(toolName, repoPath, sessionId, input, state);
    appendFileSync(join(scroogeDir, "observed.jsonl"), JSON.stringify(record) + "\n");
  } catch {
    /* silent */
  }
}

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
  on(
    event: string,
    handler: (event: Record<string, unknown>, ctx: unknown) => Promise<unknown> | unknown,
  ): void;
}

export default function (pi: PiExtensionAPI): void {
  // --- scrooge_search ---
  pi.registerTool({
    name: "scrooge_search",
    label: "Scrooge Search",
    description:
      "Hybrid code search with query rewriting, lexical + vector retrieval, and heuristic reranking across an indexed repository. Returns ranked chunks with token-budgeted snippets. Use sketch for planning, implementation for focused code understanding, and raw for full source.",
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
      view: Type.Optional(
        Type.Union([Type.Literal("sketch"), Type.Literal("implementation"), Type.Literal("raw")]),
      ),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      token_budget: Type.Optional(Type.Integer({ minimum: 100, maximum: 50000 })),
    }),
    async execute(_toolCallId, params) {
      const result = await search(
        {
          query: params.query as string,
          filters: params.filters as Record<string, unknown> | undefined,
          view: params.view as "sketch" | "implementation" | "raw" | undefined,
          maxResults: params.max_results as number | undefined,
          tokenBudget: params.token_budget as number | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
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
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- scrooge_source ---
  pi.registerTool({
    name: "scrooge_source",
    label: "Scrooge Source",
    description:
      "Get the exact raw source for a known chunk or symbol. Use this instead of reading a whole file when you already know what implementation you need.",
    parameters: Type.Object({
      chunk_id: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "Exact chunk ID" })),
      symbol: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "Symbol name" })),
      before: Type.Optional(Type.Integer({ minimum: 0, maximum: 200, description: "Extra lines before the chunk" })),
      after: Type.Optional(Type.Integer({ minimum: 0, maximum: 200, description: "Extra lines after the chunk" })),
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    async execute(_toolCallId, params) {
      if (!params.chunk_id && !params.symbol) {
        throw new Error("Provide chunk_id or symbol");
      }

      const result = await source(
        {
          chunkId: params.chunk_id as string | undefined,
          symbol: params.symbol as string | undefined,
          before: params.before as number | undefined,
          after: params.after as number | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
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
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
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
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
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
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
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
      format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("json")])),
    }),
    async execute(_toolCallId, params) {
      const result = await statistics(
        {
          period: params.period as "today" | "week" | "month" | "all" | undefined,
          format: params.format as "text" | "json" | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
      );
      return {
        content: [{ type: "text", text: params.format === "json" ? JSON.stringify(result.data, null, 2) : result.report }],
        details: params.format === "json" ? result.data : {},
      };
    },
  });

  // --- scrooge_context ---
  pi.registerTool({
    name: "scrooge_context",
    label: "Scrooge Context",
    description:
      "Get project patterns for a given chunk kind. Returns common annotations, tags, imports, and example sketches.",
    parameters: Type.Object({
      kind: Type.String({ minLength: 1, maxLength: 100, description: "Chunk kind (e.g., 'viewmodel', 'composable')" }),
      module: Type.Optional(Type.String({ maxLength: 200, description: "Filter to a specific module" })),
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    async execute(_toolCallId, params) {
      const result = await context(
        {
          kind: params.kind as string,
          module: params.module as string | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- scrooge_deps ---
  pi.registerTool({
    name: "scrooge_deps",
    label: "Scrooge Deps",
    description:
      "Get a compact dependency graph for a symbol: forward (uses) and reverse (used by) dependencies.",
    parameters: Type.Object({
      symbol: Type.String({ minLength: 1, maxLength: 200, description: "Symbol name to look up" }),
      direction: Type.Optional(
        Type.Union([Type.Literal("forward"), Type.Literal("reverse"), Type.Literal("both")]),
      ),
      repo_path: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    async execute(_toolCallId, params) {
      const result = await deps(
        {
          symbol: params.symbol as string,
          direction: params.direction as "forward" | "reverse" | "both" | undefined,
        },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- Observability after tool execution (matches Claude PostToolUse semantics) ---
  pi.on("tool_result", async (event, ctx) => {
    const toolName = event.toolName as string | undefined;
    if (!toolName) return;

    const sessionId = getSessionId(ctx);
    const repoPath = getRepoPath(ctx);
    const state = getSessionState(sessionId);
    observeToolResult(toolName, event.input as Record<string, unknown> | undefined, repoPath, sessionId, state);
  });

  // --- Automatic context injection + native-exploration guardrails ---
  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName as string | undefined;
    if (!toolName) return;

    const sessionId = getSessionId(ctx);
    const state = getSessionState(sessionId);

    if (toolName === "read" || toolName === "grep" || toolName === "glob") {
      const decision = await maybeGuardrail(toolName, event.input as Record<string, unknown> | undefined, state);
      if (decision) return decision;
    }

    if (toolName !== "write" && toolName !== "edit") return;

    const input = event.input as Record<string, unknown> | undefined;
    const filePath = getToolInputPath(input);
    if (!filePath) return;

    const ext = filePath.split(".").pop();
    if (!ext || !SUPPORTED_EXTENSIONS.includes(ext)) return;

    try {
      const repoPath = execSync("git rev-parse --show-toplevel", {
        encoding: "utf-8",
        timeout: 2000,
      }).trim();

      const result = await context(
        { kind: "function" },
        { channel: CHANNEL, repoPath, model: process.env.SCROOGE_MODEL },
      );

      if (result.sampleCount === 0) return;

      const lines: string[] = ["## Project Patterns (auto-injected by Scrooge)"];
      if (result.commonAnnotations.length > 0) {
        lines.push(`Annotations: ${result.commonAnnotations.join(", ")}`);
      }
      if (result.commonImports.length > 0) {
        lines.push(`Common imports: ${result.commonImports.join(", ")}`);
      }
      if (result.commonTags.length > 0) {
        lines.push(`Tags: ${result.commonTags.join(", ")}`);
      }
      if (result.exampleSketches.length > 0) {
        lines.push("Example:");
        lines.push(result.exampleSketches[0].sketch);
      }

      return { additionalContext: lines.join("\n") };
    } catch {
      // Silent failure — don't block the write/edit
    }
  });
}
