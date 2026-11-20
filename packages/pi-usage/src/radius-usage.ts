import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ModalContent, showModal } from "@marcosgilf/pi-modal";
import { OPEN_RADIUS_USAGE_EVENT, RADIUS_USAGE_STATUS_KEY } from "./events.ts";
import type { UsageProvider, UsageSnapshot, UsageWindow } from "./usage-provider.ts";

const RADIUS_ORIGIN = "https://radius.pi.dev";
const CACHE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const periodNames: Record<string, string> = {
  five_hours: "5 hours",
  day: "day",
  week: "week",
  month: "month",
};

type JsonObject = Record<string, unknown>;
type RadiusAuth = { token: string; keyId: string; orgId: string; method: "radius-oauth" | "api-key" };

let cached: { keyId: string; snapshot: UsageSnapshot } | undefined;
let pending: { keyId: string; promise: Promise<UsageSnapshot> } | undefined;

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidData(): Error {
  return new Error("Invalid Radius usage data.");
}

function readNumber(value: unknown, allowNegative = false): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value < 0)) throw invalidData();
  return value;
}

function readRequiredNumber(value: unknown, allowNegative = false): number {
  const parsed = readNumber(value, allowNegative);
  if (parsed === undefined) throw invalidData();
  return parsed;
}

function readText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw invalidData();
  return value;
}

function readResetAt(value: unknown): number | undefined {
  const reset = readText(value);
  if (reset === undefined) return undefined;
  const timestamp = Date.parse(reset);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function readOrgId(token: string): string | undefined {
  // Radius access tokens are `piga.<header>.<payload>.<signature>`; plain JWTs have three segments.
  const segments = token.split(".");
  const payload = segments.length === 4 ? segments[2] : segments.length === 3 ? segments[1] : undefined;
  if (!payload) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!isRecord(claims)) return undefined;
    const orgId = claims.account_id;
    return typeof orgId === "string" && /^org_[A-Za-z0-9_-]+$/.test(orgId) ? orgId : undefined;
  } catch {
    return undefined;
  }
}

function budgetLimitWindows(budget: JsonObject, value: unknown): UsageWindow[] {
  if (!Array.isArray(value)) throw invalidData();
  const id = readText(budget.id);
  const name = readText(budget.name) ?? "Budget";
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw invalidData();
  const windows: UsageWindow[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw invalidData();
    const period = readText(entry.period);
    if (!period || !(period in periodNames)) throw invalidData();
    const perMember = entry.perMember;
    const shared = entry.shared;
    if (perMember !== null && !isRecord(perMember)) throw invalidData();
    if (shared !== null && !isRecord(shared)) throw invalidData();
    const source =
      isRecord(perMember) && perMember.kind === "principal"
        ? perMember
        : isRecord(shared)
          ? shared
          : isRecord(perMember) && perMember.kind === "average" && perMember.used !== null
            ? perMember
            : undefined;
    if (!source) continue;
    const limit = readRequiredNumber(source.limit);
    const used = readRequiredNumber(source.used);
    const remaining = Math.max(0, limit - used);
    windows.push({
      limitId: `budget_${id}_${period}`,
      label: `${name} budget (${periodNames[period]})`,
      used,
      limit,
      remaining,
      usedPercent: limit > 0 ? (used / limit) * 100 : undefined,
      resetsAt: readResetAt(source.resetAt) ?? undefined,
      unit: "USD",
    });
  }
  return windows;
}

export function parseRadiusUsage(
  billing: unknown,
  budgets: unknown,
  auth: RadiusAuth,
  fetchedAt = Date.now(),
): UsageSnapshot {
  if (!isRecord(billing) || !isRecord(billing.balance) || !isRecord(billing.current_period)) throw invalidData();
  const available = readRequiredNumber(billing.balance.available, true);
  const reserved = readNumber(billing.balance.reserved) ?? 0;
  const creditBalance = readRequiredNumber(billing.balance.credit_balance, true);
  const monthlyCharges = readRequiredNumber(billing.current_period.actual_charged);
  const periodEndsAt = readResetAt(billing.current_period.ends_at);

  const windows: UsageWindow[] = [
    {
      limitId: "spend_monthly",
      label: "Radius charges this month",
      used: monthlyCharges,
      resetsAt: periodEndsAt,
      unit: "USD",
    },
    {
      limitId: "credit_balance",
      label: "Credit balance",
      used: Math.max(0, creditBalance - available),
      limit: creditBalance >= 0 ? creditBalance : undefined,
      remaining: available,
      usedPercent: creditBalance > 0 ? Math.max(0, ((creditBalance - available) / creditBalance) * 100) : undefined,
      unit: "USD",
    },
  ];
  if (reserved > 0) {
    windows.push({ limitId: "reserved_balance", label: "Reserved for in-flight usage", used: reserved, unit: "USD" });
  }

  if (budgets !== undefined) {
    if (!isRecord(budgets) || !isRecord(budgets.overview) || !Array.isArray(budgets.overview.budgets))
      throw invalidData();
    for (const entry of budgets.overview.budgets) {
      if (!isRecord(entry) || !isRecord(entry.budget)) throw invalidData();
      windows.push(...budgetLimitWindows(entry.budget, entry.limits));
    }
  }

  return {
    providerId: "radius",
    accountId: auth.orgId,
    authMethod: auth.method,
    windows,
    fetchedAt,
    state: "available",
  };
}

