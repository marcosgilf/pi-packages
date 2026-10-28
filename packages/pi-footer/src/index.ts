import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import registerSession from "@marcosgilf/pi-session";
import { formatTokens, getContextUsageStyle, summarizeSession } from "@marcosgilf/pi-session/core";
import { OPEN_SESSION_USAGE_EVENT, SESSION_USAGE_STATUS_KEY } from "@marcosgilf/pi-session/events";
import registerUsage from "@marcosgilf/pi-usage";
import { COPILOT_USAGE_STATUS_KEY, OPEN_COPILOT_USAGE_EVENT } from "@marcosgilf/pi-usage/events";

type ClickBounds = { left: number; right: number };

function usageStyle(text: string): "warning" | "accent" {
  const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)%/);
  return match && Number(match[1]) >= 90 ? "warning" : "accent";
}

function formatSessionStatus(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  theme: Theme,
  stats: ReturnType<typeof summarizeSession>,
): string {
  const model = ctx.model;
  const isSubscription =
    model?.provider === "kimi-coding" ||
    (model !== undefined &&
      ctx.modelRegistry.getProvider(model.provider)?.auth.oauth?.isSubscription === true &&
      ctx.modelRegistry.isUsingOAuth(model));
  const parts = [
    stats.input > 0 ? `↑${formatTokens(stats.input)}` : undefined,
    stats.output > 0 ? `↓${formatTokens(stats.output)}` : undefined,
    stats.cacheRead > 0 ? `R${formatTokens(stats.cacheRead)}` : undefined,
    stats.cacheWrite > 0 ? `W${formatTokens(stats.cacheWrite)}` : undefined,
    (stats.cacheRead > 0 || stats.cacheWrite > 0) && stats.latestCacheHitRate !== undefined
      ? `CH${stats.latestCacheHitRate.toFixed(1)}%`
      : undefined,
    stats.cost || isSubscription ? `$${stats.cost.toFixed(3)}${isSubscription ? " (sub)" : ""}` : undefined,
  ].filter((part): part is string => part !== undefined);

  const context = ctx.getContextUsage();
  const contextWindow = context?.contextWindow ?? model?.contextWindow ?? 0;
  const percent = context?.percent ?? 0;
  const contextText = `${context?.percent !== null ? `${percent.toFixed(1)}%` : "?"}/${formatTokens(contextWindow)}${pi.getSettings().compaction?.enabled === false ? "" : " (auto)"}`;
  const tokens = parts.join(" ");
  return `${theme.fg("dim", tokens ? `${tokens} ` : "")}${theme.fg(
    getContextUsageStyle(context?.percent === null ? null : percent),
    contextText,
  )}`;
}

function getMcpStatus(pi: ExtensionAPI): string {
  // shortcut: count registered MCP tool namespaces, not offline configs; use a Pi server-status API if one becomes public.
  const servers = new Set(
    pi
      .getAllTools()
      .flatMap(({ namespace, exposure }) =>
        namespace?.name.startsWith("mcp__") && exposure !== "hidden" ? [namespace.name] : [],
      ),
  );
  return servers.size ? `🔌 MCP: ${servers.size} server${servers.size === 1 ? "" : "s"} enabled` : "";
}

