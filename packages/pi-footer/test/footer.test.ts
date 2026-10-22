import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { OPEN_SESSION_USAGE_EVENT, SESSION_USAGE_STATUS_KEY } from "@marcosgilf/pi-session/events";
import { COPILOT_USAGE_STATUS_KEY, OPEN_COPILOT_USAGE_EVENT } from "@marcosgilf/pi-usage/events";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

describe("pi-footer", () => {
  it("adapts footer layout to width and routes clicks without blocking text selection", () => {
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
    const emit = vi.fn();
    const setFooter = vi.fn();
    const pi = {
      on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
        handlers.set(event, handler);
        return vi.fn();
      },
      events: { emit, on: vi.fn(() => vi.fn()) },
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
    } as unknown as ExtensionAPI;

    extension(pi);

    const ctx = {
      mode: "tui",
      cwd: "/repo",
      model: { id: "test-model", name: "Test model", reasoning: false, provider: "test" },
      thinkingLevel: "off",
      sessionManager: { getSessionName: () => undefined },
      ui: { setFooter },
    } as unknown as ExtensionContext;
    handlers.get("session_start")?.({}, ctx);
    expect(setFooter).toHaveBeenCalledOnce();

    const theme = {
      fg: (_style: string, text: string) => text,
      bg: (_style: string, text: string) => text,
      bold: (text: string) => text,
    } as unknown as Theme;
    const tui = { requestRender: vi.fn() } as unknown as TUI;
    const footerData = {
      onBranchChange: () => vi.fn(),
      getAvailableProviderCount: () => 1,
      getExtensionStatuses: () =>
        new Map([
          [SESSION_USAGE_STATUS_KEY, "50.0%/2.0k"],
          [COPILOT_USAGE_STATUS_KEY, "Copilot Enterprise 20%"],
          ["caveman", "⠠⠄ caveman level: FULL"],
          ["ponytail", "○ 🐴 ponytail: ⚡ FULL"],
        ]),
      getGitBranch: () => undefined,
    };
    const footerFactory = setFooter.mock.calls[0][0];
    const component = footerFactory(tui, theme, footerData);
    const wideLines = component.render(120);
    const wideStats = wideLines[1];
    const contextX = wideStats.indexOf("50.0%/2.0k");
    const usageX = visibleWidth(wideStats.slice(0, wideStats.indexOf("Copilot Enterprise")));

    expect(wideLines).toHaveLength(2);
    expect(wideLines[0]).toContain("/repo");
    expect(wideStats.indexOf("50.0%/2.0k")).toBeLessThan(wideStats.indexOf("caveman level: FULL"));
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
    component.handleMouse?.(mouse("click", 0, 2));
    component.handleMouse?.(mouse("click", 0, 1));

    expect(emit).toHaveBeenNthCalledWith(1, OPEN_SESSION_USAGE_EVENT, undefined);
    expect(emit).toHaveBeenNthCalledWith(2, OPEN_COPILOT_USAGE_EVENT, undefined);
    expect(emit).toHaveBeenNthCalledWith(3, OPEN_SESSION_USAGE_EVENT, undefined);
    expect(emit).toHaveBeenNthCalledWith(4, OPEN_COPILOT_USAGE_EVENT, undefined);
    component.dispose?.();
  });
});
