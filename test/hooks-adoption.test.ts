import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const OBSERVE_PATH = join(__dirname, "..", "bin", "scrooge-observe.mjs");
const NUDGE_PATH = join(__dirname, "..", "bin", "scrooge-nudge.mjs");

let tempHome: string;
let dbPath: string;
let observedPath: string;

function runScript(scriptPath: string, input: unknown, env: Record<string, string> = {}): string {
  return execFileSync("node", [scriptPath], {
    input: JSON.stringify(input),
    encoding: "utf-8",
    timeout: 5000,
    env: { ...process.env, ...env },
  });
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "scrooge-hooks-test-"));
  dbPath = join(tempHome, ".scrooge", "scrooge.db");
  observedPath = join(tempHome, ".scrooge", "observed.jsonl");
  mkdirSync(dirname(dbPath), { recursive: true });
  writeFileSync(dbPath, "");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("Claude hooks adoption flow", () => {
  it("records guided code reads after a Scrooge search", () => {
    const env = { HOME: tempHome };
    const sessionId = `s-guided-${Date.now()}`;

    runScript(OBSERVE_PATH, {
      tool_name: "mcp__scrooge__scrooge_search",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { query: "login flow" },
    }, env);

    runScript(OBSERVE_PATH, {
      tool_name: "Read",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { path: "src/app.ts", offset: 5, limit: 20 },
    }, env);

    const lines = readFileSync(observedPath, "utf-8").trim().split("\n");
    const records = lines.map((line) => JSON.parse(line)) as Array<Record<string, unknown>>;

    expect(records).toHaveLength(2);
    expect(records[1].tool).toBe("Read");
    expect(records[1].path).toBe("src/app.ts");
    expect(records[1].isCodeFile).toBe(true);
    expect(records[1].offset).toBe(5);
    expect(records[1].limit).toBe(20);
    expect(records[1].guidedBy).toBe("search");
  });

  it("records grep selectors for bypass diagnostics", () => {
    const env = { HOME: tempHome };

    runScript(OBSERVE_PATH, {
      tool_name: "Grep",
      cwd: "/repo",
      session_id: `s-grep-observe-${Date.now()}`,
      tool_input: { pattern: "LoginViewModel" },
    }, env);

    const lines = readFileSync(observedPath, "utf-8").trim().split("\n");
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record.selector).toBe("LoginViewModel");
    expect(record.policyMode).toBe("warn");
  });

  it("records reason codes for allowed regex bypasses", () => {
    const env = { HOME: tempHome };

    runScript(OBSERVE_PATH, {
      tool_name: "Grep",
      cwd: "/repo",
      session_id: `s-grep-regex-observe-${Date.now()}`,
      tool_input: { pattern: "^const\\s+[A-Z_]+", path: "src/app.ts" },
    }, env);

    const lines = readFileSync(observedPath, "utf-8").trim().split("\n");
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record.reasonCode).toBe("known_path_regex");
  });

  it("nudges blind reads to use Scrooge first", () => {
    const sessionId = `s-blind-${Date.now()}`;
    const result = runScript(NUDGE_PATH, {
      tool_name: "Read",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { path: "src/app.ts" },
    }, {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
    });

    const payload = JSON.parse(result) as { additionalContext?: string };
    expect(payload.additionalContext).toContain("do not use Read to discover code");
    expect(payload.additionalContext).toContain('view: "implementation"');
  });

  it("blocks blind reads in strict mode", () => {
    const sessionId = `s-strict-blind-${Date.now()}`;
    const result = runScript(NUDGE_PATH, {
      tool_name: "Read",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { path: "src/app.ts" },
    }, {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
      SCROOGE_NATIVE_EXPLORATION_POLICY: "strict",
    });

    const payload = JSON.parse(result) as {
      continue?: boolean;
      stopReason?: string;
      hookSpecificOutput?: { permissionDecision?: string };
    };
    expect(payload.continue).toBe(false);
    expect(payload.stopReason).toContain("strict policy blocks blind code Read");
    expect(payload.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("disables warnings in off mode", () => {
    const sessionId = `s-off-blind-${Date.now()}`;
    const result = runScript(NUDGE_PATH, {
      tool_name: "Read",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { path: "src/app.ts" },
    }, {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
      SCROOGE_NATIVE_EXPLORATION_POLICY: "off",
    });

    expect(result.trim()).toBe("{}");
  });

  it("treats sql files as code for blind read nudges", () => {
    const sessionId = `s-blind-sql-${Date.now()}`;
    const result = runScript(NUDGE_PATH, {
      tool_name: "Read",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { path: "db/schema.sql" },
    }, {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
    });

    const payload = JSON.parse(result) as { additionalContext?: string };
    expect(payload.additionalContext).toContain("do not use Read to discover code");
  });

  it("nudges guided reads differently after search", () => {
    const env = { HOME: tempHome, SCROOGE_DB_PATH: dbPath };
    const sessionId = `s-after-search-${Date.now()}`;

    runScript(OBSERVE_PATH, {
      tool_name: "mcp__scrooge__scrooge_search",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { query: "login" },
    }, env);

    const result = runScript(NUDGE_PATH, {
      tool_name: "Read",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { file_path: "src/app.ts" },
    }, env);

    const payload = JSON.parse(result) as { additionalContext?: string };
    expect(payload.additionalContext).toContain("following scrooge_search");
    expect(payload.additionalContext).toContain('view: "implementation"');
  });

  it("keeps guided reads as warnings in strict mode", () => {
    const env = {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
      SCROOGE_NATIVE_EXPLORATION_POLICY: "strict",
    };
    const sessionId = `s-strict-guided-${Date.now()}`;

    runScript(OBSERVE_PATH, {
      tool_name: "mcp__scrooge__scrooge_lookup",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { symbol: "LoginViewModel" },
    }, env);

    const result = runScript(NUDGE_PATH, {
      tool_name: "Read",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { file_path: "src/app.ts" },
    }, env);

    const payload = JSON.parse(result) as { additionalContext?: string };
    expect(payload.additionalContext).toContain("following scrooge_lookup");
  });

  it("nudges symbol-like blind reads toward lookup and source", () => {
    const sessionId = `s-symbol-read-${Date.now()}`;
    const result = runScript(NUDGE_PATH, {
      tool_name: "Read",
      cwd: "/repo",
      session_id: sessionId,
      tool_input: { path: "src/LoginViewModel.kt" },
    }, {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
    });

    const payload = JSON.parse(result) as { additionalContext?: string };
    expect(payload.additionalContext).toContain("known symbol (LoginViewModel)");
    expect(payload.additionalContext).toContain("scrooge_lookup");
    expect(payload.additionalContext).toContain("scrooge_source");
  });

  it("routes grep for exact symbols to lookup and source", () => {
    const result = runScript(NUDGE_PATH, {
      tool_name: "Grep",
      cwd: "/repo",
      session_id: `s-grep-symbol-${Date.now()}`,
      tool_input: { pattern: "LoginViewModel" },
    }, {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
    });

    const payload = JSON.parse(result) as { additionalContext?: string };
    expect(payload.additionalContext).toContain("exact symbol search");
    expect(payload.additionalContext).toContain("scrooge_lookup");
    expect(payload.additionalContext).toContain("scrooge_source");
  });

  it("skips grep nudges for regex on a known path", () => {
    const result = runScript(NUDGE_PATH, {
      tool_name: "Grep",
      cwd: "/repo",
      session_id: `s-grep-regex-${Date.now()}`,
      tool_input: { pattern: "^const\\s+[A-Z_]+", path: "src/app.ts" },
    }, {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
    });

    expect(result.trim()).toBe("{}");
  });

  it("routes broad globs to map and search", () => {
    const result = runScript(NUDGE_PATH, {
      tool_name: "Glob",
      cwd: "/repo",
      session_id: `s-glob-broad-${Date.now()}`,
      tool_input: { pattern: "src/**/*.ts" },
    }, {
      HOME: tempHome,
      SCROOGE_DB_PATH: dbPath,
    });

    const payload = JSON.parse(result) as { additionalContext?: string };
    expect(payload.additionalContext).toContain("repo exploration");
    expect(payload.additionalContext).toContain("scrooge_map");
    expect(payload.additionalContext).toContain("scrooge_search");
  });
});
