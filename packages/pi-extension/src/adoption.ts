export type GuardrailPolicy = "off" | "warn" | "strict";

export type NativeReasonCode =
  | "known_raw_content"
  | "known_path_regex"
  | "non_code_file"
  | "final_verification";

export interface SessionState {
  nudgeCount: number;
  lastScroogeTool: string | null;
  lastScroogeAt: string | null;
  lastNativeAt: string | null;
  lastSearchQuery: string | null;
  lastSymbol: string | null;
  lastChunkId: string | null;
}

export interface PiObservedRecord {
  t: string;
  tool: string;
  repo: string;
  sid: string;
  path?: string;
  isCodeFile?: boolean;
  selector?: string;
  offset?: number;
  limit?: number;
  guidedBy?: string;
  policyMode?: GuardrailPolicy;
  reasonCode?: NativeReasonCode;
}

export interface GuardrailDecision {
  action: "warn" | "block";
  message: string;
  rateLimited: boolean;
}

export const MAX_NUDGES = 3;

const CODE_EXTENSIONS = new Set(["kt", "ts", "tsx", "js", "jsx", "dart", "py", "rb", "go", "rs", "java", "sql"]);
const SCROOGE_EXPLORATION = new Set(["search", "lookup", "map", "context", "deps", "source"]);
const NATIVE_EXPLORATION = new Set(["read", "grep", "glob"]);
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

