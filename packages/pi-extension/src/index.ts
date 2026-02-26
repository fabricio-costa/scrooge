/**
 * Scrooge pi.dev Extension
 *
 * Registers Scrooge's 8 code intelligence tools in pi.dev's tool system.
 * Each tool delegates to the shared API layer with channel: "pi" for telemetry.
 *
 * Also registers a tool_call hook for automatic context injection before
 * write/edit operations on supported file types.
 *
 * Installation:
 *   pi install /path/to/scrooge/packages/pi-extension
 */

import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { status as scroogeStatus } from "scrooge/api";
import { search, lookup, map, reindex, status, statistics, context, deps } from "scrooge/api";
import type { Channel } from "scrooge/api";

const CHANNEL: Channel = "pi";

const SUPPORTED_EXTENSIONS = ["kt", "ts", "tsx", "dart", "py"];
const CODE_EXTENSIONS = ["kt", "ts", "tsx", "js", "jsx", "dart", "py", "rb", "go", "rs", "java"];

const NUDGE_MESSAGES: Record<string, string> = {
  read: "Scrooge tip: scrooge_lookup finds a symbol's definition and all usages in one call. Try it before reading multiple files.",
  grep: "Scrooge tip: scrooge_search returns ranked, sketch-compressed results across the entire codebase. Try scrooge_search instead of grep for code exploration.",
  glob: "Scrooge tip: scrooge_map provides a hierarchical repo overview with summaries. Try scrooge_map instead of glob for understanding project structure.",
};

const MAX_NUDGES = 3;
let nudgeCount = 0;
let repoIndexedCache: boolean | null = null;

async function isRepoIndexed(): Promise<boolean> {
  if (repoIndexedCache !== null) return repoIndexedCache;

  const dbPath = join(homedir(), ".scrooge", "scrooge.db");
  if (!existsSync(dbPath)) {
    repoIndexedCache = false;
    return false;
  }

  try {
    const result = await scroogeStatus(
      { channel: CHANNEL, repoPath: undefined, model: process.env.SCROOGE_MODEL },
    );
    repoIndexedCache = (result.total_chunks ?? 0) > 0;
  } catch {
    repoIndexedCache = false;
  }
  return repoIndexedCache;
}

async function maybeNudge(toolName: string, event: Record<string, unknown>): Promise<{ additionalContext: string } | undefined> {
  if (nudgeCount >= MAX_NUDGES) return;

  // For read: only nudge on code files
  if (toolName === "read") {
    const input = event.input as Record<string, unknown> | undefined;
    const filePath = input?.file_path as string | undefined;
    if (filePath) {
      const ext = filePath.split(".").pop();
      if (!ext || !CODE_EXTENSIONS.includes(ext)) return;
    }
  }

  const indexed = await isRepoIndexed();
  if (!indexed) return;

  const message = NUDGE_MESSAGES[toolName];
  if (!message) return;

  nudgeCount++;
  return { additionalContext: message };
}

function observeToolCall(toolName: string): void {
  try {
    const scroogeDir = join(homedir(), ".scrooge");
    mkdirSync(scroogeDir, { recursive: true });
    const record = JSON.stringify({
      t: new Date().toISOString(),
      tool: `pi:${toolName}`,
      repo: process.cwd(),
      sid: "",
    });
    appendFileSync(join(scroogeDir, "observed.jsonl"), record + "\n");
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
    }),
    async execute(_toolCallId, params) {
      const result = await statistics(
        { period: params.period as "today" | "week" | "month" | "all" | undefined },
        { channel: CHANNEL, repoPath: params.repo_path as string | undefined, model: process.env.SCROOGE_MODEL },
      );
      return { content: [{ type: "text", text: result.report }], details: {} };
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

  // --- Automatic context injection hook ---
  pi.on("tool_call", async (event) => {
    const toolName = event.toolName as string | undefined;
    if (toolName) observeToolCall(toolName);

    // Nudge for exploration tools
    if (toolName === "read" || toolName === "grep" || toolName === "glob") {
      return maybeNudge(toolName, event);
    }

    if (toolName !== "write" && toolName !== "edit") return;

    const input = event.input as Record<string, unknown> | undefined;
    const filePath = input?.file_path as string | undefined;
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
