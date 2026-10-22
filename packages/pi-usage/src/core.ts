export type CopilotUsage = {
  plan: string;
  unit: "AI credits" | "premium requests";
  used?: number;
  limit?: number;
  remaining?: number;
  percentUsed?: number;
  resetAt?: string;
  unlimited: boolean;
};

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

export function parseCopilotUsage(data: unknown): CopilotUsage {
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
  return {
    plan: planNames[planKey] ?? `Copilot ${rawPlan}`,
    unit: tokenBased ? "AI credits" : "premium requests",
    used,
    limit,
    remaining,
    percentUsed,
    resetAt: typeof account.quota_reset_date_utc === "string" ? account.quota_reset_date_utc : undefined,
    unlimited: snapshot.unlimited === true || snapshot.has_quota === false,
  };
}

export function formatPlanUsage(usage?: CopilotUsage): string {
  if (!usage) return "";
  return usage.unlimited ? `${usage.plan} ∞` : `${usage.plan} ${usage.percentUsed ?? 0}%`;
}

export function formatCredits(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function formatUsageSummary(usage: CopilotUsage): [string, string, string, string] {
  const percent = usage.percentUsed ?? 0;
  const quota = usage.unlimited
    ? `${usage.unit}: unlimited`
    : `${usage.unit} (resets monthly): ${formatCredits(usage.used)} / ${formatCredits(usage.limit)} (${percent}% used)`;
  const reset = usage.resetAt
    ? `Resets: ${new Date(usage.resetAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} UTC`
    : "Resets monthly";
  return ["Copilot usage and plan", `Plan: ${usage.plan}`, quota, reset];
}

export function getUsageProgress(usage: CopilotUsage): number | undefined {
  return usage.unlimited ? undefined : (usage.percentUsed ?? 0);
}
