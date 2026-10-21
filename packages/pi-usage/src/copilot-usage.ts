import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  type CopilotUsage,
  formatContextUsageIndicator,
  formatPlanUsage,
  formatSessionUsageSummary,
  formatUsageSummary,
  getUsageProgress,
  parseCopilotUsage,
  summarizeSession,
} from "./core.ts";
import { type ModalContent, type ModalRow, showModal } from "./modal.ts";

const CACHE_MS = 5 * 60 * 1000;
const FOOTER_STATUS_KEY = "copilot-usage";

type UsageSnapshot = CopilotUsage & { fetchedAt: number };

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
    let usageClickBounds: { left: number; right: number } | undefined;
    let contextClickBounds: { left: number; right: number } | undefined;

    return {
      dispose() {
        disposed = true;
        unsubscribe();
        if (requestFooterRender === requestRender) requestFooterRender = undefined;
      },
      handleMouse(event: TuiMouseEvent) {
        if (event.button !== "left" || event.y !== 1) return;
        const clickedUsage =
          usageClickBounds !== undefined && event.x >= usageClickBounds.left && event.x < usageClickBounds.right;
        const clickedContext =
          contextClickBounds !== undefined && event.x >= contextClickBounds.left && event.x < contextClickBounds.right;
        if (!clickedUsage && !clickedContext) return;
        if (event.type === "click") {
          if (clickedContext) void showSessionUsage(ctx);
          else void showCopilotUsage(ctx);
        }
        if (event.type === "press" || event.type === "release" || event.type === "click") {
          return { handled: true, render: event.type === "click" };
        }
      },
      invalidate() {},
      render(width: number) {
        const context = ctx.getContextUsage();
        const contextIndicator = context
          ? formatContextUsageIndicator(context.percent, context.contextWindow)
          : undefined;
        let left = contextIndicator ? theme.fg(contextIndicator.style, contextIndicator.text) : "";

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
        const visibleLeftWidth = visibleWidth(left);
        contextClickBounds =
          contextIndicator && visibleLeftWidth > 0 ? { left: 0, right: visibleLeftWidth } : undefined;
        const padding = " ".repeat(Math.max(0, width - visibleLeftWidth - clippedRightWidth));
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

function buildCopilotUsageModal(usage: CopilotUsage): ModalContent {
  const [title, planText, quotaText, resetText] = formatUsageSummary(usage);
  const progress = getUsageProgress(usage);
  const rows: ModalRow[] = [
    { text: title, style: "accent" },
    { text: "" },
    { text: planText },
    { text: "" },
    { text: quotaText },
  ];
  if (progress === undefined) rows.push({ text: "" });
  else rows.push({ text: "" }, { text: "", progress, style: progress >= 90 ? "warning" : "success" }, { text: "" });
  rows.push({ text: resetText });
  return { rows, clipboardText: [title, planText, quotaText, resetText].join("\n") };
}

function buildSessionUsageModal(ctx: ExtensionContext): ModalContent {
  const stats = summarizeSession(ctx.sessionManager.getEntries());
  const summary = formatSessionUsageSummary(stats, ctx.getContextUsage());
  const rows: ModalRow[] = [
    { text: summary[0], style: "accent" },
    { text: "" },
    ...summary.slice(1, -1).map((text) => ({ text })),
    { text: "" },
    { text: summary[summary.length - 1] },
  ];
  return { rows, clipboardText: summary.join("\n") };
}

async function showCopilotUsage(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/copilot-usage requires Pi TUI mode.", "warning");
    return;
  }
  try {
    const content = buildCopilotUsageModal(await refreshUsage(true));
    await showModal(
      ctx,
      content,
      { refresh: async () => buildCopilotUsageModal(await refreshUsage(true)) },
      "/copilot-usage requires Pi TUI mode.",
    );
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

async function showSessionUsage(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/session-usage requires Pi TUI mode.", "warning");
    return;
  }
  try {
    await showModal(
      ctx,
      buildSessionUsageModal(ctx),
      { refresh: async () => buildSessionUsageModal(ctx) },
      "/session-usage requires Pi TUI mode.",
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
    handler: (_args, ctx) => showCopilotUsage(ctx),
  });

  pi.registerCommand("session-usage", {
    description: "Show session token, cost, and context usage",
    handler: (_args, ctx) => showSessionUsage(ctx),
  });

  pi.registerShortcut("super+shift+u", {
    description: "Show GitHub Copilot AI-credit usage",
    handler: (ctx) => showCopilotUsage(ctx),
  });
}
