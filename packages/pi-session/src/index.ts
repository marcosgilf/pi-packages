import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ModalContent, type ModalRow, showModal } from "@marcosgilf/pi-modal";
import { formatContextUsageIndicator, formatSessionUsageSummary, summarizeSession } from "./core.ts";
import { OPEN_SESSION_USAGE_EVENT, SESSION_USAGE_STATUS_KEY } from "./events.ts";

function buildSessionUsageModal(ctx: ExtensionContext, autoCompaction: boolean): ModalContent {
  const stats = summarizeSession(ctx.sessionManager.getEntries());
  const model = ctx.model;
  const subscription =
    model !== undefined &&
    ctx.modelRegistry.getProvider(model.provider)?.auth.oauth?.isSubscription === true &&
    ctx.modelRegistry.isUsingOAuth(model);
  const summary = formatSessionUsageSummary(stats, ctx.getContextUsage(), { subscription, autoCompaction });
  const rows: ModalRow[] = [
    { text: summary[0], style: "accent" },
    { text: "" },
    ...summary.slice(1, -1).map((text) => ({ text })),
    { text: "" },
    { text: summary[summary.length - 1] },
  ];
  return { rows, clipboardText: summary.join("\n") };
}

function updateSessionStatus(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;
  const context = ctx.getContextUsage();
  const contextWindow = context?.contextWindow ?? ctx.model?.contextWindow;
  const status = contextWindow ? formatContextUsageIndicator(context?.percent ?? null, contextWindow).text : undefined;
  ctx.ui.setStatus(SESSION_USAGE_STATUS_KEY, status);
}

async function showSessionUsage(ctx: ExtensionContext, autoCompaction: boolean): Promise<void> {
  const unavailableMessage = "/session-usage requires Pi TUI mode.";
  if (ctx.mode !== "tui") {
    ctx.ui.notify(unavailableMessage, "warning");
    return;
  }
  const build = () => buildSessionUsageModal(ctx, autoCompaction);
  await showModal(ctx, build(), { refresh: async () => build() }, unavailableMessage);
}

export default function (pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined;

  const autoCompactionEnabled = () => pi.getSettings().compaction?.enabled ?? true;

  pi.events.on(OPEN_SESSION_USAGE_EVENT, () => {
    if (currentContext) void showSessionUsage(currentContext, autoCompactionEnabled());
  });

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    updateSessionStatus(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    currentContext = ctx;
    updateSessionStatus(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    currentContext = ctx;
    updateSessionStatus(ctx);
  });
  pi.on("session_compact", (_event, ctx) => updateSessionStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus(SESSION_USAGE_STATUS_KEY, undefined);
    currentContext = undefined;
  });

  pi.registerCommand("session-usage", {
    description: "Show session token, cost, and context usage",
    handler: (_args, ctx) => showSessionUsage(ctx, autoCompactionEnabled()),
  });

  pi.registerShortcut("super+shift+s", {
    description: "Show session token, cost, and context usage",
    handler: (ctx) => showSessionUsage(ctx, autoCompactionEnabled()),
  });
}
