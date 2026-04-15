import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const MAX_NUDGES = 3;

const CODE_EXTENSIONS = new Set(["kt", "ts", "tsx", "js", "jsx", "dart", "py", "rb", "go", "rs", "java", "sql"]);
const SCROOGE_EXPLORATION = /^(?:mcp__.*scrooge.*__(?:scrooge_)?|pi:scrooge_)(search|lookup|map|context|deps|source)$/;
const NATIVE_EXPLORATION = /^(?:Read|Grep|Glob|pi:(?:read|grep|glob))$/;
const GENERIC_BASENAMES = new Set([
  "app",
  "build",
  "config",
  "constants",
  "helpers",
  "index",
  "main",
  "package",
  "readme",
  "settings",
  "setup",
  "types",
  "utils",
]);
const SYMBOL_HINT_TOKENS = new Set([
  "adapter",
  "api",
  "client",
  "controller",
  "dao",
  "handler",
  "hook",
  "manager",
  "model",
  "module",
  "provider",
  "repo",
  "repository",
  "screen",
  "service",
  "store",
  "use",
  "view",
  "viewmodel",
]);

function createEmptyState() {
  return {
    nudgeCount: 0,
    lastScroogeTool: null,
    lastScroogeAt: null,
    lastNativeAt: null,
    lastSearchQuery: null,
    lastSymbol: null,
    lastChunkId: null,
  };
}

export function normalizeGuardrailPolicy(value = process.env.SCROOGE_NATIVE_EXPLORATION_POLICY) {
  switch (value?.trim().toLowerCase()) {
    case "off":
      return "off";
    case "strict":
      return "strict";
    case "warn":
    default:
      return "warn";
  }
}

export function normalizeNativeReasonCode(value = process.env.SCROOGE_NATIVE_EXPLORATION_OVERRIDE_REASON) {
  switch (value?.trim().toLowerCase()) {
    case "known_raw_content":
    case "known_path_regex":
    case "non_code_file":
    case "final_verification":
      return value.trim().toLowerCase();
    default:
      return null;
  }
}

function getStatePath(sessionId) {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, "_");
  return join(tmpdir(), `scrooge-session-${safeSessionId}.json`);
}

function truncateText(value, max = 200) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function stripKnownExtension(fileName) {
  if (/\.d\.[^.]+$/i.test(fileName)) return fileName.replace(/\.d\.[^.]+$/i, "");
  return fileName.replace(/\.[^.]+$/i, "");
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

function toPascalCase(parts) {
  return parts.map(capitalize).join("");
}

function getStringField(input, keys) {
  if (!input || typeof input !== "object") return undefined;

  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function getInputText(input) {
  return getStringField(input, ["query", "pattern", "search", "regex", "glob", "value", "text"]);
}

function getInputSymbol(input) {
  return getStringField(input, ["symbol", "symbol_name"]);
}

function getInputChunkId(input) {
  return getStringField(input, ["chunk_id", "chunkId", "id"]);
}

function hasSliceRequest(input) {
  if (!input || typeof input !== "object") return false;
  return Number.isInteger(input.offset) || Number.isInteger(input.limit);
}

function looksRegexLike(value) {
  return /\\[bBdDsSwW]/.test(value)
    || /[\[\]{}()^$|]/.test(value)
    || value.includes(".*")
    || value.includes(".+")
    || value.includes("\\");
}

function looksWildcardPattern(value) {
  return /[*?\[\]{}]/.test(value);
}

function extractSymbolCandidateFromPath(filePath) {
  const rawBase = stripKnownExtension(basename(filePath));
  if (!rawBase) return null;

  const normalizedBase = rawBase.toLowerCase();
  if (GENERIC_BASENAMES.has(normalizedBase)) return null;

  const compact = rawBase.replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length < 3) return null;

  if (/[A-Z]/.test(rawBase)) {
    return compact;
  }

  const parts = rawBase.split(/[-_.]+/).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 5 && parts.some((part) => SYMBOL_HINT_TOKENS.has(part.toLowerCase()))) {
    return toPascalCase(parts);
  }

  return null;
}

