import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import registerSession from "@marcosgilf/pi-session";
import { getContextUsageStyle } from "@marcosgilf/pi-session/core";
import { OPEN_SESSION_USAGE_EVENT, SESSION_USAGE_STATUS_KEY } from "@marcosgilf/pi-session/events";
import registerUsage from "@marcosgilf/pi-usage";
import { COPILOT_USAGE_STATUS_KEY, OPEN_COPILOT_USAGE_EVENT } from "@marcosgilf/pi-usage/events";

type ClickBounds = { left: number; right: number };

function usageStyle(text: string): "warning" | "accent" {
  const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)%/);
  return match && Number(match[1]) >= 90 ? "warning" : "accent";
}

function addCustomFooter(ctx: ExtensionContext, pi: ExtensionAPI): void {
  ctx.ui.setFooter((tui, theme, footerData) => {
    let disposed = false;
    const requestRender = () => {
      if (!disposed) tui.requestRender();
    };
    const unsubscribe = footerData.onBranchChange(requestRender);
    let usageClickBounds: ClickBounds | undefined;
    let contextClickBounds: ClickBounds | undefined;
    let usageClickRow = 1;
    let contextClickRow = 1;

    return {
      dispose() {
        disposed = true;
        unsubscribe();
      },
      handleMouse(event: TuiMouseEvent) {
        if (event.button !== "left" || event.type !== "click") return;
        const clickedUsage =
          event.y === usageClickRow &&
          usageClickBounds !== undefined &&
          event.x >= usageClickBounds.left &&
          event.x < usageClickBounds.right;
        const clickedContext =
          event.y === contextClickRow &&
          contextClickBounds !== undefined &&
          event.x >= contextClickBounds.left &&
          event.x < contextClickBounds.right;
        if (!clickedUsage && !clickedContext) return;
        pi.events.emit(clickedContext ? OPEN_SESSION_USAGE_EVENT : OPEN_COPILOT_USAGE_EVENT, undefined);
        return { handled: true, render: true };
      },
      invalidate() {},
      render(width: number) {
        const contextText = footerData.getExtensionStatuses().get(SESSION_USAGE_STATUS_KEY) ?? "";
        const contextPercent = Number.parseFloat(contextText);
        const contextLabel = contextText
          ? theme.fg(getContextUsageStyle(Number.isFinite(contextPercent) ? contextPercent : null), contextText)
          : "";

        const model = ctx.model;
        const modelName = model?.name || model?.id || "no-model";
        const thinking = model?.reasoning ? ` • ${ctx.thinkingLevel || "off"}` : "";
        let modelText = `${modelName}${thinking}`;
        if (footerData.getAvailableProviderCount() > 1 && model) modelText = `(${model.provider}) ${modelText}`;

        const usageText = footerData.getExtensionStatuses().get(COPILOT_USAGE_STATUS_KEY) ?? "";
        const usageLabel = usageText ? theme.fg(usageStyle(usageText), usageText) : "";
        const right = usageLabel ? `${usageLabel} · ${modelText}` : modelText;
        const clippedRight = truncateToWidth(right, width, "");
        const rightWidth = visibleWidth(clippedRight);
        const usageWidth = visibleWidth(usageLabel);
        const usageRight = Math.min(usageWidth, rightWidth);
        const home = process.env.HOME || "";
        let cwd = home && ctx.cwd.startsWith(`${home}/`) ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd;
        const branch = footerData.getGitBranch();
        if (branch) cwd += ` (${branch})`;
        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName) cwd += ` • ${sessionName}`;

        // shortcut: count non-hidden registered namespaces, not offline configs; use a Pi MCP status API if one becomes public.
        const mcpServers = new Set(
          pi
            .getAllTools()
            .flatMap(({ namespace, exposure }) =>
              namespace?.name.startsWith("mcp__") && exposure !== "hidden" ? [namespace.name] : [],
            ),
        );
        const mcpStatus = mcpServers.size
          ? `🔌 MCP: ${mcpServers.size} server${mcpServers.size === 1 ? "" : "s"} enabled`
          : "";
        const statuses = Array.from(footerData.getExtensionStatuses().entries())
          .filter(([key]) => key !== SESSION_USAGE_STATUS_KEY && key !== COPILOT_USAGE_STATUS_KEY)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => text);
        const statusText = [contextLabel, mcpStatus, statuses.join(" ")].filter(Boolean).join(" · ");
        const statusWidth = visibleWidth(statusText);
        const statusLine = truncateToWidth(statusText, width, theme.fg("dim", "..."));
        const statusClickRight = Math.min(visibleWidth(contextLabel), visibleWidth(statusLine));
        const lines = [truncateToWidth(theme.fg("dim", cwd), width, theme.fg("dim", "..."))];

        if (statusText && statusWidth + rightWidth + 2 <= width) {
          const rightLeft = width - rightWidth;
          lines.push(`${statusText}${" ".repeat(Math.max(0, rightLeft - statusWidth))}${clippedRight}`);
          contextClickBounds = contextLabel ? { left: 0, right: statusClickRight } : undefined;
          usageClickBounds = usageRight > 0 ? { left: rightLeft, right: rightLeft + usageRight } : undefined;
          contextClickRow = 1;
          usageClickRow = 1;
        } else if (statusText) {
          lines.push(clippedRight, statusLine);
          contextClickBounds = contextLabel ? { left: 0, right: statusClickRight } : undefined;
          usageClickBounds = usageRight > 0 ? { left: 0, right: usageRight } : undefined;
          contextClickRow = 2;
          usageClickRow = 1;
        } else {
          lines.push(`${" ".repeat(Math.max(0, width - rightWidth))}${clippedRight}`);
          contextClickBounds = undefined;
          usageClickBounds =
            usageRight > 0 ? { left: width - rightWidth, right: width - rightWidth + usageRight } : undefined;
          contextClickRow = 1;
          usageClickRow = 1;
        }

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
