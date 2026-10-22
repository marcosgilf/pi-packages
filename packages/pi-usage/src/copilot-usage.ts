import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ModalContent, type ModalRow, showModal } from "@marcosgilf/pi-modal";
import { type CopilotUsage, formatPlanUsage, formatUsageSummary, getUsageProgress, parseCopilotUsage } from "./core.ts";
import { COPILOT_USAGE_STATUS_KEY, OPEN_COPILOT_USAGE_EVENT } from "./events.ts";

const CACHE_MS = 5 * 60 * 1000;

type UsageSnapshot = CopilotUsage & { fetchedAt: number };

let cachedUsage: UsageSnapshot | undefined;
let lastError: string | undefined;
let lastAttempt = 0;
let pending: Promise<UsageSnapshot> | undefined;

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

async function showCopilotUsage(ctx: ExtensionContext): Promise<void> {
  const unavailableMessage = "/copilot-usage requires Pi TUI mode.";
  if (ctx.mode !== "tui") {
    ctx.ui.notify(unavailableMessage, "warning");
    return;
  }

  try {
    const content = buildCopilotUsageModal(await refreshUsage(true));
    ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, formatPlanUsage(cachedUsage));
    await showModal(
      ctx,
      content,
      {
        refresh: async () => {
          const usage = await refreshUsage(true);
          ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, formatPlanUsage(usage));
          return buildCopilotUsageModal(usage);
        },
      },
      unavailableMessage,
    );
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export default function (pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined;

  pi.events.on(OPEN_COPILOT_USAGE_EVENT, () => {
    if (currentContext) void showCopilotUsage(currentContext);
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentContext = ctx;
    ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, formatPlanUsage(cachedUsage) || undefined);
    void refreshUsage()
      .then((usage) => currentContext?.ui.setStatus(COPILOT_USAGE_STATUS_KEY, formatPlanUsage(usage)))
      .catch(() => {});
  });

  pi.on("agent_end", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentContext = ctx;
    void refreshUsage()
      .then((usage) => currentContext?.ui.setStatus(COPILOT_USAGE_STATUS_KEY, formatPlanUsage(usage)))
      .catch(() => {});
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus(COPILOT_USAGE_STATUS_KEY, undefined);
    currentContext = undefined;
  });

  pi.registerCommand("copilot-usage", {
    description: "Show GitHub Copilot plan and quota usage",
    handler: (_args, ctx) => showCopilotUsage(ctx),
  });

  pi.registerShortcut("super+shift+u", {
    description: "Show GitHub Copilot AI-credit usage",
    handler: (ctx) => showCopilotUsage(ctx),
  });
}