function extractSymbolCandidate(value) {
  if (!value) return null;

  const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!trimmed) return null;

  if (trimmed.includes("/") || /\.[a-z0-9]+$/i.test(trimmed)) {
    return extractSymbolCandidateFromPath(trimmed);
  }

  const segments = trimmed.split(".").filter(Boolean);
  const tail = segments[segments.length - 1] ?? trimmed;
  const compact = tail.replace(/[^a-zA-Z0-9_-]/g, "");
  if (compact.length < 3) return null;

  if (/[A-Z]/.test(compact)) {
    return compact.replace(/[^a-zA-Z0-9]/g, "");
  }

  const parts = compact.split(/[-_]+/).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 5 && parts.some((part) => SYMBOL_HINT_TOKENS.has(part.toLowerCase()))) {
    return toPascalCase(parts);
  }

  return null;
}

function looksExactSymbolLike(value) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || looksRegexLike(trimmed)) return false;

  const candidate = extractSymbolCandidate(trimmed);
  if (!candidate) return false;

  return /[A-Z]/.test(candidate)
    || /[_./-]/.test(trimmed)
    || [...SYMBOL_HINT_TOKENS].some((token) => candidate.toLowerCase().includes(token));
}

function formatSymbolSelector(symbol) {
  return symbol ? `symbol: "${symbol}"` : null;
}

function formatChunkSelector(chunkId) {
  return chunkId ? `chunk_id: "${chunkId}"` : null;
}

function formatKnownSelector(state, fallbackSymbol) {
  return formatChunkSelector(state.lastChunkId)
    ?? formatSymbolSelector(state.lastSymbol)
    ?? formatSymbolSelector(fallbackSymbol)
    ?? null;
}

function updateSelectorState(state, shortToolName, input) {
  if (shortToolName === "search") {
    const query = truncateText(getInputText(input));
    if (query) state.lastSearchQuery = query;
    return;
  }

  const symbol = truncateText(getInputSymbol(input));
  if (symbol) state.lastSymbol = symbol;

  if (shortToolName === "source") {
    const chunkId = truncateText(getInputChunkId(input));
    if (chunkId) state.lastChunkId = chunkId;
  }
}

export function shortName(toolName) {
  const mcpMatch = toolName.match(/^mcp__.*__(?:scrooge_)?(.+)$/);
  if (mcpMatch) return mcpMatch[1];

  const piScroogeMatch = toolName.match(/^pi:scrooge_(.+)$/);
  if (piScroogeMatch) return piScroogeMatch[1];

  const piMatch = toolName.match(/^pi:(.+)$/);
  if (piMatch) return piMatch[1].charAt(0).toUpperCase() + piMatch[1].slice(1);

  return toolName;
}

export function normalizeSessionId(value, fallback = "default") {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  return String(raw).slice(0, 100);
}

export function getToolInputPath(input) {
  if (!input || typeof input !== "object") return undefined;

  const record = input;
  const path = typeof record.path === "string"
    ? record.path
    : typeof record.file_path === "string"
      ? record.file_path
      : undefined;

  return path?.trim() ? path : undefined;
}

export function isCodePath(filePath) {
  const base = basename(filePath).toLowerCase();
  const lastDot = base.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = base.slice(lastDot + 1);
  return CODE_EXTENSIONS.has(ext);
}

function isOverrideApplicable(reasonCode, toolName, input) {
  const path = getToolInputPath(input);

  switch (reasonCode) {
    case "final_verification":
      return true;
    case "known_raw_content":
      return toolName === "Read" ? !!path : true;
    case "known_path_regex":
      return toolName === "Grep" && !!path;
    case "non_code_file":
      return !!path && !isCodePath(path);
    default:
      return false;
  }
}

