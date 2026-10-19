import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  type CopilotUsage,
  formatPlanUsage,
  formatProgressBar,
  formatTokens,
  formatUsageSummary,
  getUsageProgress,
  parseCopilotUsage,
  summarizeSession,
  writeClipboard,
} from "./core.ts";

const CACHE_MS = 5 * 60 * 1000;
const FOOTER_STATUS_KEY = "copilot-usage";

type UsageSnapshot = CopilotUsage & { fetchedAt: number };
type FooterRow = { text: string; style?: "accent" | "success" | "warning"; progress?: number };

let cachedUsage: UsageSnapshot | undefined;
let lastError: string | undefined;
let lastAttempt = 0;
let pending: Promise<UsageSnapshot> | undefined;
let requestFooterRender: (() => void) | undefined;

function runGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["api", "--hostname", "github.com", ...args],
      {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || error.message).trim();
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new Error("GitHub CLI (`gh`) not found. Install it and run `gh auth login -h github.com`."));
          } else if (/needs the ["']user["'] scope/i.test(message)) {
            reject(
              new Error('Copilot usage needs the "user" OAuth scope. Run `gh auth refresh -h github.com -s user`.'),
            );
          } else if (/not logged in|authentication required/i.test(message)) {
            reject(new Error("GitHub CLI is not logged in. Run `gh auth login -h github.com`."));
          } else {
            reject(new Error(`GitHub Copilot usage request failed: ${message}`));
          }
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

async function fetchCopilotUsage(): Promise<CopilotUsage> {
  return parseCopilotUsage(JSON.parse(await runGh(["copilot_internal/user"])) as unknown);
}

async function refreshUsage(force = false): Promise<UsageSnapshot> {
  if (pending) return pending;
  if (!force && cachedUsage && Date.now() - cachedUsage.fetchedAt < CACHE_MS) return cachedUsage;
  if (!force && lastError && Date.now() - lastAttempt < CACHE_MS) throw new Error(lastError);

  lastAttempt = Date.now();
  pending = fetchCopilotUsage()
    .then((usage) => {
      cachedUsage = { ...usage, fetchedAt: Date.now() };
      lastError = undefined;
      requestFooterRender?.();
      return cachedUsage;
    })
    .catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error);
      requestFooterRender?.();
      throw new Error(lastError);
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

function addCustomFooter(ctx: ExtensionContext): void {
  ctx.ui.setFooter((tui, theme, footerData) => {
    let disposed = false;
    const requestRender = () => {
      if (!disposed) tui.requestRender();
    };
    const unsubscribe = footerData.onBranchChange(requestRender);
    requestFooterRender = requestRender;
    let statsCache: { leafId: string | null; stats: ReturnType<typeof summarizeSession> } | undefined;
    let usageClickBounds: { left: number; right: number } | undefined;
    const getStats = () => {
      const leafId = ctx.sessionManager.getLeafId();
      if (statsCache?.leafId === leafId) return statsCache.stats;
      const stats = summarizeSession(ctx.sessionManager.getEntries());
      statsCache = { leafId, stats };
      return stats;
    };

    return {
      dispose() {
        disposed = true;
        unsubscribe();
        if (requestFooterRender === requestRender) requestFooterRender = undefined;
      },
      handleMouse(event: TuiMouseEvent) {
        if (
          event.button !== "left" ||
          event.y !== 1 ||
          !usageClickBounds ||
          event.x < usageClickBounds.left ||
          event.x >= usageClickBounds.right
        )
          return;
        if (event.type === "click") void showUsage(ctx);
        if (event.type === "press" || event.type === "release" || event.type === "click") {
          return { handled: true, render: event.type === "click" };
        }
      },
      invalidate() {},
      render(width: number) {
        const stats = getStats();
        const context = ctx.getContextUsage();
        const leftParts: string[] = [];
        const input = stats.input + stats.cacheRead + stats.cacheWrite;
        if (input) leftParts.push(`↑${formatTokens(input)}`);
        if (stats.output) leftParts.push(`↓${formatTokens(stats.output)}`);
        if (stats.cacheRead) leftParts.push(`R${formatTokens(stats.cacheRead)}`);
        if (stats.cacheWrite) leftParts.push(`W${formatTokens(stats.cacheWrite)}`);
        if (stats.cost) leftParts.push(`$${stats.cost.toFixed(3)}`);
        if (context) {
          const percent = context.percent === null ? "?" : `${context.percent.toFixed(1)}%`;
          leftParts.push(`${percent}/${formatTokens(context.contextWindow)}`);
        }
        let left = theme.fg("dim", leftParts.join(" "));

        const model = ctx.model;
        const modelName = model?.name || model?.id || "no-model";
        const thinking = model?.reasoning ? ` • ${ctx.thinkingLevel || "off"}` : "";
        let modelText = `${modelName}${thinking}`;
        if (footerData.getAvailableProviderCount() > 1 && model) modelText = `(${model.provider}) ${modelText}`;
        const usageText = formatPlanUsage(cachedUsage);
        const usageStyle =
          cachedUsage?.percentUsed !== undefined && cachedUsage.percentUsed >= 90 ? "warning" : "accent";
        const usageLabel = usageText ? theme.fg(usageStyle, usageText) : "";
        const right = usageLabel ? `${usageLabel} · ${modelText}` : modelText;

        const clippedRight = truncateToWidth(right, width, "");
        const clippedRightWidth = visibleWidth(clippedRight);
        const usageLabelWidth = visibleWidth(usageLabel);
        usageClickBounds =
          usageLabelWidth > 0
            ? {
                left: width - clippedRightWidth,
                right: width - clippedRightWidth + Math.min(usageLabelWidth, clippedRightWidth),
              }
            : undefined;
        const leftWidth = Math.max(0, width - clippedRightWidth - 2);
        left = leftWidth > 0 ? truncateToWidth(left, leftWidth, "...") : "";
        const padding = " ".repeat(Math.max(0, width - visibleWidth(left) - clippedRightWidth));
        const statsLine = `${left}${padding}${clippedRight}`;

        const home = process.env.HOME || "";
        let cwd = home && ctx.cwd.startsWith(`${home}/`) ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd;
        const branch = footerData.getGitBranch();
        if (branch) cwd += ` (${branch})`;
        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName) cwd += ` • ${sessionName}`;
        const lines = [truncateToWidth(theme.fg("dim", cwd), width, theme.fg("dim", "...")), statsLine];
        const statuses = Array.from(footerData.getExtensionStatuses().entries())
          .filter(([key]) => key !== FOOTER_STATUS_KEY)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => text);
        if (statuses.length) lines.push(truncateToWidth(statuses.join(" "), width, theme.fg("dim", "...")));
        return lines;
      },
    };
  });
}

