import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

describe("pi-session extension", () => {
  it("registers the session command and Command+Shift+S shortcut", () => {
    const registerCommand = vi.fn();
    const registerShortcut = vi.fn();
    const pi = {
      on: vi.fn((_event: string, _handler: (event: unknown, ctx: ExtensionContext) => void) => vi.fn()),
      events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
      registerCommand,
      registerShortcut,
    } as unknown as ExtensionAPI;

    extension(pi);

    expect(registerCommand).toHaveBeenCalledWith(
      "session-usage",
      expect.objectContaining({ description: "Show session token, cost, and context usage" }),
    );
    expect(registerShortcut).toHaveBeenCalledWith(
      "super+shift+s",
      expect.objectContaining({ description: "Show session token, cost, and context usage" }),
    );
  });

  it("publishes context status in isolation and clears it on shutdown", () => {
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
    const setStatus = vi.fn();
    const pi = {
      on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
        handlers.set(event, handler);
        return vi.fn();
      },
      events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      getSettings: () => ({ compaction: { enabled: true } }),
    } as unknown as ExtensionAPI;
    const ctx = {
      mode: "tui",
      model: { contextWindow: 1_000_000 },
      getContextUsage: () => ({ percent: 19.4, tokens: 194_000, contextWindow: 1_000_000 }),
      ui: { setStatus },
    } as unknown as ExtensionContext;

    extension(pi);
    handlers.get("session_start")?.({}, ctx);
    expect(setStatus).toHaveBeenLastCalledWith("pi-session", "19.4%/1.0M");

    const navigatedContext = {
      ...ctx,
      getContextUsage: () => ({ percent: 10, tokens: 100_000, contextWindow: 1_000_000 }),
    } as ExtensionContext;
    handlers.get("session_tree")?.({}, navigatedContext);
    expect(setStatus).toHaveBeenLastCalledWith("pi-session", "10.0%/1.0M");

    handlers.get("session_shutdown")?.({}, navigatedContext);
    expect(setStatus).toHaveBeenLastCalledWith("pi-session", undefined);
  });
});