export function getNativeExplorationReasonCode(
  toolName,
  input,
  overrideReason = normalizeNativeReasonCode(),
) {
  if (overrideReason && isOverrideApplicable(overrideReason, toolName, input)) {
    return overrideReason;
  }

  const path = getToolInputPath(input);
  const query = getInputText(input);

  if (toolName === "Read" && path && !isCodePath(path)) {
    return "non_code_file";
  }

  if (toolName === "Grep" && query && looksRegexLike(query) && path) {
    return "known_path_regex";
  }

  return undefined;
}

export function isScroogeExplorationTool(toolName) {
  return SCROOGE_EXPLORATION.test(toolName);
}

export function isNativeExplorationTool(toolName) {
  return NATIVE_EXPLORATION.test(toolName);
}

export function readSessionState(sessionId) {
  const statePath = getStatePath(sessionId);
  if (!existsSync(statePath)) {
    return createEmptyState();
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8"));
    return {
      nudgeCount: Number.isInteger(parsed.nudgeCount) ? parsed.nudgeCount : 0,
      lastScroogeTool: typeof parsed.lastScroogeTool === "string" ? parsed.lastScroogeTool : null,
      lastScroogeAt: typeof parsed.lastScroogeAt === "string" ? parsed.lastScroogeAt : null,
      lastNativeAt: typeof parsed.lastNativeAt === "string" ? parsed.lastNativeAt : null,
      lastSearchQuery: typeof parsed.lastSearchQuery === "string" ? parsed.lastSearchQuery : null,
      lastSymbol: typeof parsed.lastSymbol === "string" ? parsed.lastSymbol : null,
      lastChunkId: typeof parsed.lastChunkId === "string" ? parsed.lastChunkId : null,
    };
  } catch {
    return createEmptyState();
  }
}

export function writeSessionState(sessionId, state) {
  try {
    writeFileSync(getStatePath(sessionId), JSON.stringify(state));
  } catch {
    // Silent — hook should never block the agent
  }
}

export function updateSessionStateForTool(state, toolName, timestamp, input = undefined) {
  if (isScroogeExplorationTool(toolName)) {
    const tool = shortName(toolName);
    state.lastScroogeTool = tool;
    state.lastScroogeAt = timestamp;
    updateSelectorState(state, tool, input);
    return;
  }

  if (isNativeExplorationTool(toolName)) {
    state.lastNativeAt = timestamp;
  }
}

export function getGuidedBy(state, toolName, isCodeFile) {
  if (shortName(toolName) !== "Read" || !isCodeFile) return undefined;
  if (!state.lastScroogeTool || !state.lastScroogeAt) return undefined;
  if (state.lastNativeAt && state.lastNativeAt >= state.lastScroogeAt) return undefined;
  return state.lastScroogeTool;
}

function getObservedSelector(toolName, input) {
  const name = shortName(toolName);
  if (name !== "Grep" && name !== "Glob") return null;
  return truncateText(getInputText(input), 160);
}

export function buildObservedRecord(payload) {
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
  if (!toolName) return null;

  const repo = String(payload.cwd ?? "").slice(0, 500);
  const sid = normalizeSessionId(payload.session_id, repo || "default");
  const input = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
  const path = getToolInputPath(input);
  const isCodeFile = path ? isCodePath(path) : undefined;
  const state = readSessionState(sid);
  const timestamp = new Date().toISOString();
  const guidedBy = getGuidedBy(state, toolName, isCodeFile === true);
  const selector = getObservedSelector(toolName, input);
  const policyMode = normalizeGuardrailPolicy();
  const nativeReasonCode = isNativeExplorationTool(toolName)
    ? getNativeExplorationReasonCode(toolName, input)
    : undefined;

  const record = {
    t: timestamp,
    tool: String(toolName).slice(0, 200),
    repo,
    sid,
    ...(path ? { path: String(path).slice(0, 500) } : {}),
    ...(isCodeFile !== undefined ? { isCodeFile } : {}),
    ...(selector ? { selector } : {}),
    ...(Number.isInteger(input.offset) ? { offset: input.offset } : {}),
    ...(Number.isInteger(input.limit) ? { limit: input.limit } : {}),
    ...(guidedBy ? { guidedBy } : {}),
    ...(isNativeExplorationTool(toolName) ? { policyMode } : {}),
    ...(nativeReasonCode ? { reasonCode: nativeReasonCode } : {}),
  };

  updateSessionStateForTool(state, toolName, timestamp, input);
  writeSessionState(sid, state);

  return record;
}

