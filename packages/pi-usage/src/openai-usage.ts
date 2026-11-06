import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ModalContent, showModal } from "@marcosgilf/pi-modal";
import { OPEN_OPENAI_USAGE_EVENT, OPENAI_USAGE_STATUS_KEY } from "./events.ts";
import type { UsageProvider, UsageSnapshot } from "./usage-provider.ts";

type OpenAIAuthMethod = "chatgpt-oauth" | "api-key" | "unconfigured";

function authMethod(ctx: ExtensionContext): OpenAIAuthMethod {
  const model = ctx.model;
  if (model?.provider !== "openai" || !ctx.modelRegistry.hasConfiguredAuth(model)) return "unconfigured";
  return ctx.modelRegistry.isUsingOAuth(model) ? "chatgpt-oauth" : "api-key";
}

export function createOpenAIUsageProvider(ctx: ExtensionContext): UsageProvider {
  return {
    id: "openai",
    async fetchUsage(): Promise<UsageSnapshot> {
      const method = authMethod(ctx);
      return {
        providerId: "openai",
        authMethod: method,
        windows: [],
        fetchedAt: Date.now(),
        state: method === "unconfigured" ? "unavailable" : "unsupported",
        error:
          method === "chatgpt-oauth"
            ? "No supported ChatGPT quota source is available for this Pi login."
            : method === "api-key"
              ? "ChatGPT subscription quota is unavailable with API-key authentication."
              : "OpenAI authentication is not configured.",
      };
    },
  };
}

export function formatOpenAIUsageStatus(usage: UsageSnapshot): string {
  const base =
    usage.authMethod === "chatgpt-oauth"
      ? "OpenAI ChatGPT"
      : usage.authMethod === "api-key"
        ? "OpenAI API key"
        : "OpenAI";
  if (
    (usage.authMethod === "chatgpt-oauth" || usage.authMethod === "api-key") &&
    (usage.state === "unavailable" || usage.state === "unsupported")
  )
    return base;
  switch (usage.authMethod) {
    case "chatgpt-oauth":
      return `${base} · quota unavailable`;
    case "api-key":
      return `${base} · subscription quota unavailable`;
    default:
      return `${base} · auth not configured`;
  }
}

export function formatOpenAIUsageSummary(usage: UsageSnapshot): string[] {
  const authentication =
    usage.authMethod === "chatgpt-oauth"
      ? "Sign in with ChatGPT"
      : usage.authMethod === "api-key"
        ? "OpenAI API key"
        : "Not configured";
  return [
    "OpenAI provider status",
    `Authentication: ${authentication}`,
    "ChatGPT subscription quota: unavailable",
    usage.error ?? "No quota data available.",
  ];
}

function buildUsageModal(usage: UsageSnapshot): ModalContent {
  const lines = formatOpenAIUsageSummary(usage);
  return {
    rows: lines.map((text, index) => ({ text, ...(index === 0 ? { style: "accent" as const } : {}) })),
    clipboardText: lines.join("\n"),
  };
}

async function showOpenAIUsage(ctx: ExtensionContext, isCurrent: () => boolean): Promise<void> {
  const unavailableMessage = "/openai-usage requires Pi TUI mode.";
  if (ctx.mode !== "tui") {
    ctx.ui.notify(unavailableMessage, "warning");
    return;
  }
  if (ctx.model?.provider !== "openai") {
    ctx.ui.notify("OpenAI status requires an active OpenAI model.", "warning");
    return;
  }

  try {
    const usage = await createOpenAIUsageProvider(ctx).fetchUsage();
    if (!isCurrent() || ctx.model?.provider !== "openai") return;
    ctx.ui.setStatus(OPENAI_USAGE_STATUS_KEY, formatOpenAIUsageStatus(usage));
    await showModal(
      ctx,
      buildUsageModal(usage),
      {
        refresh: async () => {
          const updated = await createOpenAIUsageProvider(ctx).fetchUsage();
          if (!isCurrent() || ctx.model?.provider !== "openai") {
            throw new Error("Session or active model changed during usage refresh.");
          }
          ctx.ui.setStatus(OPENAI_USAGE_STATUS_KEY, formatOpenAIUsageStatus(updated));
          return buildUsageModal(updated);
        },
      },
      unavailableMessage,
    );
  } catch (error) {
    if (isCurrent()) ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export default function registerOpenAIUsage(pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined;
  let sessionGeneration = 0;
  let modelGeneration = 0;
  const isCurrent = (session: number, model: number) => () =>
    session === sessionGeneration && model === modelGeneration;

  const updateActiveStatus = (ctx: ExtensionContext, session: number, model: number, clear = true) => {
    if (ctx.model?.provider !== "openai") {
      ctx.ui.setStatus(OPENAI_USAGE_STATUS_KEY, undefined);
      return;
    }
    if (clear) ctx.ui.setStatus(OPENAI_USAGE_STATUS_KEY, undefined);
    void createOpenAIUsageProvider(ctx)
      .fetchUsage()
      .then((usage) => {
        if (isCurrent(session, model)() && ctx.model?.provider === "openai") {
          ctx.ui.setStatus(OPENAI_USAGE_STATUS_KEY, formatOpenAIUsageStatus(usage));
        }
      })
      .catch(() => {});
  };

  pi.events.on(OPEN_OPENAI_USAGE_EVENT, () => {
    if (currentContext) void showOpenAIUsage(currentContext, isCurrent(sessionGeneration, modelGeneration));
  });

  pi.on("session_start", (_event, ctx) => {
    const session = ++sessionGeneration;
    const model = ++modelGeneration;
    currentContext = ctx.mode === "tui" ? ctx : undefined;
    if (ctx.mode === "tui") updateActiveStatus(ctx, session, model);
  });

  pi.on("model_select", (_event, ctx) => {
    const model = ++modelGeneration;
    if (ctx.mode !== "tui") {
      currentContext = undefined;
      return;
    }
    currentContext = ctx;
    updateActiveStatus(ctx, sessionGeneration, model);
  });

  pi.on("agent_end", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentContext = ctx;
    updateActiveStatus(ctx, sessionGeneration, modelGeneration, false);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessionGeneration++;
    modelGeneration++;
    if (ctx.mode === "tui") ctx.ui.setStatus(OPENAI_USAGE_STATUS_KEY, undefined);
    currentContext = undefined;
  });

  pi.registerCommand("openai-usage", {
    description: "Show OpenAI provider and authentication status",
    handler: (_args, ctx) => showOpenAIUsage(ctx, isCurrent(sessionGeneration, modelGeneration)),
  });
}
