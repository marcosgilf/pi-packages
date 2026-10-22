import { execFile } from "node:child_process";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type KeybindingsManager,
  matchesKey,
  type TUI,
  type TuiMouseEvent,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

export type ModalRow = { text: string; style?: "accent" | "success" | "warning"; progress?: number };
export type ModalContent = { rows: ModalRow[]; clipboardText: string };
export type ModalActions = {
  refresh: () => Promise<ModalContent>;
  copy?: (text: string) => Promise<void>;
};

export function writeClipboard(text: string, command = "pbcopy"): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, (error) => (error ? reject(error) : resolve()));
    child.stdin?.on("error", reject);
    child.stdin?.end(text);
  });
}

export function formatProgressBar(percent: number, width: number): string {
  const cells = Math.max(0, Math.floor(width));
  const value = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((value / 100) * cells);
  return `${"█".repeat(filled)}${"░".repeat(cells - filled)}`;
}

function borderedRows(rows: ModalRow[], width: number, theme: Theme): string[] {
  if (width < 6) {
    return rows.map(({ text, progress }) =>
      truncateToWidth(progress === undefined ? text : formatProgressBar(progress, width), width, "…"),
    );
  }
  const contentWidth = width - 4;
  const edge = theme.fg("muted", "│");
  const top = theme.fg("muted", `╭${"─".repeat(contentWidth + 2)}╮`);
  const bottom = theme.fg("muted", `╰${"─".repeat(contentWidth + 2)}╯`);
  const content = rows.map(({ text, style, progress }) => {
    const value = progress === undefined ? text : formatProgressBar(progress, contentWidth);
    const styled = style === "accent" ? theme.fg(style, theme.bold(value)) : style ? theme.fg(style, value) : value;
    const clipped = truncateToWidth(styled, contentWidth, "…");
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
    return `${edge}${theme.bg("selectedBg", ` ${clipped}${padding} `)}${edge}`;
  });
  return [top, ...content, bottom];
}

function modalScreen(
  rows: ModalRow[],
  width: number,
  height: number,
  theme: Theme,
): { lines: string[]; bounds: { left: number; top: number; right: number; bottom: number } } {
  const panelWidth = Math.min(width, 74);
  const panel = borderedRows([{ text: "" }, ...rows, { text: "" }], panelWidth, theme);
  const left = Math.floor((width - panelWidth) / 2);
  const top = Math.max(0, Math.floor((height - panel.length) / 2));
  const screen = Array.from({ length: height }, () => " ".repeat(width));
  panel.forEach((line, index) => {
    const row = top + index;
    if (row < height) {
      screen[row] = `${" ".repeat(left)}${line}${" ".repeat(Math.max(0, width - left - visibleWidth(line)))}`;
    }
  });
  return {
    lines: screen,
    bounds: { left, top, right: left + panelWidth, bottom: Math.min(height, top + panel.length) },
  };
}

async function copyToClipboard(text: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Clipboard copy requires macOS.");
  await writeClipboard(text);
}

export function createModalComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: () => void,
  initial: ModalContent,
  actions: ModalActions,
): Component & { dispose(): void } {
  let content = initial;
  let status: ModalRow | undefined;
  let disposed = false;
  let refreshGeneration = 0;
  let bounds: { left: number; top: number; right: number; bottom: number } | undefined;
  const selectionTui = tui as TUI & {
    hasActiveSelection?: () => boolean;
    copyActiveSelectionToClipboard?: () => Promise<boolean>;
  };
  const requestRender = () => {
    if (!disposed) tui.requestRender();
  };

  return {
    dispose() {
      disposed = true;
      refreshGeneration++;
    },
    render(width: number) {
      const hint = status ?? { text: "r refresh · c copy full summary · Esc/outside closes" };
      const layout = modalScreen([...content.rows, { text: "" }, hint], width, tui.terminal.rows, theme);
      bounds = layout.bounds;
      return layout.lines;
    },
    invalidate() {},
    handleMouse(event: TuiMouseEvent) {
      const inside =
        bounds && event.x >= bounds.left && event.x < bounds.right && event.y >= bounds.top && event.y < bounds.bottom;
      if (event.type !== "click" || inside) return;
      done();
      return { handled: true, render: true };
    },
    handleInput(data: string) {
      if (keybindings.matches(data, "app.interrupt") || keybindings.matches(data, "tui.input.submit")) {
        done();
        return;
      }
      const key = data.toLowerCase();
      if (key === "r") {
        const generation = ++refreshGeneration;
        status = { text: "Refreshing usage…" };
        requestRender();
        void actions
          .refresh()
          .then((next) => {
            if (disposed || generation !== refreshGeneration) return;
            content = next;
            status = undefined;
            requestRender();
          })
          .catch((error: unknown) => {
            if (disposed || generation !== refreshGeneration) return;
            const message = error instanceof Error ? error.message : String(error);
            status = { text: `Refresh failed: ${message}`, style: "warning" };
            requestRender();
          });
        return;
      }
      const copySelection = matchesKey(data, "super+c") || keybindings.matches(data, "tui.input.copy");
      if (key === "c" || copySelection) {
        if (copySelection && selectionTui.hasActiveSelection?.() && selectionTui.copyActiveSelectionToClipboard) {
          status = { text: "Copying selection…" };
          requestRender();
          void selectionTui
            .copyActiveSelectionToClipboard()
            .then((copied) => {
              if (disposed) return;
              status = copied
                ? { text: "Copied selection", style: "success" }
                : { text: "Copy failed", style: "warning" };
              requestRender();
            })
            .catch((error: unknown) => {
              if (disposed) return;
              const message = error instanceof Error ? error.message : String(error);
              status = { text: `Copy failed: ${message}`, style: "warning" };
              requestRender();
            });
          return;
        }
        void (actions.copy ?? copyToClipboard)(content.clipboardText)
          .then(() => {
            if (disposed) return;
            status = { text: "Copied plain text", style: "success" };
            requestRender();
          })
          .catch((error: unknown) => {
            if (disposed) return;
            const message = error instanceof Error ? error.message : String(error);
            status = { text: `Copy failed: ${message}`, style: "warning" };
            requestRender();
          });
        return;
      }
      requestRender();
    },
  };
}

export async function showModal(
  ctx: ExtensionContext,
  initial: ModalContent,
  actions: ModalActions,
  unavailableMessage: string,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(unavailableMessage, "warning");
    return;
  }

  try {
    await ctx.ui.custom(
      (tui, theme, keybindings, done) =>
        createModalComponent(tui, theme, keybindings, () => done(undefined), initial, actions),
      {
        overlay: true,
        overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 },
      },
    );
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
