import { describe, it, expect } from "vitest";
import {
  buildObservedRecord,
  createSessionState,
  getGuardrailDecision,
  getNudgeMessage,
} from "../packages/pi-extension/src/adoption.ts";

describe("pi adoption helpers", () => {
  it("records guided code reads after a Scrooge search", () => {
    const state = createSessionState();

    const searchRecord = buildObservedRecord(
      "scrooge_search",
      "/repo",
      "session-1",
      { query: "login flow" },
      state,
    );
    const readRecord = buildObservedRecord(
      "read",
      "/repo",
      "session-1",
      { path: "src/app.ts", offset: 3, limit: 15 },
      state,
    );

    expect(searchRecord.tool).toBe("pi:scrooge_search");
    expect(readRecord.tool).toBe("pi:read");
    expect(readRecord.path).toBe("src/app.ts");
    expect(readRecord.isCodeFile).toBe(true);
    expect(readRecord.offset).toBe(3);
    expect(readRecord.limit).toBe(15);
    expect(readRecord.guidedBy).toBe("search");
  });

  it("records native bypass selectors for grep", () => {
    const state = createSessionState();
    const record = buildObservedRecord("grep", "/repo", "session-grep", { pattern: "LoginViewModel" }, state);

    expect(record.selector).toBe("LoginViewModel");
    expect(record.policyMode).toBe("warn");
  });

  it("records reason codes for allowed native bypasses", () => {
    const state = createSessionState();
    const record = buildObservedRecord(
      "grep",
      "/repo",
      "session-grep-regex",
      { pattern: "^const\\s+[A-Z_]+", path: "src/app.ts" },
      state,
    );

    expect(record.reasonCode).toBe("known_path_regex");
  });

  it("nudges blind and guided reads differently", () => {
    const blindState = createSessionState();
    const blindMessage = getNudgeMessage("read", { path: "src/app.ts" }, blindState);
    expect(blindMessage).toContain("do not use Read to discover code");

    const sqlBlindMessage = getNudgeMessage("read", { path: "db/schema.sql" }, createSessionState());
    expect(sqlBlindMessage).toContain("do not use Read to discover code");

    const guidedState = createSessionState();
    buildObservedRecord("scrooge_lookup", "/repo", "session-2", { symbol: "LoginViewModel" }, guidedState);
    const guidedMessage = getNudgeMessage("read", { file_path: "src/app.ts" }, guidedState);
    expect(guidedMessage).toContain("following scrooge_lookup");
    expect(guidedMessage).toContain('symbol: "LoginViewModel"');
    expect(guidedMessage).toContain('view: "implementation"');
  });

  it("routes symbol-like reads and greps to lookup/source", () => {
    const readState = createSessionState();
    const readMessage = getNudgeMessage("read", { path: "src/LoginViewModel.kt" }, readState);
    expect(readMessage).toContain("known symbol (LoginViewModel)");
    expect(readMessage).toContain("scrooge_lookup");
    expect(readMessage).toContain("scrooge_source");

    const grepState = createSessionState();
    const grepMessage = getNudgeMessage("grep", { pattern: "LoginViewModel" }, grepState);
    expect(grepMessage).toContain("exact symbol search");
    expect(grepMessage).toContain("scrooge_lookup");
    expect(grepMessage).toContain("scrooge_source");
  });

  it("supports off/warn/strict guardrail modes", () => {
    const state = createSessionState();
    expect(getGuardrailDecision("read", { path: "src/app.ts" }, state, { policy: "off" })).toBeNull();

    const warnDecision = getGuardrailDecision("read", { path: "src/app.ts" }, state, { policy: "warn" });
    expect(warnDecision?.action).toBe("warn");

    const strictDecision = getGuardrailDecision("read", { path: "src/app.ts" }, state, { policy: "strict" });
    expect(strictDecision?.action).toBe("block");
    expect(strictDecision?.message).toContain("strict policy blocks blind code Read");
  });

  it("keeps guided reads as warnings even in strict mode", () => {
    const state = createSessionState();
    buildObservedRecord("scrooge_lookup", "/repo", "session-guided", { symbol: "LoginViewModel" }, state);

    const decision = getGuardrailDecision("read", { path: "src/app.ts" }, state, { policy: "strict" });
    expect(decision?.action).toBe("warn");
    expect(decision?.message).toContain("following scrooge_lookup");
  });

  it("skips regex grep nudges on known paths", () => {
    const state = createSessionState();
    const message = getNudgeMessage("grep", { pattern: "^const\\s+[A-Z_]+", path: "src/app.ts" }, state);
    expect(message).toBeNull();
  });

  it("routes broad globs to map and search", () => {
    const state = createSessionState();
    const message = getNudgeMessage("glob", { pattern: "src/**/*.ts" }, state);
    expect(message).toContain("repo exploration");
    expect(message).toContain("scrooge_map");
    expect(message).toContain("scrooge_search");
  });
});
