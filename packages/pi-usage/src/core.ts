import { execFile } from "node:child_process";

type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
};

type UsageEntry = {
  type?: string;
  provider?: string;
  usage?: Usage;
  message?: { role?: string; provider?: string; usage?: Usage };
};

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

export type SessionUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
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

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return Math.round(tokens).toLocaleString("en-US");
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

export function writeClipboard(text: string, command = "pbcopy"): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, (error) => (error ? reject(error) : resolve()));
    child.stdin?.on("error", reject);
    child.stdin?.end(text);
  });
}

export function formatProgressBar(percent: number, width: number): string {
  const cells = Math.max(0, Math.floor(width));
  const value = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((value / 100) * cells);
  return `${"█".repeat(filled)}${"░".repeat(cells - filled)}`;
}

export function summarizeSession(entries: readonly unknown[], provider?: string): SessionUsage {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const add = (usage?: Usage) => {
    if (!usage) return;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      const value = usage[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) total[key] += value;
    }
    const cost = usage.cost?.total;
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) total.cost += cost;
  };

  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as UsageEntry;
    if (
      entry.type === "message" &&
      entry.message?.role === "assistant" &&
      (!provider || entry.message.provider === provider)
    ) {
      add(entry.message.usage);
    } else if (entry.type === "usage" && (!provider || entry.provider === provider)) {
      add(entry.usage);
    }
  }
  return total;
}
