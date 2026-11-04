import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ModalContent, showModal } from "@marcosgilf/pi-modal";
import { OPEN_OPENROUTER_USAGE_EVENT, OPENROUTER_USAGE_STATUS_KEY } from "./events.ts";
import type { UsageProvider, UsageSnapshot, UsageWindow } from "./usage-provider.ts";

const OPENROUTER_ORIGIN = "https://openrouter.ai";
const OPENROUTER_KEY_URL = `${OPENROUTER_ORIGIN}/api/v1/key`;
const CACHE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const budgetScopeNames: Record<string, string> = {
  api_key: "API-key",
  key_limit: "API-key",
  member: "Member",
  workspace: "Workspace",
  workspace_default_key: "Workspace default key",
  workspace_default_member: "Workspace default member",
};

type JsonObject = Record<string, unknown>;
type OpenRouterAuth = { apiKey: string; keyId: string; method: "openrouter-oauth" | "api-key" };

let cached: { keyId: string; snapshot: UsageSnapshot } | undefined;
let pending: { keyId: string; promise: Promise<UsageSnapshot> } | undefined;

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidData(): Error {
  return new Error("Invalid OpenRouter usage data.");
}

function readNumber(value: unknown, allowNegative = false): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value < 0)) throw invalidData();
  return value;
}

function readOptionalText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw invalidData();
  return value;
}

function readInterval(value: unknown): string | undefined {
  const interval = readOptionalText(value);
  return interval && ["daily", "weekly", "monthly", "yearly", "lifetime"].includes(interval) ? interval : undefined;
}

function readScope(value: unknown): string {
  const scope = readOptionalText(value);
  if (!scope) throw invalidData();
  return /^[a-z0-9_]+$/.test(scope) ? scope : "unknown";
}

function readResetAt(value: unknown): number | undefined {
  const reset = readOptionalText(value);
  if (reset === undefined) return undefined;
  const timestamp = Date.parse(reset);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function addSpendWindow(windows: UsageWindow[], data: JsonObject, field: string, limitId: string, label: string): void {
  const used = readNumber(data[field]);
  if (used !== undefined) windows.push({ limitId, label, used, unit: "USD" });
}

function budgetWindow(value: unknown, limitId: string, effective: boolean): UsageWindow {
  if (!isRecord(value)) throw invalidData();
  const scope = readScope(value.scope);
  const interval = readInterval(value.reset_interval);
  const limit = readNumber(value.limit_usd);
  const used = readNumber(value.spend_usd);
  const remaining = readNumber(value.remaining_usd, true);
  if (limit === undefined || used === undefined || remaining === undefined) throw invalidData();
  const resetAt = readResetAt(value.resets_at);
  const scopeName = budgetScopeNames[scope] ?? "OpenRouter";
  const byok = value.include_byok === true ? " (includes BYOK)" : "";
  const label = `${effective ? "Effective " : ""}${scopeName} budget${interval ? ` (${interval})` : ""}${byok}`;
  return {
    limitId,
    label,
    used,
    limit,
    remaining,
    usedPercent: limit > 0 ? (used / limit) * 100 : undefined,
    resetsAt: resetAt,
    unit: "USD",
  };
}

function parseFreeModelRequests(value: unknown): UsageWindow | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) throw invalidData();
  const limit = readNumber(value.limit);
  const remaining = readNumber(value.remaining, true);
  const used =
    readNumber(value.used) ?? (limit !== undefined && remaining !== undefined ? limit - remaining : undefined);
  if (limit === undefined || remaining === undefined || used === undefined) throw invalidData();
  return {
    limitId: "free_model_daily_requests",
    label: "Free-model requests today",
    used,
    limit,
    remaining,
    usedPercent: limit > 0 ? (used / limit) * 100 : undefined,
    unit: "requests",
  };
}

