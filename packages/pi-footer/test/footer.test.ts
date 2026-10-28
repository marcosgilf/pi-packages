import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { OPEN_SESSION_USAGE_EVENT, SESSION_USAGE_STATUS_KEY } from "@marcosgilf/pi-session/events";
import { COPILOT_USAGE_STATUS_KEY, OPEN_COPILOT_USAGE_EVENT } from "@marcosgilf/pi-usage/events";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

afterEach(() => vi.unstubAllEnvs());

describe("pi-footer", () => {
  it("positions session and usage around Pi's extension statuses responsively", async () => {
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
      const entries = [
        {
          type: "message",
          message: {
            role: "assistant",
            usage: {
              input: 192,
              output: 37_000,
              cacheRead: 7_700_000,
              cacheWrite: 173_000,
              cost: { total: 0.117 },
            },
          },
        },
      ];
      const mcpTools = [
        { namespace: { name: "mcp__chrome_devtools" }, exposure: "codemode" },
        { namespace: { name: "mcp__chrome_devtools" }, exposure: "codemode" },
        { namespace: { name: "mcp__disabled" }, exposure: "hidden" },
      ];
      const emit = vi.fn();
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
        events: { emit, on: vi.fn(() => vi.fn()) },
        getSettings: () => ({ compaction: { enabled: true } }),
        getAllTools: () => mcpTools,
        registerCommand,
        registerShortcut,
      } as unknown as ExtensionAPI;
      const ctx = {
        mode: "tui",
        cwd: "/repo",
        model: {
          id: "test-model",
          name: "Test model",
          reasoning: false,
          provider: "kimi-coding",
          contextWindow: 1_000_000,
        },
        thinkingLevel: "off",
        getContextUsage: () => ({ percent: 17.4, tokens: 174_000, contextWindow: 1_000_000 }),
        sessionManager: {
          getEntries: () => entries,
          getSessionId: () => "session",
          getLeafId: () => "leaf",
          getSessionName: () => "test-session",
        },
        ui: { setFooter, setStatus },
      } as unknown as ExtensionContext;
      const dispatch = async (event: string) => {
        for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
      };

      extension(pi);
      await dispatch("session_start");
      await vi.waitFor(() => expect(statuses.get(COPILOT_USAGE_STATUS_KEY)).toBe("Copilot Enterprise 25%"));
      statuses.set("caveman", "caveman level: FULL");
      statuses.set("skill-test", "skill: test");
      expect(setFooter).toHaveBeenCalledOnce();
      expect(statuses.get(SESSION_USAGE_STATUS_KEY)).toBe("17.4%/1.0M");
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

      const theme = {
        fg: (_style: string, text: string) => text,
      } as unknown as Theme;
      const tui = { requestRender: vi.fn() } as unknown as TUI;
      const footerData = {
        onBranchChange: () => vi.fn(),
        getAvailableProviderCount: () => 1,
        getExtensionStatuses: () => statuses,
        getGitBranch: () => "main",
      };
      const footerFactory = setFooter.mock.calls[0][0];
      const component = footerFactory(tui, theme, footerData);
      const wideLines = component.render(160);
      const wideStats = wideLines[1] ?? "";

      expect(wideLines).toHaveLength(2);
      expect(wideLines[0]).toContain("/repo (main) • test-session");
      expect(wideStats.startsWith("↑192 ↓37k R7.7M W173k CH")).toBe(true);
      expect(wideStats).toContain("$0.117 (sub) 17.4%/1.0M (auto)");
      expect(wideStats.indexOf("↑192")).toBeLessThan(wideStats.indexOf("🔌 MCP: 1 server enabled"));
      expect(wideStats.indexOf("🔌 MCP: 1 server enabled")).toBeLessThan(wideStats.indexOf("caveman level: FULL"));
      expect(wideStats.indexOf("Copilot Enterprise 25%")).toBeLessThan(wideStats.indexOf("test-model"));
      expect(wideStats.match(/17\.4%\/1\.0M/g)).toHaveLength(1);

      const mouse = (type: TuiMouseEvent["type"], x: number, y: number) =>
        ({ button: "left", type, x, y }) as TuiMouseEvent;
      const wideUsageX = visibleWidth(wideStats.slice(0, wideStats.indexOf("Copilot Enterprise")));
      component.handleMouse?.(mouse("click", 0, 1));
      component.handleMouse?.(mouse("click", wideUsageX, 1));

      const smallLines = component.render(80);
      expect(smallLines).toHaveLength(3);
      expect(smallLines[1]?.trimStart()).toMatch(/^Copilot Enterprise 25% · test-model/);
      expect(smallLines[2]).toContain("↑192 ↓37k R7.7M");
      expect(smallLines[2]).toContain("🔌 MCP: 1 serv");
      expect(smallLines[2]).toContain("...");
      expect(smallLines.every((line: string) => visibleWidth(line) <= 80)).toBe(true);
      const smallUsageX = visibleWidth(
        (smallLines[1] ?? "").slice(0, (smallLines[1] ?? "").indexOf("Copilot Enterprise")),
      );
      component.handleMouse?.(mouse("click", 0, 2));
      component.handleMouse?.(mouse("click", smallUsageX, 1));
      const tinyLines = component.render(24);
      expect(tinyLines).toHaveLength(3);
      expect(tinyLines.every((line: string) => visibleWidth(line) <= 24 && line.includes("..."))).toBe(true);

      expect(emit).toHaveBeenNthCalledWith(1, OPEN_SESSION_USAGE_EVENT, undefined);
      expect(emit).toHaveBeenNthCalledWith(2, OPEN_COPILOT_USAGE_EVENT, undefined);
      expect(emit).toHaveBeenNthCalledWith(3, OPEN_SESSION_USAGE_EVENT, undefined);
      expect(emit).toHaveBeenNthCalledWith(4, OPEN_COPILOT_USAGE_EVENT, undefined);

      mcpTools.push({ namespace: { name: "mcp__second" }, exposure: "direct" });
      expect(component.render(200)[1]).toContain("🔌 MCP: 2 servers enabled");
      component.dispose?.();
      await dispatch("session_shutdown");
      expect(statuses.has(SESSION_USAGE_STATUS_KEY)).toBe(false);
      expect(statuses.has(COPILOT_USAGE_STATUS_KEY)).toBe(false);
      expect(setFooter).toHaveBeenLastCalledWith(undefined);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
