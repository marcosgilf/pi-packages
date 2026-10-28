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
  it("composes standalone statuses, adapts to width, and preserves selection", async () => {
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
        model: { id: "test-model", name: "Test model", reasoning: false, provider: "test", contextWindow: 2000 },
        thinkingLevel: "off",
        getContextUsage: () => ({ percent: 50, tokens: 1000, contextWindow: 2000 }),
        sessionManager: { getSessionName: () => undefined },
        ui: { setFooter, setStatus },
      } as unknown as ExtensionContext;
      const dispatch = async (event: string) => {
        for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
      };

      extension(pi);
      await dispatch("session_start");
      await vi.waitFor(() => expect(statuses.get(COPILOT_USAGE_STATUS_KEY)).toBe("Copilot Enterprise 25%"));
      expect(statuses.get(SESSION_USAGE_STATUS_KEY)).toBe("50.0%/2.0k");
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
      expect(setFooter).toHaveBeenCalledOnce();

      statuses.set("caveman", "⠠⠄ caveman level: FULL");
      statuses.set("ponytail", "○ 🐴 ponytail: ⚡ FULL");
      const theme = {
        fg: (_style: string, text: string) => text,
        bg: (_style: string, text: string) => text,
        bold: (text: string) => text,
      } as unknown as Theme;
      const tui = { requestRender: vi.fn() } as unknown as TUI;
      const footerData = {
        onBranchChange: () => vi.fn(),
        getAvailableProviderCount: () => 1,
        getExtensionStatuses: () => statuses,
        getGitBranch: () => undefined,
      };
      const footerFactory = setFooter.mock.calls[0][0];
      const component = footerFactory(tui, theme, footerData);
      const wideLines = component.render(160);
      const wideStats = wideLines[1];
      const contextX = visibleWidth(wideStats.slice(0, wideStats.indexOf("50.0%/2.0k")));
      const usageX = visibleWidth(wideStats.slice(0, wideStats.indexOf("Copilot Enterprise")));

      expect(wideLines).toHaveLength(2);
      expect(wideLines[0]).toContain("/repo");
      expect(wideStats).toContain("🔌 MCP: 1 server enabled");
      expect(wideStats.indexOf("50.0%/2.0k")).toBeLessThan(wideStats.indexOf("🔌 MCP"));
      expect(wideStats.indexOf("🔌 MCP")).toBeLessThan(wideStats.indexOf("caveman level: FULL"));
      expect(wideStats.indexOf("ponytail: ⚡ FULL")).toBeLessThan(usageX);

      const mouse = (type: TuiMouseEvent["type"], x: number, y: number) =>
        ({ button: "left", type, x, y }) as TuiMouseEvent;
      expect(component.handleMouse?.(mouse("press", contextX, 1))).toBeUndefined();
      expect(component.handleMouse?.(mouse("release", contextX + 2, 1))).toBeUndefined();
      component.handleMouse?.(mouse("click", contextX, 1));
      component.handleMouse?.(mouse("click", usageX, 1));

      const smallLines = component.render(80);
      expect(smallLines).toHaveLength(3);
      expect(smallLines[1]?.trimStart()).toMatch(/^Copilot Enterprise/);
      expect(smallLines[2]).toContain("50.0%/2.0k ·");
      expect(smallLines[2]).toContain("🔌 MCP: 1 server enabled");
      component.handleMouse?.(mouse("click", 0, 2));
      component.handleMouse?.(mouse("click", 0, 1));

      expect(emit).toHaveBeenNthCalledWith(1, OPEN_SESSION_USAGE_EVENT, undefined);
      expect(emit).toHaveBeenNthCalledWith(2, OPEN_COPILOT_USAGE_EVENT, undefined);
      expect(emit).toHaveBeenNthCalledWith(3, OPEN_SESSION_USAGE_EVENT, undefined);
      expect(emit).toHaveBeenNthCalledWith(4, OPEN_COPILOT_USAGE_EVENT, undefined);
      mcpTools.push({ namespace: { name: "mcp__second" }, exposure: "direct" });
      expect(component.render(160).join("\n")).toContain("🔌 MCP: 2 servers enabled");
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
