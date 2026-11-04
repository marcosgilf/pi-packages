import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import registerSession from "@marcosgilf/pi-session";
import { getContextUsageStyle } from "@marcosgilf/pi-session/core";
import { OPEN_SESSION_USAGE_EVENT, SESSION_USAGE_STATUS_KEY } from "@marcosgilf/pi-session/events";
import registerUsage from "@marcosgilf/pi-usage";
import {
  COPILOT_USAGE_STATUS_KEY,
  OPEN_COPILOT_USAGE_EVENT,
  OPEN_OPENAI_USAGE_EVENT,
  OPEN_OPENROUTER_USAGE_EVENT,
  OPENAI_USAGE_STATUS_KEY,
  OPENROUTER_USAGE_STATUS_KEY,
} from "@marcosgilf/pi-usage/events";

type ClickBounds = { left: number; right: number };

function usageStyle(text: string): "warning" | "accent" {
  const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)%/);
  return match && Number(match[1]) >= 90 ? "warning" : "accent";
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
    let disposed = false;
    const requestRender = () => {
      if (!disposed) tui.requestRender();
    };
    const unsubscribe = footerData.onBranchChange(requestRender);
    let sessionClickBounds: ClickBounds | undefined;
    let usageClickBounds: { bounds: ClickBounds; event: string }[] = [];
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
          event.y === 1
            ? usageClickBounds.find(({ bounds }) => event.x >= bounds.left && event.x < bounds.right)?.event
            : undefined;
        if (clickedSession) pi.events.emit(OPEN_SESSION_USAGE_EVENT, undefined);
        else if (clickedUsage) pi.events.emit(clickedUsage, undefined);
        else return;
        return { handled: true, render: true };
      },
      invalidate() {},
      render(width: number) {
        const statuses = footerData.getExtensionStatuses();
        const contextText = statuses.get(SESSION_USAGE_STATUS_KEY) ?? "";
        const contextPercent = Number.parseFloat(contextText);
        const autoCompaction = pi.getSettings().compaction?.enabled !== false;
        const sessionText = contextText
          ? theme.fg(
              getContextUsageStyle(Number.isFinite(contextPercent) ? contextPercent : null),
              `${contextText}${autoCompaction ? " (auto)" : ""}`,
            )
          : "";
        const otherStatuses = Array.from(statuses.entries())
          .filter(
            ([key]) =>
              key !== SESSION_USAGE_STATUS_KEY &&
              key !== COPILOT_USAGE_STATUS_KEY &&
              key !== OPENAI_USAGE_STATUS_KEY &&
              key !== OPENROUTER_USAGE_STATUS_KEY,
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => sanitizeStatus(text));
        const left = [sessionText, getMcpStatus(pi), otherStatuses.join(" ")].filter(Boolean).join(" · ");

        const model = ctx.model;
        const modelName = model?.id || "no-model";
        const thinking = model?.reasoning
          ? ctx.thinkingLevel === "off"
            ? " • thinking off"
            : ` • thinking ${ctx.thinkingLevel || "off"}`
          : "";
        const modelText = `${modelName}${thinking}`;
        const usageLabels = [
          { text: statuses.get(COPILOT_USAGE_STATUS_KEY) ?? "", event: OPEN_COPILOT_USAGE_EVENT },
          { text: statuses.get(OPENAI_USAGE_STATUS_KEY) ?? "", event: OPEN_OPENAI_USAGE_EVENT },
          { text: statuses.get(OPENROUTER_USAGE_STATUS_KEY) ?? "", event: OPEN_OPENROUTER_USAGE_EVENT },
        ]
          .filter(({ text }) => text)
          .map(({ text, event }) => ({ text: theme.fg(usageStyle(text), text), event }));
        const right = [...usageLabels.map(({ text }) => text), theme.fg("dim", modelText)].filter(Boolean).join(" · ");
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
        let rightStart = 0;
        let sessionLine = "";
        sessionClickRow = 1;
        if (left && right && visibleWidth(left) + rightWidth + 2 <= width) {
          rightStart = rightLeft;
          sessionLine = truncateToWidth(left, width - rightWidth - 2, ellipsis);
          const spaces = Math.max(2, rightLeft - visibleWidth(sessionLine));
          lines.push(`${sessionLine}${" ".repeat(spaces)}${clippedRight}`);
        } else if (left && right) {
          lines.push(clippedRight);
          sessionLine = truncateToWidth(left, width, ellipsis);
          lines.push(sessionLine);
          sessionClickRow = 2;
        } else if (left) {
          sessionLine = truncateToWidth(left, width, ellipsis);
          lines.push(sessionLine);
        } else if (right) {
          lines.push(clippedRight);
        }

        const sessionWidth = Math.min(visibleWidth(sessionText), visibleWidth(sessionLine));
        sessionClickBounds = sessionWidth > 0 ? { left: 0, right: sessionWidth } : undefined;
        usageClickBounds = usageLabels.flatMap(({ text, event }) => {
          const index = clippedRight.indexOf(text);
          if (index < 0) return [];
          const left = rightStart + visibleWidth(clippedRight.slice(0, index));
          return [{ bounds: { left, right: left + visibleWidth(text) }, event }];
        });

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