export function createSessionState(): SessionState {
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

export function normalizeGuardrailPolicy(value?: string): GuardrailPolicy {
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

export function normalizeNativeReasonCode(value?: string): NativeReasonCode | null {
  switch (value?.trim().toLowerCase()) {
    case "known_raw_content":
    case "known_path_regex":
    case "non_code_file":
    case "final_verification":
      return value.trim().toLowerCase() as NativeReasonCode;
    default:
      return null;
  }
}

function truncateText(value: string | undefined, max: number = 200): string | null {
  return value?.trim() ? value.trim().slice(0, max) : null;
}

function stripKnownExtension(fileName: string): string {
  if (/\.d\.[^.]+$/i.test(fileName)) return fileName.replace(/\.d\.[^.]+$/i, "");
  return fileName.replace(/\.[^.]+$/i, "");
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

function toPascalCase(parts: string[]): string {
  return parts.map(capitalize).join("");
}

function getStringField(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function getInputText(input: Record<string, unknown> | undefined): string | undefined {
  return getStringField(input, ["query", "pattern", "search", "regex", "glob", "value", "text"]);
}

function getInputSymbol(input: Record<string, unknown> | undefined): string | undefined {
  return getStringField(input, ["symbol", "symbol_name"]);
}

function getInputChunkId(input: Record<string, unknown> | undefined): string | undefined {
  return getStringField(input, ["chunk_id", "chunkId", "id"]);
}

function hasSliceRequest(input: Record<string, unknown> | undefined): boolean {
  return Number.isInteger(input?.offset) || Number.isInteger(input?.limit);
}

function looksRegexLike(value: string): boolean {
  return /\\[bBdDsSwW]/.test(value)
    || /[\[\]{}()^$|]/.test(value)
    || value.includes(".*")
    || value.includes(".+")
    || value.includes("\\");
}

function looksWildcardPattern(value: string): boolean {
  return /[*?\[\]{}]/.test(value);
}

function extractSymbolCandidateFromPath(filePath: string): string | null {
  const rawBase = stripKnownExtension(filePath.split("/").pop() ?? filePath);
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

function extractSymbolCandidate(value: string): string | null {
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

function looksExactSymbolLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || looksRegexLike(trimmed)) return false;

  const candidate = extractSymbolCandidate(trimmed);
  if (!candidate) return false;

  return /[A-Z]/.test(candidate)
    || /[_./-]/.test(trimmed)
    || [...SYMBOL_HINT_TOKENS].some((token) => candidate.toLowerCase().includes(token));
}

function formatSymbolSelector(symbol: string | null): string | null {
  return symbol ? `symbol: "${symbol}"` : null;
}

function formatChunkSelector(chunkId: string | null): string | null {
  return chunkId ? `chunk_id: "${chunkId}"` : null;
}

function formatKnownSelector(state: SessionState, fallbackSymbol: string | null): string | null {
  return formatChunkSelector(state.lastChunkId)
    ?? formatSymbolSelector(state.lastSymbol)
    ?? formatSymbolSelector(fallbackSymbol)
    ?? null;
}

export function getToolInputPath(input?: Record<string, unknown>): string | undefined {
  const path = typeof input?.path === "string"
    ? input.path
    : typeof input?.file_path === "string"
      ? input.file_path
      : undefined;

  return path?.trim() ? path : undefined;
}

export function isCodePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  const ext = normalized.split(".").pop();
  return !!ext && CODE_EXTENSIONS.has(ext);
}

function isOverrideApplicable(
  reasonCode: NativeReasonCode,
  toolName: string,
  input: Record<string, unknown> | undefined,
): boolean {
  const path = getToolInputPath(input);

  switch (reasonCode) {
    case "final_verification":
      return true;
    case "known_raw_content":
      return toolName === "read" ? !!path : true;
    case "known_path_regex":
      return toolName === "grep" && !!path;
    case "non_code_file":
      return !!path && !isCodePath(path);
  }
}

export function getNativeExplorationReasonCode(
  toolName: string,
  input: Record<string, unknown> | undefined,
  overrideReason: NativeReasonCode | null = normalizeNativeReasonCode(
    process.env.SCROOGE_NATIVE_EXPLORATION_OVERRIDE_REASON,
  ),
): NativeReasonCode | undefined {
  if (overrideReason && isOverrideApplicable(overrideReason, toolName, input)) {
    return overrideReason;
  }

  const path = getToolInputPath(input);
  const query = getInputText(input);

  if (toolName === "read" && path && !isCodePath(path)) {
    return "non_code_file";
  }

  if (toolName === "grep" && query && looksRegexLike(query) && path) {
    return "known_path_regex";
  }

  return undefined;
}

export function toObservedToolName(toolName: string): string {
  return `pi:${toolName}`;
}

function shortName(observedToolName: string): string {
  const piScroogeMatch = observedToolName.match(/^pi:scrooge_(.+)$/);
  if (piScroogeMatch) return piScroogeMatch[1];

  const piMatch = observedToolName.match(/^pi:(.+)$/);
  if (piMatch) return piMatch[1].charAt(0).toUpperCase() + piMatch[1].slice(1);

  return observedToolName;
}

function isScroogeExplorationTool(observedToolName: string): boolean {
  const name = shortName(observedToolName);
  return SCROOGE_EXPLORATION.has(name);
}

function isNativeExplorationTool(observedToolName: string): boolean {
  const name = observedToolName.replace(/^pi:/, "");
  return NATIVE_EXPLORATION.has(name);
}

function getGuidedBy(state: SessionState, observedToolName: string, isCodeFile: boolean): string | undefined {
  if (shortName(observedToolName) !== "Read" || !isCodeFile) return undefined;
  if (!state.lastScroogeTool || !state.lastScroogeAt) return undefined;
  if (state.lastNativeAt && state.lastNativeAt >= state.lastScroogeAt) return undefined;
  return state.lastScroogeTool;
}

function updateSelectorState(state: SessionState, shortToolName: string, input: Record<string, unknown> | undefined): void {
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

function updateSessionStateForTool(
  state: SessionState,
  observedToolName: string,
  timestamp: string,
  input: Record<string, unknown> | undefined,
): void {
  if (isScroogeExplorationTool(observedToolName)) {
    const name = shortName(observedToolName);
    state.lastScroogeTool = name;
    state.lastScroogeAt = timestamp;
    updateSelectorState(state, name, input);
    return;
  }

  if (isNativeExplorationTool(observedToolName)) {
    state.lastNativeAt = timestamp;
  }
}

function getObservedSelector(
  observedToolName: string,
  input: Record<string, unknown> | undefined,
): string | null {
  const name = shortName(observedToolName);
  if (name !== "Grep" && name !== "Glob") return null;
  return truncateText(getInputText(input), 160);
}

export function buildObservedRecord(
  toolName: string,
  repo: string,
  sid: string,
  input: Record<string, unknown> | undefined,
  state: SessionState,
): PiObservedRecord {
  const observedToolName = toObservedToolName(toolName);
  const timestamp = new Date().toISOString();
  const path = getToolInputPath(input);
  const isCodeFile = path ? isCodePath(path) : undefined;
  const guidedBy = getGuidedBy(state, observedToolName, isCodeFile === true);
  const selector = getObservedSelector(observedToolName, input);
  const policyMode = normalizeGuardrailPolicy(process.env.SCROOGE_NATIVE_EXPLORATION_POLICY);
  const nativeReasonCode = isNativeExplorationTool(observedToolName)
    ? getNativeExplorationReasonCode(toolName, input)
    : undefined;

  const record: PiObservedRecord = {
    t: timestamp,
    tool: observedToolName,
    repo,
    sid,
    ...(path ? { path: path.slice(0, 500) } : {}),
    ...(isCodeFile !== undefined ? { isCodeFile } : {}),
    ...(selector ? { selector } : {}),
    ...(typeof input?.offset === "number" ? { offset: input.offset } : {}),
    ...(typeof input?.limit === "number" ? { limit: input.limit } : {}),
    ...(guidedBy ? { guidedBy } : {}),
    ...(isNativeExplorationTool(observedToolName) ? { policyMode } : {}),
    ...(nativeReasonCode ? { reasonCode: nativeReasonCode } : {}),
  };

  updateSessionStateForTool(state, observedToolName, timestamp, input);
  return record;
}

function getReadNudge(
  guidedBy: string | undefined,
  state: SessionState,
  filePath: string,
  input: Record<string, unknown> | undefined,
): string {
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

function getGrepNudge(input: Record<string, unknown> | undefined): string | null {
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

function getGlobNudge(input: Record<string, unknown> | undefined): string | null {
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

export function getGuardrailDecision(
  toolName: string,
  input: Record<string, unknown> | undefined,
  state: SessionState,
  options: {
    policy?: GuardrailPolicy;
    overrideReason?: NativeReasonCode | null;
  } = {},
): GuardrailDecision | null {
  const policy = options.policy ?? normalizeGuardrailPolicy(process.env.SCROOGE_NATIVE_EXPLORATION_POLICY);
  if (policy === "off") return null;

  const overrideReason = options.overrideReason ?? normalizeNativeReasonCode(
    process.env.SCROOGE_NATIVE_EXPLORATION_OVERRIDE_REASON,
  );
  if (getNativeExplorationReasonCode(toolName, input, overrideReason)) {
    return null;
  }

  if (toolName === "grep") {
    const message = getGrepNudge(input);
    if (!message) return null;
    if (policy === "strict") {
      return {
        action: "block",
        message: `${message} Scrooge strict policy blocks blind native Grep on indexed repos; keep Grep for regex on a known path or approved exceptions.`,
        rateLimited: false,
      };
    }
    return { action: "warn", message, rateLimited: true };
  }

  if (toolName === "glob") {
    const message = getGlobNudge(input);
    if (!message) return null;
    if (policy === "strict") {
      return {
        action: "block",
        message: `${message} Scrooge strict policy blocks broad native Glob on indexed repos; keep Glob for exact path patterns or approved exceptions.`,
        rateLimited: false,
      };
    }
    return { action: "warn", message, rateLimited: true };
  }

  if (toolName === "read") {
    const path = getToolInputPath(input);
    if (!path || !isCodePath(path)) return null;

    const guidedBy = getGuidedBy(state, toObservedToolName(toolName), true);
    const message = getReadNudge(guidedBy, state, path, input);

    if (policy === "strict" && !guidedBy) {
      return {
        action: "block",
        message: `${message} Scrooge strict policy blocks blind code Read on indexed repos; keep native Read for non-code files, guided follow-up reads, or approved exceptions.`,
        rateLimited: false,
      };
    }

    return { action: "warn", message, rateLimited: true };
  }

  return null;
}

export function getNudgeMessage(
  toolName: string,
  input: Record<string, unknown> | undefined,
  state: SessionState,
): string | null {
  const decision = getGuardrailDecision(toolName, input, state, { policy: "warn", overrideReason: null });
  return decision?.action === "warn" && state.nudgeCount < MAX_NUDGES ? decision.message : null;
}