function getReadNudge(guidedBy, state, filePath, input) {
  const symbolCandidate = extractSymbolCandidateFromPath(filePath);
  const selector = formatKnownSelector(state, symbolCandidate);
  const sliceHint = hasSliceRequest(input)
    ? " If you only need a narrow slice, use scrooge_source with before/after context instead of reopening the whole file."
    : "";

  switch (guidedBy) {
    case "search": {
      const queryHint = state.lastSearchQuery ? ` on query "${state.lastSearchQuery}"` : "";
      const exactCodeHint = selector
        ? `use scrooge_source with ${selector} for exact code`
        : "use the returned chunk ID with scrooge_source for exact code";
      return `Scrooge tip: this Read is following scrooge_search${queryHint}. Try scrooge_search again with tighter filters or ${exactCodeHint}. Use view: "implementation" before opening the full file, and reserve view: "raw" for full chunk source.${sliceHint}`;
    }
    case "lookup": {
      const selectorHint = selector
        ? ` Use scrooge_source with ${selector} for the exact implementation body`
        : " Use scrooge_source for the exact implementation body";
      return `Scrooge tip: this Read is following scrooge_lookup.${selectorHint} or scrooge_search with view: "implementation" for focused code details before reading the whole file.${sliceHint}`;
    }
    case "map":
      return "Scrooge tip: this Read is following scrooge_map. Use scrooge_search or scrooge_lookup next to target the exact symbol before opening the file.";
    case "deps": {
      const selectorHint = selector ? ` then scrooge_source with ${selector}` : " then scrooge_source";
      return `Scrooge tip: this Read is following scrooge_deps. Prefer scrooge_lookup${selectorHint} for exact code, or scrooge_search with view: "implementation" to inspect the implementation you need.`;
    }
    case "context":
      return "Scrooge tip: this Read is following scrooge_context. If you need a concrete implementation example, use scrooge_search with view: \"implementation\" before reading the full file.";
    case "source": {
      const selectorHint = selector ? ` Reuse scrooge_source with ${selector}` : " Reuse scrooge_source";
      return `Scrooge tip: this Read is following scrooge_source.${selectorHint} and before/after context instead of reopening the full file.`;
    }
    default:
      if (symbolCandidate) {
        return `Scrooge tip: do not use Read to discover code. This file path looks like a known symbol (${symbolCandidate}). Start with scrooge_lookup for that symbol; if you need exact code use scrooge_source with ${formatSymbolSelector(symbolCandidate)}. If you need nearby implementation context, prefer scrooge_search with view: "implementation" before opening the full file.${sliceHint}`;
      }

      return `Scrooge tip: do not use Read to discover code. Start with scrooge_lookup for exact symbols, scrooge_search for concepts, or scrooge_map for structure. If you already know the symbol or chunk, use scrooge_source for exact code. Otherwise prefer scrooge_search with view: "implementation" before opening the full file and reserve view: "raw" for exact chunk source.${sliceHint}`;
  }
}

