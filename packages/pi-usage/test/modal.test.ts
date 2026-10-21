import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createModalComponent, type ModalContent } from "../src/modal.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function createTui(): TUI {
  return {
    terminal: { rows: 24 },
    requestRender: vi.fn(),
  } as unknown as TUI;
}

const keybindings = {
  matches: (data: string, action: string) =>
    (action === "app.interrupt" && data === "escape") || (action === "tui.input.submit" && data === "enter"),
} as unknown as KeybindingsManager;

describe("shared modal library", () => {
  it("refreshes content, copies its plain summary, and closes with Escape", async () => {
    const tui = createTui();
    const initial: ModalContent = { rows: [{ text: "Old usage" }], clipboardText: "old summary" };
    const refreshed: ModalContent = { rows: [{ text: "New usage" }], clipboardText: "plain summary" };
    const refresh = vi.fn(async () => refreshed);
    const copy = vi.fn(async (_text: string) => {});
    const done = vi.fn();
    const component = createModalComponent(tui, theme, keybindings, done, initial, { refresh, copy });
    const renderText = () => component.render(80).join("\n");
    expect(component.handleInput).toBeTypeOf("function");

    component.handleInput?.("r");
    await vi.waitFor(() => expect(renderText()).toContain("New usage"));
    expect(refresh).toHaveBeenCalledOnce();

    component.handleInput?.("c");
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("plain summary"));
    await vi.waitFor(() => expect(renderText()).toContain("Copied plain text"));

    component.handleInput?.("escape");
    expect(done).toHaveBeenCalledOnce();
  });
});
