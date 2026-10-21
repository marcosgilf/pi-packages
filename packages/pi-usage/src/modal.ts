import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type KeybindingsManager,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { formatProgressBar, writeClipboard } from "./core.ts";

export type ModalRow = { text: string; style?: "accent" | "success" | "warning"; progress?: number };
export type ModalContent = { rows: ModalRow[]; clipboardText: string };
export type ModalActions = {
  refresh: () => Promise<ModalContent>;
  copy?: (text: string) => Promise<void>;
};

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

function modalScreen(rows: ModalRow[], width: number, height: number, theme: Theme): string[] {
  const panelWidth = Math.min(width, 74);
  const panel = borderedRows(rows, panelWidth, theme);
  const left = Math.floor((width - panelWidth) / 2);
  const top = Math.max(0, Math.floor((height - panel.length) / 2));
  const screen = Array.from({ length: height }, () => " ".repeat(width));
  panel.forEach((line, index) => {
    const row = top + index;
    if (row < height) {
      screen[row] = `${" ".repeat(left)}${line}${" ".repeat(Math.max(0, width - left - visibleWidth(line)))}`;
    }
  });
  return screen;
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
  const requestRender = () => {
    if (!disposed) tui.requestRender();
  };

  return {
    dispose() {
      disposed = true;
      refreshGeneration++;
    },
    render(width: number) {
      const hint = status ?? { text: "r refreshes · c copies plain text · Esc/Enter closes" };
      return modalScreen([...content.rows, { text: "" }, hint], width, tui.terminal.rows, theme);
    },
    invalidate() {},
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
      if (key === "c") {
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
