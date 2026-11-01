import type { UsageSnapshot, UsageWindow } from "./usage-provider.ts";

const planNames: Record<string, string> = {
  business: "Copilot Business",
  enterprise: "Copilot Enterprise",
  free: "Copilot Free",
  individual: "Copilot Individual",
  pro: "Copilot Pro",
  pro_plus: "Copilot Pro+",
  max: "Copilot Max",
};

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseCopilotUsage(data: unknown, fetchedAt = Date.now()): UsageSnapshot {
  if (!data || typeof data !== "object") throw new Error("GitHub returned invalid Copilot usage data.");
  const account = data as {
    copilot_plan?: unknown;
    token_based_billing?: unknown;
    quota_reset_date_utc?: unknown;
    quota_snapshots?: { premium_interactions?: unknown };
  };
  const quota = account.quota_snapshots?.premium_interactions;
  if (!quota || typeof quota !== "object") throw new Error("GitHub returned no Copilot usage quota.");

  const snapshot = quota as {
    percent_remaining?: unknown;
    credits_used?: unknown;
    entitlement?: unknown;
    quota_remaining?: unknown;
    remaining?: unknown;
    token_based_billing?: unknown;
    unlimited?: unknown;
    has_quota?: unknown;
  };
  const limit = numberOrUndefined(snapshot.entitlement);
  const remaining = numberOrUndefined(snapshot.quota_remaining) ?? numberOrUndefined(snapshot.remaining);
  const used =
    numberOrUndefined(snapshot.credits_used) ??
    (limit !== undefined && remaining !== undefined ? Math.max(0, limit - remaining) : undefined);
  const percentRemaining = numberOrUndefined(snapshot.percent_remaining);
  if (percentRemaining !== undefined && percentRemaining > 100)
    throw new Error("GitHub returned an invalid Copilot quota percentage.");
  const ratioPercent = used !== undefined && limit && limit > 0 ? Math.round((used / limit) * 100) : undefined;
  const percentUsed =
    snapshot.unlimited === true || snapshot.has_quota === false
      ? undefined
      : ratioPercent !== undefined && ratioPercent > 100
        ? ratioPercent
        : percentRemaining !== undefined
          ? Math.round(100 - percentRemaining)
          : ratioPercent;
  if (percentUsed === undefined && snapshot.unlimited !== true && snapshot.has_quota !== false) {
    throw new Error("GitHub returned no Copilot usage percentage.");
  }

  const rawPlan = typeof account.copilot_plan === "string" ? account.copilot_plan : "unknown";
  const planKey = rawPlan
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const tokenBased = snapshot.token_based_billing === true || account.token_based_billing === true;
  const resetAt = typeof account.quota_reset_date_utc === "string" ? Date.parse(account.quota_reset_date_utc) : NaN;
  const window: UsageWindow = {
    limitId: "premium_interactions",
    unit: tokenBased ? "AI credits" : "premium requests",
    used,
    limit,
    remaining,
    usedPercent: percentUsed,
    resetsAt: Number.isFinite(resetAt) ? resetAt : undefined,
    unlimited: snapshot.unlimited === true || snapshot.has_quota === false,
  };
  return {
    providerId: "github-copilot",
    authMethod: "github-cli",
    plan: planNames[planKey] ?? `Copilot ${rawPlan}`,
    windows: [window],
    fetchedAt,
    state: "available",
  };
}

export function formatPlanUsage(usage?: UsageSnapshot): string {
  if (!usage) return "";
  const window = usage.windows[0];
  const plan = usage.plan ?? "unknown";
  return window?.unlimited ? `${plan} ∞` : `${plan} ${window?.usedPercent ?? 0}%`;
}

export function formatCredits(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function formatUsageSummary(usage: UsageSnapshot): [string, string, string, string] {
  const window = usage.windows[0];
  const percent = window?.usedPercent ?? 0;
  const unit = window?.unit ?? "usage";
  const quota = window?.unlimited
    ? `${unit}: unlimited`
    : `${unit} (resets monthly): ${formatCredits(window?.used)} / ${formatCredits(window?.limit)} (${percent}% used)`;
  const reset =
    window?.resetsAt !== undefined
      ? `Resets: ${new Date(window.resetsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} UTC`
      : "Resets monthly";
  return ["Copilot usage and plan", `Plan: ${usage.plan ?? "unknown"}`, quota, reset];
}

export function getUsageProgress(usage: UsageSnapshot): number | undefined {
  const window = usage.windows[0];
  return window?.unlimited ? undefined : (window?.usedPercent ?? 0);
}
