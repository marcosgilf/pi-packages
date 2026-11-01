import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ModalContent, type ModalRow, showModal } from "@marcosgilf/pi-modal";
import { formatPlanUsage, formatUsageSummary, getUsageProgress, parseCopilotUsage } from "./core.ts";
import { COPILOT_USAGE_STATUS_KEY, OPEN_COPILOT_USAGE_EVENT } from "./events.ts";
import type { UsageProvider, UsageSnapshot } from "./usage-provider.ts";

const CACHE_MS = 5 * 60 * 1000;

let cachedUsage: UsageSnapshot | undefined;
let lastError: string | undefined;
let lastAttempt = 0;
let pending: Promise<UsageSnapshot> | undefined;

function isOfficialCopilotModel(ctx: ExtensionContext): boolean {
  if (ctx.model?.provider !== "github-copilot") return false;
  try {
    const url = new URL(ctx.model.baseUrl);
    return url.protocol === "https:" && !url.port && /^api\.[a-z0-9-]+\.githubcopilot\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function runGh(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["api", "--hostname", "github.com", ...args],
      {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        signal,
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

const copilotUsageProvider: UsageProvider = {
  id: "github-copilot",
  async fetchUsage({ signal } = {}) {
    return parseCopilotUsage(JSON.parse(await runGh(["copilot_internal/user"], signal)) as unknown);
  },
};

async function refreshUsage(force = false): Promise<UsageSnapshot> {
  if (pending) return pending;
  if (!force && cachedUsage && Date.now() - cachedUsage.fetchedAt < CACHE_MS) return cachedUsage;
  if (!force && lastError && Date.now() - lastAttempt < CACHE_MS) throw new Error(lastError);

  lastAttempt = Date.now();
  pending = copilotUsageProvider
    .fetchUsage()
    .then((usage) => {
      cachedUsage = usage;
      lastError = undefined;
      return cachedUsage;
    })
    .catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error);
      throw new Error(lastError);
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

function buildCopilotUsageModal(usage: UsageSnapshot): ModalContent {
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

async function showCopilotUsage(ctx: ExtensionContext, isCurrent: () => boolean): Promise<void> {
  const unavailableMessage = "/copilot-usage requires Pi TUI mode.";
  if (ctx.mode !== "tui") {
    ctx.ui.notify(unavailableMessage, "warning");
    return;
  }
  if (!isOfficialCopilotModel(ctx)) {
    ctx.ui.notify("GitHub Copilot usage requires an active GitHub Copilot model.", "warning");
    return;
  }

  try {
    const usage = await refreshUsage(true);
    if (!isCurrent() || !isOfficialCopilotModel(ctx)) return;
    const content = buildCopilotUsageModal(usage);
    ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, formatPlanUsage(usage));
    await showModal(
      ctx,
      content,
      {
        refresh: async () => {
          const usage = await refreshUsage(true);
          if (!isCurrent() || !isOfficialCopilotModel(ctx))
            throw new Error("Session or active model changed during usage refresh.");
          ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, formatPlanUsage(usage));
          return buildCopilotUsageModal(usage);
        },
      },
      unavailableMessage,
    );
  } catch (error) {
    if (isCurrent()) ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export default function registerCopilotUsage(pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined;
  let sessionGeneration = 0;
  let modelGeneration = 0;
  const isCurrent = (session: number, model: number) => () =>
    session === sessionGeneration && model === modelGeneration;

  const updateActiveStatus = (ctx: ExtensionContext, session: number, model: number, clear: boolean) => {
    if (!isOfficialCopilotModel(ctx)) {
      ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, undefined);
      return;
    }
    if (clear) ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, undefined);
    void refreshUsage()
      .then((usage) => {
        if (isCurrent(session, model)() && isOfficialCopilotModel(ctx)) {
          ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, formatPlanUsage(usage));
        }
      })
      .catch(() => {});
  };

  pi.events.on(OPEN_COPILOT_USAGE_EVENT, () => {
    if (currentContext) void showCopilotUsage(currentContext, isCurrent(sessionGeneration, modelGeneration));
  });

  pi.on("session_start", (_event, ctx) => {
    const session = ++sessionGeneration;
    const model = ++modelGeneration;
    currentContext = ctx.mode === "tui" ? ctx : undefined;
    if (ctx.mode === "tui") updateActiveStatus(ctx, session, model, true);
  });

  pi.on("model_select", (_event, ctx) => {
    const model = ++modelGeneration;
    if (ctx.mode !== "tui") {
      currentContext = undefined;
      return;
    }
    currentContext = ctx;
    updateActiveStatus(ctx, sessionGeneration, model, true);
  });

  pi.on("agent_end", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentContext = ctx;
    updateActiveStatus(ctx, sessionGeneration, modelGeneration, false);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessionGeneration++;
    modelGeneration++;
    if (ctx.mode === "tui") ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, undefined);
    currentContext = undefined;
  });

  pi.registerCommand("copilot-usage", {
    description: "Show GitHub Copilot plan and quota usage",
    handler: (_args, ctx) => showCopilotUsage(ctx, isCurrent(sessionGeneration, modelGeneration)),
  });
}