export function parseOpenRouterUsage(
  payload: unknown,
  authMethod: "openrouter-oauth" | "api-key",
  fetchedAt = Date.now(),
): UsageSnapshot {
  if (!isRecord(payload) || !isRecord(payload.data)) throw invalidData();
  const data = payload.data;
  if (data.budgets !== undefined && !Array.isArray(data.budgets)) throw invalidData();

  const windows: UsageWindow[] = [];
  addSpendWindow(windows, data, "usage_daily", "spend_daily", "OpenRouter credit spend today");
  addSpendWindow(windows, data, "usage_weekly", "spend_weekly", "OpenRouter credit spend this week");
  addSpendWindow(windows, data, "usage_monthly", "spend_monthly", "OpenRouter credit spend this month");
  addSpendWindow(windows, data, "byok_usage_daily", "byok_spend_daily", "External BYOK spend today");
  addSpendWindow(windows, data, "byok_usage_weekly", "byok_spend_weekly", "External BYOK spend this week");
  addSpendWindow(windows, data, "byok_usage_monthly", "byok_spend_monthly", "External BYOK spend this month");

  const budgets = (data.budgets as unknown[] | undefined) ?? [];
  const effective = data.effective_budget;
  if (effective !== null && effective !== undefined && !isRecord(effective)) throw invalidData();
  const effectiveRecord = isRecord(effective) ? effective : undefined;
  const seenIds = new Map<string, number>();
  let effectiveFound: boolean = false;
  for (const value of budgets) {
    if (!isRecord(value)) throw invalidData();
    const scope = readScope(value.scope);
    const interval = readInterval(value.reset_interval);
    const baseId = `budget_${scope}_${interval ?? "lifetime"}`;
    const index = seenIds.get(baseId) ?? 0;
    seenIds.set(baseId, index + 1);
    const isEffective: boolean =
      !effectiveFound &&
      effectiveRecord !== undefined &&
      value.scope === effectiveRecord.scope &&
      value.limit_usd === effectiveRecord.limit_usd &&
      value.spend_usd === effectiveRecord.spend_usd &&
      value.remaining_usd === effectiveRecord.remaining_usd &&
      value.reset_interval === effectiveRecord.reset_interval;
    const parsed = budgetWindow(
      value,
      isEffective ? "effective_budget" : index === 0 ? baseId : `${baseId}_${index + 1}`,
      isEffective,
    );
    windows.push(parsed);
    if (isEffective) effectiveFound = true;
  }
  if (effective !== null && effective !== undefined && !effectiveFound) {
    windows.push(budgetWindow(effective, "effective_budget", true));
  }

  const ownLimit = readNumber(data.limit);
  const ownRemaining = readNumber(data.limit_remaining, true);
  const effectiveScope = effectiveRecord ? readOptionalText(effectiveRecord.scope) : undefined;
  const hasKeyBudget = budgets.some(
    (value) => isRecord(value) && ["api_key", "key_limit"].includes(String(value.scope)),
  );
  if (
    ownLimit !== undefined &&
    ownRemaining !== undefined &&
    !hasKeyBudget &&
    effectiveScope !== "api_key" &&
    effectiveScope !== "key_limit"
  ) {
    const interval = readInterval(data.limit_reset);
    const used = Math.max(0, ownLimit - ownRemaining);
    windows.push({
      limitId: "key_limit",
      label: `API-key budget${interval ? ` (${interval})` : ""}`,
      used,
      limit: ownLimit,
      remaining: ownRemaining,
      usedPercent: ownLimit > 0 ? (used / ownLimit) * 100 : undefined,
      unit: "USD",
    });
  }

  const freeRequests = parseFreeModelRequests(data.free_model_daily_requests);
  if (freeRequests) windows.push(freeRequests);
  if (windows.length === 0) throw new Error("OpenRouter returned no usage or budget data.");

  return {
    providerId: "openrouter",
    authMethod,
    plan: data.is_free_tier === true ? "Free tier" : undefined,
    windows,
    fetchedAt,
    state: "available",
  };
}

async function resolveAuth(ctx: ExtensionContext): Promise<OpenRouterAuth | undefined> {
  const model = ctx.model;
  if (model?.provider !== "openrouter" || !ctx.modelRegistry.hasConfiguredAuth(model)) return undefined;
  try {
    if (new URL(model.baseUrl).origin !== OPENROUTER_ORIGIN) return undefined;
  } catch {
    return undefined;
  }
  const result = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!result.ok || !result.apiKey) return undefined;
  const method = ctx.modelRegistry.isUsingOAuth(model) ? "openrouter-oauth" : "api-key";
  return {
    apiKey: result.apiKey,
    keyId: createHash("sha256").update(`${method}\0${result.apiKey}`).digest("hex"),
    method,
  };
}

function safeError(error: unknown): string {
  if (error instanceof Error && /^OpenRouter usage request failed with HTTP \d+\.$/.test(error.message))
    return error.message;
  return "OpenRouter usage refresh failed.";
}

