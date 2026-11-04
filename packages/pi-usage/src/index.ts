import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerCopilotUsage from "./copilot-usage.ts";
import { OPEN_COPILOT_USAGE_EVENT, OPEN_OPENAI_USAGE_EVENT, OPEN_OPENROUTER_USAGE_EVENT } from "./events.ts";
import registerOpenAIUsage from "./openai-usage.ts";
import registerOpenRouterUsage from "./openrouter-usage.ts";

export type { UsageProvider, UsageSnapshot, UsageState, UsageWindow, UsageWindowIdentity } from "./usage-provider.ts";

export default function (pi: ExtensionAPI): void {
  registerCopilotUsage(pi);
  registerOpenAIUsage(pi);
  registerOpenRouterUsage(pi);

  const showActiveUsage = async (_args: string, ctx: ExtensionContext): Promise<void> => {
    const event =
      ctx.model?.provider === "github-copilot"
        ? OPEN_COPILOT_USAGE_EVENT
        : ctx.model?.provider === "openai"
          ? OPEN_OPENAI_USAGE_EVENT
          : ctx.model?.provider === "openrouter"
            ? OPEN_OPENROUTER_USAGE_EVENT
            : undefined;
    if (!event) {
      ctx.ui.notify("Usage details are not available for the active provider.", "warning");
      return;
    }
    pi.events.emit(event, undefined);
  };

  pi.registerCommand("usage", {
    description: "Show usage for the active provider",
    handler: showActiveUsage,
  });
  pi.registerShortcut("super+shift+u", {
    description: "Show usage for the active provider",
    handler: (ctx) => showActiveUsage("", ctx),
  });
}