function copyToClipboard(text: string): Promise<void> {
  if (process.platform !== "darwin") return Promise.reject(new Error("Clipboard copy requires macOS."));
  return writeClipboard(text);
}

function borderedRows(rows: FooterRow[], width: number, theme: Theme): string[] {
  if (width < 6)
    return rows.map(({ text, progress }) =>
      truncateToWidth(progress === undefined ? text : formatProgressBar(progress, width), width, "…"),
    );
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

function modalOverlayRows(rows: FooterRow[], width: number, height: number, theme: Theme): string[] {
  const panelWidth = Math.min(width, 74);
  const panel = borderedRows(rows, panelWidth, theme);
  const left = Math.floor((width - panelWidth) / 2);
  const top = Math.max(0, Math.floor((height - panel.length) / 2));
  const screen = Array.from({ length: height }, () => " ".repeat(width));
  panel.forEach((line, index) => {
    const row = top + index;
    if (row < height)
      screen[row] = `${" ".repeat(left)}${line}${" ".repeat(Math.max(0, width - left - visibleWidth(line)))}`;
  });
  return screen;
}

function buildUsageModal(usage: CopilotUsage): { rows: FooterRow[]; clipboardText: string } {
  const [title, planText, quotaText, resetText] = formatUsageSummary(usage);
  const progress = getUsageProgress(usage);
  const rows: FooterRow[] = [
    { text: title, style: "accent" },
    { text: "" },
    { text: planText },
    { text: "" },
    { text: quotaText },
  ];
  if (progress === undefined) rows.push({ text: "" });
  else rows.push({ text: "" }, { text: "", progress, style: progress >= 90 ? "warning" : "success" }, { text: "" });
  rows.push({ text: resetText }, { text: "" }, { text: "r refreshes · c copies plain text · Esc/Enter closes" });
  return { rows, clipboardText: [title, planText, quotaText, resetText].join("\n") };
}

async function showUsage(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/copilot-usage requires Pi TUI mode.", "warning");
    return;
  }

  try {
    let content = buildUsageModal(await refreshUsage(true));
    await ctx.ui.custom(
      (tui, theme, keybindings, done) => ({
        render(width: number) {
          // Mask transcript rows beneath overlay; TUI selection copies rendered screen cells.
          return modalOverlayRows(content.rows, width, tui.terminal.rows, theme);
        },
        invalidate() {},
        handleInput(data: string) {
          if (keybindings.matches(data, "app.interrupt") || keybindings.matches(data, "tui.input.submit")) {
            done(undefined);
            return;
          }
          const key = data.toLowerCase();
          if (key === "r") {
            content.rows[content.rows.length - 1] = { text: "Refreshing usage…" };
            tui.requestRender();
            void refreshUsage(true)
              .then((usage) => {
                content = buildUsageModal(usage);
                tui.requestRender();
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                content.rows[content.rows.length - 1] = { text: `Refresh failed: ${message}`, style: "warning" };
                tui.requestRender();
              });
            return;
          }
          if (key === "c") {
            void copyToClipboard(content.clipboardText)
              .then(() => {
                content.rows[content.rows.length - 1] = { text: "Copied plain text", style: "success" };
                tui.requestRender();
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                content.rows[content.rows.length - 1] = { text: `Copy failed: ${message}`, style: "warning" };
                tui.requestRender();
              });
            return;
          }
          tui.requestRender();
        },
      }),
      {
        overlay: true,
        overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 },
      },
    );
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setStatus(FOOTER_STATUS_KEY, undefined);
    addCustomFooter(ctx);
    void refreshUsage().catch(() => {});
  });

  pi.on("agent_end", (_event, ctx) => {
    if (ctx.mode === "tui") void refreshUsage().catch(() => {});
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") {
      ctx.ui.setStatus(FOOTER_STATUS_KEY, undefined);
      ctx.ui.setFooter(undefined);
      requestFooterRender = undefined;
    }
  });

  pi.registerCommand("copilot-usage", {
    description: "Show GitHub Copilot plan and quota usage",
    handler: (_args, ctx) => showUsage(ctx),
  });

  pi.registerShortcut("super+shift+u", {
    description: "Show GitHub Copilot AI-credit usage",
    handler: (ctx) => showUsage(ctx),
  });
}