function sanitizeStatus(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function addCustomFooter(ctx: ExtensionContext, pi: ExtensionAPI): void {
  ctx.ui.setFooter((tui, theme, footerData) => {
    let cachedSessionUsage: ReturnType<typeof summarizeSession> | undefined;
    let cachedSessionId: string | undefined;
    let cachedLeafId: string | null | undefined;
    let cachedEntryCount = -1;
    const getSessionUsage = () => {
      const entries = ctx.sessionManager.getEntries();
      const sessionId = ctx.sessionManager.getSessionId();
      const leafId = ctx.sessionManager.getLeafId();
      if (
        cachedSessionUsage === undefined ||
        cachedSessionId !== sessionId ||
        cachedLeafId !== leafId ||
        cachedEntryCount !== entries.length
      ) {
        cachedSessionUsage = summarizeSession(entries);
        cachedSessionId = sessionId;
        cachedLeafId = leafId;
        cachedEntryCount = entries.length;
      }
      return cachedSessionUsage;
    };
    let disposed = false;
    const requestRender = () => {
      if (!disposed) tui.requestRender();
    };
    const unsubscribe = footerData.onBranchChange(requestRender);
    let sessionClickBounds: ClickBounds | undefined;
    let usageClickBounds: ClickBounds | undefined;
    let sessionClickRow = 1;

    return {
      dispose() {
        disposed = true;
        unsubscribe();
      },
      handleMouse(event: TuiMouseEvent) {
        if (event.button !== "left" || event.type !== "click") return;
        const clickedSession =
          event.y === sessionClickRow &&
          sessionClickBounds !== undefined &&
          event.x >= sessionClickBounds.left &&
          event.x < sessionClickBounds.right;
        const clickedUsage =
          event.y === 1 &&
          usageClickBounds !== undefined &&
          event.x >= usageClickBounds.left &&
          event.x < usageClickBounds.right;
        if (!clickedSession && !clickedUsage) return;
        pi.events.emit(clickedSession ? OPEN_SESSION_USAGE_EVENT : OPEN_COPILOT_USAGE_EVENT, undefined);
        return { handled: true, render: true };
      },
      invalidate() {},
      render(width: number) {
        const sessionText = formatSessionStatus(ctx, pi, theme, getSessionUsage());
        const statuses = Array.from(footerData.getExtensionStatuses().entries())
          .filter(([key]) => key !== SESSION_USAGE_STATUS_KEY && key !== COPILOT_USAGE_STATUS_KEY)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => sanitizeStatus(text));
        const left = [sessionText, getMcpStatus(pi), statuses.join(" ")].filter(Boolean).join(" · ");

        const model = ctx.model;
        const modelName = model?.id || "no-model";
        const thinking = model?.reasoning
          ? ctx.thinkingLevel === "off"
            ? " • thinking off"
            : ` • thinking ${ctx.thinkingLevel || "off"}`
          : "";
        let modelText = `${modelName}${thinking}`;
        if (footerData.getAvailableProviderCount() > 1 && model) modelText = `(${model.provider}) ${modelText}`;
        const usageText = footerData.getExtensionStatuses().get(COPILOT_USAGE_STATUS_KEY) ?? "";
        const usageLabel = usageText ? theme.fg(usageStyle(usageText), usageText) : "";
        const right = [usageLabel, theme.fg("dim", modelText)].filter(Boolean).join(" · ");
        const clippedRight = truncateToWidth(right, width, theme.fg("dim", "..."));
        const rightWidth = visibleWidth(clippedRight);
        const home = process.env.HOME || "";
        let cwd =
          home && ctx.cwd === home
            ? "~"
            : home && ctx.cwd.startsWith(`${home}/`)
              ? `~${ctx.cwd.slice(home.length)}`
              : ctx.cwd;
        const branch = footerData.getGitBranch();
        if (branch) cwd += ` (${branch})`;
        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName) cwd += ` • ${sessionName}`;
        const lines = [truncateToWidth(theme.fg("dim", cwd), width, theme.fg("dim", "..."))];

        const ellipsis = theme.fg("dim", "...");
        const rightLeft = width - rightWidth;
        let sessionLine = "";
        sessionClickRow = 1;
        if (left && right && visibleWidth(left) + rightWidth + 2 <= width) {
          sessionLine = truncateToWidth(left, width - rightWidth - 2, ellipsis);
          const spaces = Math.max(2, rightLeft - visibleWidth(sessionLine));
          lines.push(`${sessionLine}${" ".repeat(spaces)}${clippedRight}`);
        } else if (left && right) {
          lines.push(`${" ".repeat(rightLeft)}${clippedRight}`);
          sessionLine = truncateToWidth(left, width, ellipsis);
          lines.push(sessionLine);
          sessionClickRow = 2;
        } else if (left) {
          sessionLine = truncateToWidth(left, width, ellipsis);
          lines.push(sessionLine);
        } else if (right) {
          lines.push(`${" ".repeat(rightLeft)}${clippedRight}`);
        }

        const sessionWidth = Math.min(visibleWidth(sessionText), visibleWidth(sessionLine));
        sessionClickBounds = sessionWidth > 0 ? { left: 0, right: sessionWidth } : undefined;
        usageClickBounds =
          usageLabel && right
            ? { left: rightLeft, right: rightLeft + Math.min(visibleWidth(usageLabel), rightWidth) }
            : undefined;

        return lines;
      },
    };
  });
}

export default function (pi: ExtensionAPI): void {
  registerSession(pi);
  registerUsage(pi);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") addCustomFooter(ctx, pi);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
