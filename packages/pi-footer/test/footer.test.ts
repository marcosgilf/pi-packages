import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SESSION_USAGE_STATUS_KEY } from "@marcosgilf/pi-session/events";
import { COPILOT_USAGE_STATUS_KEY } from "@marcosgilf/pi-usage/events";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

afterEach(() => vi.unstubAllEnvs());

describe("pi-footer", () => {
  it("keeps Pi's default footer and publishes feature and MCP statuses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-footer-test-"));
    try {
      const gh = join(directory, "gh");
      await writeFile(
        gh,
        `#!/bin/sh\nprintf '%s\\n' '{"copilot_plan":"enterprise","quota_snapshots":{"premium_interactions":{"percent_remaining":75,"credits_used":5000,"entitlement":20000,"quota_remaining":15000,"has_quota":true}}}'\n`,
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);

      const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
      const statuses = new Map<string, string>();
      const mcpTools = [
        { namespace: { name: "mcp__chrome_devtools" }, exposure: "codemode" },
        { namespace: { name: "mcp__chrome_devtools" }, exposure: "codemode" },
        { namespace: { name: "mcp__disabled" }, exposure: "hidden" },
      ];
      const setFooter = vi.fn();
      const registerCommand = vi.fn();
      const registerShortcut = vi.fn();
      const setStatus = vi.fn((key: string, text: string | undefined) => {
        if (text === undefined) statuses.delete(key);
        else statuses.set(key, text);
      });
      const pi = {
        on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
          const subscribers = handlers.get(event) ?? [];
          subscribers.push(handler);
          handlers.set(event, subscribers);
          return vi.fn();
        },
        events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
        getSettings: () => ({ compaction: { enabled: true } }),
        getAllTools: () => mcpTools,
        registerCommand,
        registerShortcut,
      } as unknown as ExtensionAPI;
      const ctx = {
        mode: "tui",
        getContextUsage: () => ({ percent: 50, tokens: 1000, contextWindow: 2000 }),
        model: { id: "test-model", contextWindow: 2000 },
        ui: { setFooter, setStatus },
      } as unknown as ExtensionContext;
      const dispatch = async (event: string) => {
        for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
      };

      extension(pi);
      await dispatch("session_start");
      await vi.waitFor(() => expect(statuses.get(COPILOT_USAGE_STATUS_KEY)).toBe("Copilot Enterprise 25%"));

      expect(setFooter).not.toHaveBeenCalled();
      expect(statuses.get(SESSION_USAGE_STATUS_KEY)).toBe("50.0%/2.0k");
      expect(statuses.get("pi-footer:mcp")).toBe("🔌 MCP: 1 server enabled");
      expect(registerCommand).toHaveBeenCalledWith(
        "session-usage",
        expect.objectContaining({ description: "Show session token, cost, and context usage" }),
      );
      expect(registerCommand).toHaveBeenCalledWith(
        "copilot-usage",
        expect.objectContaining({ description: "Show GitHub Copilot plan and quota usage" }),
      );
      expect(registerShortcut).toHaveBeenCalledWith("super+shift+s", expect.any(Object));
      expect(registerShortcut).toHaveBeenCalledWith("super+shift+u", expect.any(Object));

      mcpTools.push({ namespace: { name: "mcp__second" }, exposure: "direct" });
      await dispatch("tool_execution_end");
      expect(statuses.get("pi-footer:mcp")).toBe("🔌 MCP: 2 servers enabled");

      await dispatch("session_shutdown");
      expect(setFooter).not.toHaveBeenCalled();
      expect(statuses.has(SESSION_USAGE_STATUS_KEY)).toBe(false);
      expect(statuses.has(COPILOT_USAGE_STATUS_KEY)).toBe(false);
      expect(statuses.has("pi-footer:mcp")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