async function fetchUsage(auth: OpenRouterAuth, signal?: AbortSignal): Promise<UsageSnapshot> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(OPENROUTER_KEY_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${auth.apiKey}`, Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: requestSignal,
  });
  if (!response.ok) throw new Error(`OpenRouter usage request failed with HTTP ${response.status}.`);
  return parseOpenRouterUsage(await response.json(), auth.method);
}

async function fetchCachedUsage(
  auth: OpenRouterAuth,
  forceRefresh: boolean,
  signal?: AbortSignal,
): Promise<UsageSnapshot> {
  if (cached && cached.keyId !== auth.keyId) cached = undefined;
  if (!forceRefresh && cached?.keyId === auth.keyId && Date.now() - cached.snapshot.fetchedAt < CACHE_MS) {
    return cached.snapshot;
  }
  if (pending?.keyId === auth.keyId) return pending.promise;

  const promise = fetchUsage(auth, signal)
    .then((snapshot) => {
      if (pending?.promise === promise) cached = { keyId: auth.keyId, snapshot };
      return snapshot;
    })
    .catch((error: unknown) => {
      const message = safeError(error);
      if (cached?.keyId === auth.keyId) return { ...cached.snapshot, state: "stale" as const, error: message };
      throw new Error(message);
    })
    .finally(() => {
      if (pending?.promise === promise) pending = undefined;
    });
  pending = { keyId: auth.keyId, promise };
  return promise;
}

export function createOpenRouterUsageProvider(ctx: ExtensionContext, forceRefresh = false): UsageProvider {
  return {
    id: "openrouter",
    async fetchUsage(options): Promise<UsageSnapshot> {
      const model = ctx.model;
      if (model?.provider !== "openrouter") {
        return {
          providerId: "openrouter",
          windows: [],
          fetchedAt: Date.now(),
          state: "unsupported",
          error: "OpenRouter usage requires an active OpenRouter model.",
        };
      }
      let auth: OpenRouterAuth | undefined;
      try {
        auth = await resolveAuth(ctx);
      } catch {
        return {
          providerId: "openrouter",
          authMethod: "unconfigured",
          windows: [],
          fetchedAt: Date.now(),
          state: "unavailable",
          error: "OpenRouter authentication is not configured.",
        };
      }
      if (!auth) {
        let officialEndpoint = false;
        try {
          officialEndpoint = new URL(model.baseUrl).origin === OPENROUTER_ORIGIN;
        } catch {
          // Invalid custom endpoint.
        }
        return {
          providerId: "openrouter",
          authMethod: officialEndpoint ? "unconfigured" : "unsupported",
          windows: [],
          fetchedAt: Date.now(),
          state: officialEndpoint ? "unavailable" : "unsupported",
          error: officialEndpoint
            ? "OpenRouter authentication is not configured."
            : "OpenRouter usage requires the official OpenRouter API endpoint.",
        };
      }
      return fetchCachedUsage(auth, forceRefresh, options?.signal);
    },
  };
}

function formatUsd(value: number | undefined): string {
  return value === undefined ? "—" : USD.format(value);
}

export function formatOpenRouterUsageStatus(usage: UsageSnapshot): string {
  const monthly = usage.windows.find(({ limitId }) => limitId === "spend_monthly");
  const freeRequests = usage.windows.find(({ limitId }) => limitId === "free_model_daily_requests");
  const stale = usage.state === "stale" ? " · stale" : "";
  if (monthly?.used !== undefined) return `OpenRouter ${formatUsd(monthly.used)}/month${stale}`;
  if (freeRequests) return `OpenRouter free-model ${freeRequests.used ?? 0}/${freeRequests.limit ?? "—"} today${stale}`;
  return usage.authMethod === "unconfigured" ? "OpenRouter · auth not configured" : "OpenRouter usage unavailable";
}

export function formatOpenRouterUsageSummary(usage: UsageSnapshot): string[] {
  const authentication =
    usage.authMethod === "openrouter-oauth"
      ? "Sign in with OpenRouter"
      : usage.authMethod === "api-key"
        ? "OpenRouter API key"
        : usage.authMethod === "unconfigured"
          ? "Not configured"
          : "Unknown";
  const lines = ["OpenRouter API usage and budget", `Authentication: ${authentication}`];
  if (usage.plan) lines.push(`Plan: ${usage.plan}`);
  for (const [limitId, label] of [
    ["spend_daily", "today"],
    ["spend_weekly", "this week"],
    ["spend_monthly", "this month"],
  ]) {
    const window = usage.windows.find((candidate) => candidate.limitId === limitId);
    if (window?.used !== undefined) lines.push(`OpenRouter credit spend ${label}: ${formatUsd(window.used)}`);
  }
  for (const [limitId, label] of [
    ["byok_spend_daily", "today"],
    ["byok_spend_weekly", "this week"],
    ["byok_spend_monthly", "this month"],
  ]) {
    const window = usage.windows.find((candidate) => candidate.limitId === limitId);
    if (window?.used !== undefined) lines.push(`External BYOK spend ${label}: ${formatUsd(window.used)}`);
  }
  for (const window of usage.windows) {
    if (
      !window.limitId ||
      (!window.limitId.startsWith("budget_") && window.limitId !== "effective_budget" && window.limitId !== "key_limit")
    )
      continue;
    const reset = window.resetsAt === undefined ? "" : `; resets ${new Date(window.resetsAt).toISOString()}`;
    lines.push(
      `${window.label ?? "Budget"}: ${formatUsd(window.used)} / ${formatUsd(window.limit)} used; ${formatUsd(window.remaining)} remaining${reset}`,
    );
  }
  const freeRequests = usage.windows.find(({ limitId }) => limitId === "free_model_daily_requests");
  if (freeRequests) {
    lines.push(
      `Free-model requests today: ${freeRequests.used ?? "—"} / ${freeRequests.limit ?? "—"} used; ${freeRequests.remaining ?? "—"} remaining`,
    );
  }
  if (usage.error) lines.push(usage.error);
  lines.push("Key spend and budgets are not subscription quota or account credit balance.");
  lines.push("Request rate limits are not reported here.");
  return lines;
}

function buildUsageModal(usage: UsageSnapshot): ModalContent {
  const lines = formatOpenRouterUsageSummary(usage);
  return {
    rows: lines.map((text, index) => ({ text, ...(index === 0 ? { style: "accent" as const } : {}) })),
    clipboardText: lines.join("\n"),
  };
}

async function showOpenRouterUsage(ctx: ExtensionContext, isCurrent: () => boolean): Promise<void> {
  const unavailableMessage = "/openrouter-usage requires Pi TUI mode.";
  if (ctx.mode !== "tui") {
    ctx.ui.notify(unavailableMessage, "warning");
    return;
  }
  if (ctx.model?.provider !== "openrouter") {
    ctx.ui.notify("OpenRouter usage requires an active OpenRouter model.", "warning");
    return;
  }

  try {
    const usage = await createOpenRouterUsageProvider(ctx).fetchUsage();
    if (!isCurrent() || ctx.model?.provider !== "openrouter") return;
    ctx.ui.setStatus(OPENROUTER_USAGE_STATUS_KEY, formatOpenRouterUsageStatus(usage));
    await showModal(
      ctx,
      buildUsageModal(usage),
      {
        refresh: async () => {
          const updated = await createOpenRouterUsageProvider(ctx, true).fetchUsage();
          if (!isCurrent() || ctx.model?.provider !== "openrouter") {
            throw new Error("Session or active model changed during usage refresh.");
          }
          ctx.ui.setStatus(OPENROUTER_USAGE_STATUS_KEY, formatOpenRouterUsageStatus(updated));
          return buildUsageModal(updated);
        },
      },
      unavailableMessage,
    );
  } catch (error) {
    if (isCurrent()) ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export default function registerOpenRouterUsage(pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined;
  let sessionGeneration = 0;
  let modelGeneration = 0;
  const isCurrent = (session: number, model: number) => () =>
    session === sessionGeneration && model === modelGeneration;

  const updateActiveStatus = (ctx: ExtensionContext, session: number, model: number, clear = true) => {
    if (ctx.model?.provider !== "openrouter") {
      ctx.ui.setStatus(OPENROUTER_USAGE_STATUS_KEY, undefined);
      return;
    }
    if (clear) ctx.ui.setStatus(OPENROUTER_USAGE_STATUS_KEY, undefined);
    void createOpenRouterUsageProvider(ctx)
      .fetchUsage()
      .then((usage) => {
        if (isCurrent(session, model)() && ctx.model?.provider === "openrouter") {
          ctx.ui.setStatus(OPENROUTER_USAGE_STATUS_KEY, formatOpenRouterUsageStatus(usage));
        }
      })
      .catch(() => {});
  };

  pi.events.on(OPEN_OPENROUTER_USAGE_EVENT, () => {
    if (currentContext) void showOpenRouterUsage(currentContext, isCurrent(sessionGeneration, modelGeneration));
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
    if (ctx.mode === "tui") ctx.ui.setStatus(OPENROUTER_USAGE_STATUS_KEY, undefined);
    currentContext = undefined;
  });

  pi.registerCommand("openrouter-usage", {
    description: "Show OpenRouter key usage and budget",
    handler: (_args, ctx) => showOpenRouterUsage(ctx, isCurrent(sessionGeneration, modelGeneration)),
  });
}
