import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createModalComponent, formatProgressBar, type ModalContent, writeClipboard } from "../src/index.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function createTui(rows = 24): TUI {
  return {
    terminal: { rows },
    requestRender: vi.fn(),
  } as unknown as TUI;
}

const keybindings = {
  matches: (data: string, action: string) =>
    (action === "app.interrupt" && data === "escape") ||
    (action === "tui.input.submit" && data === "enter") ||
    (action === "tui.input.copy" && data === "ctrl+c"),
} as unknown as KeybindingsManager;

describe("shared modal", () => {
  it("refreshes content, copies plain text, and closes with Escape", async () => {
    const tui = createTui();
    const initial: ModalContent = { rows: [{ text: "Old usage" }], clipboardText: "old summary" };
    const refreshed: ModalContent = { rows: [{ text: "New usage" }], clipboardText: "plain summary" };
    const refresh = vi.fn(async () => refreshed);
    const copy = vi.fn(async (_text: string) => {});
    const done = vi.fn();
    const component = createModalComponent(tui, theme, keybindings, done, initial, { refresh, copy });
    const renderText = () => component.render(80).join("\n");

    component.handleInput?.("r");
    await vi.waitFor(() => expect(renderText()).toContain("New usage"));
    expect(refresh).toHaveBeenCalledOnce();

    component.handleInput?.("c");
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("plain summary"));
    await vi.waitFor(() => expect(renderText()).toContain("Copied plain text"));

    component.handleInput?.("escape");
    expect(done).toHaveBeenCalledOnce();
  });

  it("adds vertical padding and closes on an outside click", () => {
    const tui = createTui();
    const done = vi.fn();
    const component = createModalComponent(
      tui,
      theme,
      keybindings,
      done,
      { rows: [{ text: "Session usage" }], clipboardText: "Session usage" },
      { refresh: async () => ({ rows: [], clipboardText: "" }) },
    );
    const lines = component.render(80);
    const top = lines.findIndex((line) => line.includes("╭"));

    expect(lines[top + 1]).toContain("│");
    expect(lines[top + 1]).not.toContain("Session usage");
    expect(lines[top + 5]).toContain("│");
    expect(lines[top + 5]).not.toContain("Esc/outside");

    const click = (x: number, y: number) =>
      ({
        type: "click",
        button: "left",
        x,
        y,
        screenX: x,
        screenY: y,
        width: 80,
        height: 24,
        shift: false,
        alt: false,
        ctrl: false,
      }) as TuiMouseEvent;
    component.handleMouse?.(click(5, top + 1));
    expect(done).not.toHaveBeenCalled();

    component.handleMouse?.(click(0, top + 1));
    expect(done).toHaveBeenCalledOnce();
  });

  it("keeps quota details, reset time, and controls visible on short screens", () => {
    const content: ModalContent = {
      rows: [
        { text: "Copilot usage and plan", style: "accent" },
        { text: "" },
        { text: "Plan: Copilot Enterprise" },
        { text: "" },
        { text: "AI credits: 5,000 / 20,000 (25% used)" },
        { text: "" },
        { text: "", progress: 25, style: "success" },
        { text: "" },
        { text: "Resets: Nov 1 UTC" },
      ],
      clipboardText: "Copilot summary",
    };

    for (const height of [12, 10]) {
      const component = createModalComponent(createTui(height), theme, keybindings, vi.fn(), content, {
        refresh: async () => content,
      });
      const rendered = component.render(80).join("\n");
      expect(rendered).toContain("Copilot usage and plan");
      expect(rendered).toContain("AI credits: 5,000 / 20,000 (25% used)");
      expect(rendered).toContain("Resets: Nov 1 UTC");
      expect(rendered).toContain("r refresh · c copy full summary");
      expect(rendered).toContain("██");
      component.dispose();
    }
  });

  it("copies the active TUI selection with Command+C", async () => {
    const copySelection = vi.fn(async () => true);
    const tui = Object.assign(createTui(), {
      hasActiveSelection: () => true,
      copyActiveSelectionToClipboard: copySelection,
    });
    const copy = vi.fn(async (_text: string) => {});
    const component = createModalComponent(
      tui,
      theme,
      keybindings,
      vi.fn(),
      { rows: [{ text: "Session usage" }], clipboardText: "full session summary" },
      { refresh: async () => ({ rows: [], clipboardText: "" }), copy },
    );

    component.handleInput?.("\u001b[99;9u");

    await vi.waitFor(() => expect(copySelection).toHaveBeenCalledOnce());
    expect(copy).not.toHaveBeenCalled();
    expect(component.render(80).join("\n")).toContain("Copied selection");
  });

  it("clamps progress bars and writes clipboard output", async () => {
    expect(formatProgressBar(50, 8)).toBe("████░░░░");
    expect(formatProgressBar(125, 3)).toBe("███");
    expect(formatProgressBar(75, 0)).toBe("");

    const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = await mkdtemp(join(tmpdir(), "pi-modal-test-"));
    try {
      const output = join(directory, "clipboard.txt");
      const command = join(directory, "pbcopy");
      await writeFile(
        command,
        `#!${process.execPath}\nconst fs = require("node:fs"); process.stdin.pipe(fs.createWriteStream(${JSON.stringify(output)}));\n`,
        { mode: 0o755 },
      );
      await writeClipboard("plain text", command);
      expect(await readFile(output, "utf8")).toBe("plain text");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