async function resolveAuth(ctx: ExtensionContext): Promise<RadiusAuth | undefined> {
  const model = ctx.model;
  if (model?.provider !== "radius" || !ctx.modelRegistry.hasConfiguredAuth(model)) return undefined;
  try {
    if (new URL(model.baseUrl).origin !== RADIUS_ORIGIN) return undefined;
  } catch {
    return undefined;
  }
  const result = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!result.ok || !result.apiKey) return undefined;
  const orgId = readOrgId(result.apiKey);
  if (!orgId) return undefined;
  const method = ctx.modelRegistry.isUsingOAuth(model) ? "radius-oauth" : "api-key";
  return {
    token: result.apiKey,
    keyId: createHash("sha256").update(`${method}\0${result.apiKey}`).digest("hex"),
    orgId,
    method,
  };
}

function safeError(error: unknown): string {
  if (error instanceof Error && /^Radius usage request failed with HTTP \d+\.$/.test(error.message))
    return error.message;
  return "Radius usage refresh failed.";
}

async function fetchJson(auth: RadiusAuth, path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${RADIUS_ORIGIN}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error(`Radius usage request failed with HTTP ${response.status}.`);
  return response.json();
}

async function fetchUsage(auth: RadiusAuth, signal?: AbortSignal): Promise<UsageSnapshot> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const base = `/v1/organizations/${auth.orgId}`;
  const [billing, budgets] = await Promise.all([
    fetchJson(auth, `${base}/billing`, requestSignal),
    fetchJson(auth, `${base}/budgets/usage`, requestSignal),
  ]);
  return parseRadiusUsage(billing, budgets, auth);
}

