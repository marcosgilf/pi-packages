import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { OPEN_SESSION_USAGE_EVENT, SESSION_USAGE_STATUS_KEY } from "@marcosgilf/pi-session/events";
import {
  COPILOT_USAGE_STATUS_KEY,
  OPEN_COPILOT_USAGE_EVENT,
  OPEN_OPENAI_USAGE_EVENT,
  OPEN_OPENROUTER_USAGE_EVENT,
  OPENAI_USAGE_STATUS_KEY,
  OPENROUTER_USAGE_STATUS_KEY,
} from "@marcosgilf/pi-usage/events";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pi-footer", () => {
  it("shows active OpenAI provider status, model, and thinking state with clickable labels", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

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
      model: {
        id: "gpt-6-luna",
        name: "GPT-6 Luna",
        reasoning: true,
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        contextWindow: 1_000_000,
      },
      thinkingLevel: "xhigh",
      modelRegistry: { hasConfiguredAuth: () => true, isUsingOAuth: () => true },
      getContextUsage: () => ({ percent: 17.4, tokens: 174_000, contextWindow: 1_000_000 }),
      sessionManager: { getSessionName: () => "test-session" },
      ui: { setFooter, setStatus, notify: vi.fn() },
    } as unknown as ExtensionContext;
    const dispatch = async (event: string) => {
      for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
    };

    extension(pi);
    await dispatch("session_start");
    await vi.waitFor(() => expect(statuses.get(OPENAI_USAGE_STATUS_KEY)).toBe("OpenAI ChatGPT"));
    statuses.set("caveman", "caveman level: FULL");
    statuses.set("ponytail", "○ 🐴 ponytail: ⚡ FULL");
    statuses.set("skill-test", "skill: test");
    expect(setFooter).toHaveBeenCalledOnce();
    expect(statuses.get(SESSION_USAGE_STATUS_KEY)).toBe("17.4%/1.0M");
    expect(registerCommand).toHaveBeenCalledWith(
      "usage",
      expect.objectContaining({ description: "Show usage for the active provider" }),
    );
    expect(registerCommand).toHaveBeenCalledWith(
      "openai-usage",
      expect.objectContaining({ description: "Show OpenAI provider and authentication status" }),
    );
    expect(registerShortcut).toHaveBeenCalledWith(
      "super+shift+u",
      expect.objectContaining({ description: "Show usage for the active provider" }),
    );

    const theme = { fg: (_style: string, text: string) => text } as unknown as Theme;
    const tui = { requestRender: vi.fn() } as unknown as TUI;
    const footerData = {
      onBranchChange: () => vi.fn(),
      getAvailableProviderCount: () => 2,
      getExtensionStatuses: () => statuses,
      getGitBranch: () => "main",
    };
    const footerFactory = setFooter.mock.calls[0][0];
    const component = footerFactory(tui, theme, footerData);
    const wideLines = component.render(220);
    const wideStats = wideLines[1] ?? "";

    expect(wideLines).toHaveLength(2);
    expect(wideLines[0]).toContain("/repo (main) • test-session");
    expect(wideStats.startsWith("17.4%/1.0M (auto) · 🔌 MCP: 1 server enabled")).toBe(true);
    expect(wideStats).toContain("OpenAI ChatGPT · gpt-6-luna • thinking xhigh");
    expect(wideStats).not.toContain("(openai)");
    expect(wideStats).not.toContain("↑");
    expect(wideStats).not.toContain("API $");
    expect(wideStats.indexOf("🔌 MCP: 1 server enabled")).toBeLessThan(wideStats.indexOf("caveman level: FULL"));
    expect(wideStats.match(/17\.4%\/1\.0M/g)).toHaveLength(1);

    const mouse = (type: TuiMouseEvent["type"], x: number, y: number) =>
      ({ button: "left", type, x, y }) as TuiMouseEvent;
    const wideUsageX = visibleWidth(wideStats.slice(0, wideStats.indexOf("OpenAI ChatGPT")));
    component.handleMouse?.(mouse("click", 0, 1));
    component.handleMouse?.(mouse("click", wideUsageX, 1));

    const smallLines = component.render(80);
    expect(smallLines).toHaveLength(3);
    expect(smallLines[1]).toMatch(/^OpenAI ChatGPT · gpt-6-luna • thinking xhigh/);
    expect(smallLines[2]).toContain("17.4%/1.0M (auto) · 🔌 MCP: 1 server enabled");
    expect(smallLines[2]).toContain("...");
    expect(smallLines.every((line: string) => visibleWidth(line) <= 80)).toBe(true);
    const smallUsageX = visibleWidth((smallLines[1] ?? "").slice(0, (smallLines[1] ?? "").indexOf("OpenAI ChatGPT")));
    component.handleMouse?.(mouse("click", 0, 2));
    component.handleMouse?.(mouse("click", smallUsageX, 1));
    const tinyLines = component.render(24);
    expect(tinyLines).toHaveLength(3);
    expect(tinyLines.every((line: string) => visibleWidth(line) <= 24 && line.includes("..."))).toBe(true);

    expect(emit).toHaveBeenNthCalledWith(1, OPEN_SESSION_USAGE_EVENT, undefined);
    expect(emit).toHaveBeenNthCalledWith(2, OPEN_OPENAI_USAGE_EVENT, undefined);
    expect(emit).toHaveBeenNthCalledWith(3, OPEN_SESSION_USAGE_EVENT, undefined);
    expect(emit).toHaveBeenNthCalledWith(4, OPEN_OPENAI_USAGE_EVENT, undefined);

    statuses.set(COPILOT_USAGE_STATUS_KEY, "Copilot Pro 20%");
    const bothUsageStats = component.render(160)[1] ?? "";
    const copilotUsageX = visibleWidth(bothUsageStats.slice(0, bothUsageStats.indexOf("Copilot Pro 20%")));
    component.handleMouse?.(mouse("click", copilotUsageX, 1));
    expect(emit).toHaveBeenNthCalledWith(5, OPEN_COPILOT_USAGE_EVENT, undefined);
    statuses.delete(COPILOT_USAGE_STATUS_KEY);
    const openAiStatus = statuses.get(OPENAI_USAGE_STATUS_KEY);
    statuses.delete(OPENAI_USAGE_STATUS_KEY);
    statuses.set(OPENROUTER_USAGE_STATUS_KEY, "OpenRouter $25.50/month");
    const openRouterStats = component.render(120)[1] ?? "";
    const openRouterUsageX = visibleWidth(openRouterStats.slice(0, openRouterStats.indexOf("OpenRouter $25.50")));
    component.handleMouse?.(mouse("click", openRouterUsageX, 1));
    expect(emit).toHaveBeenNthCalledWith(6, OPEN_OPENROUTER_USAGE_EVENT, undefined);
    statuses.delete(OPENROUTER_USAGE_STATUS_KEY);
    if (openAiStatus) statuses.set(OPENAI_USAGE_STATUS_KEY, openAiStatus);
    vi.stubEnv("OPENAI_ADMIN_KEY", "");
    const localStatusStats = component.render(160)[1] ?? "";
    expect(localStatusStats).toContain("OpenAI ChatGPT");
    expect(localStatusStats).toContain("gpt-6-luna • thinking xhigh");
    expect(localStatusStats).not.toContain("(openai)");
    expect(fetch).not.toHaveBeenCalled();

    mcpTools.push({ namespace: { name: "mcp__second" }, exposure: "direct" });
    expect(component.render(200)[1]).toContain("🔌 MCP: 2 servers enabled");
    component.dispose?.();
    await dispatch("session_shutdown");
    expect(statuses.has(SESSION_USAGE_STATUS_KEY)).toBe(false);
    expect(statuses.has(OPENAI_USAGE_STATUS_KEY)).toBe(false);
    expect(setFooter).toHaveBeenLastCalledWith(undefined);
  });
});