function getGrepNudge(input) {
  const query = getInputText(input);
  const path = getToolInputPath(input);

  if (!query) {
    return "Scrooge tip: use scrooge_search for discovery and scrooge_lookup for exact symbols. Keep Grep for regex on a known file path.";
  }

  if (looksRegexLike(query) && path) {
    return null;
  }

  if (looksExactSymbolLike(query)) {
    const symbol = extractSymbolCandidate(query) ?? query.trim();
    return `Scrooge tip: this Grep looks like an exact symbol search (${symbol}). Use scrooge_lookup first. If you need the implementation body, use scrooge_source; if you need surrounding logic, use scrooge_search with view: "implementation".`;
  }

  if (/\s/.test(query.trim())) {
    return `Scrooge tip: this Grep looks like concept discovery (${query.trim()}). Use scrooge_search with view: "implementation" first, then scrooge_source once you know the symbol or chunk.`;
  }

  return "Scrooge tip: use scrooge_search for discovery and scrooge_lookup for exact symbols. Keep Grep for regex on a known file path.";
}

function getGlobNudge(input) {
  const pattern = getInputText(input) ?? getToolInputPath(input);
  if (!pattern) {
    return "Scrooge tip: use scrooge_map for repo structure and scrooge_search for discovery. Keep Glob for exact path patterns or non-indexed files.";
  }

  if (!looksWildcardPattern(pattern)) {
    return null;
  }

  const symbol = extractSymbolCandidate(pattern.replace(/[*?\[\]{}]/g, ""));
  if (symbol) {
    return `Scrooge tip: this Glob looks like you're chasing a known file or symbol (${symbol}). Try scrooge_lookup first; if you already know the implementation target, use scrooge_source instead of opening files by path.`;
  }

  return "Scrooge tip: this Glob looks like repo exploration. Use scrooge_map for structure and scrooge_search for discovery. Keep Glob for exact path patterns or non-indexed files.";
}

export function getGuardrailDecision(toolName, payload) {
  const sessionId = normalizeSessionId(payload.session_id, String(payload.cwd ?? "default"));
  const state = readSessionState(sessionId);
  const input = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
  const policy = normalizeGuardrailPolicy();
  if (policy === "off") return null;

  const overrideReason = normalizeNativeReasonCode();
  if (getNativeExplorationReasonCode(toolName, input, overrideReason)) {
    return null;
  }

  if (toolName === "Grep") {
    const message = getGrepNudge(input);
    if (!message) return null;
    if (policy === "strict") {
      return {
        sessionId,
        action: "block",
        message: `${message} Scrooge strict policy blocks blind native Grep on indexed repos; keep Grep for regex on a known path or approved exceptions.`,
        rateLimited: false,
      };
    }

    return { sessionId, action: "warn", message, rateLimited: true };
  }

  if (toolName === "Glob") {
    const message = getGlobNudge(input);
    if (!message) return null;
    if (policy === "strict") {
      return {
        sessionId,
        action: "block",
        message: `${message} Scrooge strict policy blocks broad native Glob on indexed repos; keep Glob for exact path patterns or approved exceptions.`,
        rateLimited: false,
      };
    }

    return { sessionId, action: "warn", message, rateLimited: true };
  }

  if (toolName === "Read") {
    const path = getToolInputPath(input);
    if (!path || !isCodePath(path)) return null;

    const guidedBy = getGuidedBy(state, toolName, true);
    const message = getReadNudge(guidedBy, state, path, input);

    if (policy === "strict" && !guidedBy) {
      return {
        sessionId,
        action: "block",
        message: `${message} Scrooge strict policy blocks blind code Read on indexed repos; keep native Read for non-code files, guided follow-up reads, or approved exceptions.`,
        rateLimited: false,
      };
    }

    return { sessionId, action: "warn", message, rateLimited: true };
  }

  return null;
}

export function getNudgeMessage(toolName, payload) {
  const decision = getGuardrailDecision(toolName, payload);
  if (!decision || decision.action !== "warn") return null;

  const state = readSessionState(decision.sessionId);
  if (decision.rateLimited && state.nudgeCount >= MAX_NUDGES) return null;

  return {
    sessionId: decision.sessionId,
    message: decision.message,
  };
}

export function recordNudge(sessionId) {
  const state = readSessionState(sessionId);
  state.nudgeCount += 1;
  writeSessionState(sessionId, state);
}