async function fetchCachedUsage(auth: RadiusAuth, forceRefresh: boolean, signal?: AbortSignal): Promise<UsageSnapshot> {
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

export function createRadiusUsageProvider(ctx: ExtensionContext, forceRefresh = false): UsageProvider {
  return {
    id: "radius",
    async fetchUsage(options): Promise<UsageSnapshot> {
      const model = ctx.model;
      if (model?.provider !== "radius") {
        return {
          providerId: "radius",
          windows: [],
          fetchedAt: Date.now(),
          state: "unsupported",
          error: "Radius usage requires an active Radius model.",
        };
      }
      let auth: RadiusAuth | undefined;
      try {
        auth = await resolveAuth(ctx);
      } catch {
        return {
          providerId: "radius",
          authMethod: "unconfigured",
          windows: [],
          fetchedAt: Date.now(),
          state: "unavailable",
          error: "Radius authentication is not configured.",
        };
      }
      if (!auth) {
        let officialEndpoint = false;
        try {
          officialEndpoint = new URL(model.baseUrl).origin === RADIUS_ORIGIN;
        } catch {
          // Invalid custom endpoint.
        }
        return {
          providerId: "radius",
          authMethod: officialEndpoint ? "unconfigured" : "unsupported",
          windows: [],
          fetchedAt: Date.now(),
          state: officialEndpoint ? "unavailable" : "unsupported",
          error: officialEndpoint
            ? "Radius authentication is not configured."
            : "Radius usage requires the official Radius API endpoint.",
        };
      }
      return fetchCachedUsage(auth, forceRefresh, options?.signal);
    },
  };
}

function formatUsd(value: number | undefined): string {
  return value === undefined ? "—" : USD.format(value);
}

export function formatRadiusUsageStatus(usage: UsageSnapshot): string {
  const balance = usage.windows.find(({ limitId }) => limitId === "credit_balance");
  const monthly = usage.windows.find(({ limitId }) => limitId === "spend_monthly");
  const stale = usage.state === "stale" ? " · stale" : "";
  if (balance?.remaining !== undefined) return `Radius ${formatUsd(balance.remaining)} available${stale}`;
  if (monthly?.used !== undefined) return `Radius ${formatUsd(monthly.used)}/month${stale}`;
  return usage.authMethod === "unconfigured" ? "Radius · auth not configured" : "Radius usage unavailable";
}

export function formatRadiusUsageSummary(usage: UsageSnapshot): string[] {
  const authentication =
    usage.authMethod === "radius-oauth"
      ? "Sign in with Radius"
      : usage.authMethod === "api-key"
        ? "Radius API key"
        : usage.authMethod === "unconfigured"
          ? "Not configured"
          : "Unknown";
  const lines = ["Radius usage and credit balance", `Authentication: ${authentication}`];
  if (usage.accountId) lines.push(`Organization: ${usage.accountId}`);
  const monthly = usage.windows.find(({ limitId }) => limitId === "spend_monthly");
  if (monthly?.used !== undefined) {
    const ends = monthly.resetsAt === undefined ? "" : `; period ends ${new Date(monthly.resetsAt).toISOString()}`;
    lines.push(`Charges this month: ${formatUsd(monthly.used)}${ends}`);
  }
  const balance = usage.windows.find(({ limitId }) => limitId === "credit_balance");
  const reserved = usage.windows.find(({ limitId }) => limitId === "reserved_balance");
  if (balance) {
    const reservedText = reserved?.used ? ` (${formatUsd(reserved.used)} reserved)` : "";
    lines.push(`Credit balance: ${formatUsd(balance.limit)}; ${formatUsd(balance.remaining)} available${reservedText}`);
  }
  for (const window of usage.windows) {
    if (!window.limitId?.startsWith("budget_")) continue;
    const reset = window.resetsAt === undefined ? "" : `; resets ${new Date(window.resetsAt).toISOString()}`;
    lines.push(
      `${window.label ?? "Budget"}: ${formatUsd(window.used)} / ${formatUsd(window.limit)} used; ${formatUsd(window.remaining)} remaining${reset}`,
    );
  }
  if (usage.error) lines.push(usage.error);
  lines.push("Recent gateway usage settles asynchronously; the available balance is authoritative.");
  lines.push("Request rate limits are not reported here.");
  return lines;
}

function buildUsageModal(usage: UsageSnapshot): ModalContent {
  const lines = formatRadiusUsageSummary(usage);
  return {
    rows: lines.map((text, index) => ({ text, ...(index === 0 ? { style: "accent" as const } : {}) })),
    clipboardText: lines.join("\n"),
  };
}

async function showRadiusUsage(ctx: ExtensionContext, isCurrent: () => boolean): Promise<void> {
  const unavailableMessage = "/radius-usage requires Pi TUI mode.";
  if (ctx.mode !== "tui") {
    ctx.ui.notify(unavailableMessage, "warning");
    return;
  }
  if (ctx.model?.provider !== "radius") {
    ctx.ui.notify("Radius usage requires an active Radius model.", "warning");
    return;
  }

  try {
    const usage = await createRadiusUsageProvider(ctx).fetchUsage();
    if (!isCurrent() || ctx.model?.provider !== "radius") return;
    ctx.ui.setStatus(RADIUS_USAGE_STATUS_KEY, formatRadiusUsageStatus(usage));
    await showModal(
      ctx,
      buildUsageModal(usage),
      {
        refresh: async () => {
          const updated = await createRadiusUsageProvider(ctx, true).fetchUsage();
          if (!isCurrent() || ctx.model?.provider !== "radius") {
            throw new Error("Session or active model changed during usage refresh.");
          }
          ctx.ui.setStatus(RADIUS_USAGE_STATUS_KEY, formatRadiusUsageStatus(updated));
          return buildUsageModal(updated);
        },
      },
      unavailableMessage,
    );
  } catch (error) {
    if (isCurrent()) ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export default function registerRadiusUsage(pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined;
  let sessionGeneration = 0;
  let modelGeneration = 0;
  const isCurrent = (session: number, model: number) => () =>
    session === sessionGeneration && model === modelGeneration;

  const updateActiveStatus = (ctx: ExtensionContext, session: number, model: number, clear = true) => {
    if (ctx.model?.provider !== "radius") {
      ctx.ui.setStatus(RADIUS_USAGE_STATUS_KEY, undefined);
      return;
    }
    if (clear) ctx.ui.setStatus(RADIUS_USAGE_STATUS_KEY, undefined);
    void createRadiusUsageProvider(ctx)
      .fetchUsage()
      .then((usage) => {
        if (isCurrent(session, model)() && ctx.model?.provider === "radius") {
          ctx.ui.setStatus(RADIUS_USAGE_STATUS_KEY, formatRadiusUsageStatus(usage));
        }
      })
      .catch(() => {});
  };

  pi.events.on(OPEN_RADIUS_USAGE_EVENT, () => {
    if (currentContext) void showRadiusUsage(currentContext, isCurrent(sessionGeneration, modelGeneration));
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
    if (ctx.mode === "tui") ctx.ui.setStatus(RADIUS_USAGE_STATUS_KEY, undefined);
    currentContext = undefined;
  });

  pi.registerCommand("radius-usage", {
    description: "Show Radius usage and credit balance",
    handler: (_args, ctx) => showRadiusUsage(ctx, isCurrent(sessionGeneration, modelGeneration)),
  });
}
