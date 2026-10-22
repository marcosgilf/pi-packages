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

export type SessionUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  latestCacheHitRate?: number;
};

export type ContextUsageStyle = "error" | "warning" | "text" | "dim";

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return tokens.toString();
  if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  if (tokens < 10_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${Math.round(tokens / 1_000_000)}M`;
}

export function getContextUsageStyle(percent: number | null): ContextUsageStyle {
  return percent === null ? "dim" : percent > 90 ? "error" : percent > 70 ? "warning" : "text";
}

export function formatContextUsageIndicator(
  percent: number | null,
  contextWindow: number,
): {
  text: string;
  style: ContextUsageStyle;
} {
  const label = percent === null ? "?" : `${percent.toFixed(1)}%`;
  return { text: `${label}/${formatTokens(contextWindow)}`, style: getContextUsageStyle(percent) };
}

export function formatSessionUsageSummary(
  stats: SessionUsage,
  context?: { percent: number | null; contextWindow: number },
  options: { subscription?: boolean; autoCompaction?: boolean } = {},
): string[] {
  const tokens = [
    stats.input > 0 ? `↑${formatTokens(stats.input)}` : undefined,
    stats.output > 0 ? `↓${formatTokens(stats.output)}` : undefined,
    stats.cacheRead > 0 ? `R${formatTokens(stats.cacheRead)}` : undefined,
    stats.cacheWrite > 0 ? `W${formatTokens(stats.cacheWrite)}` : undefined,
    (stats.cacheRead > 0 || stats.cacheWrite > 0) && stats.latestCacheHitRate !== undefined
      ? `CH${stats.latestCacheHitRate.toFixed(1)}%`
      : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
  const lines = ["Session usage", tokens || "No token usage in this session"];
  if (stats.cost > 0 || options.subscription) {
    lines.push(`$${stats.cost.toFixed(3)}${options.subscription ? " (sub)" : ""}`);
  }
  const auto = options.autoCompaction === false ? "" : " (auto)";
  lines.push(
    context
      ? `${context.percent === null ? "?" : `${context.percent.toFixed(1)}%`}/${formatTokens(context.contextWindow)}${auto}`
      : `Context unavailable${auto}`,
  );
  return lines;
}

export function summarizeSession(entries: readonly unknown[], provider?: string): SessionUsage {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let latestCacheHitRate: number | undefined;
  let sawAssistantUsage = false;
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
      const usage = entry.message.usage;
      add(usage);
      if (usage) {
        sawAssistantUsage = true;
        const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
        latestCacheHitRate = promptTokens > 0 ? ((usage.cacheRead ?? 0) / promptTokens) * 100 : undefined;
      }
    } else if (
      entry.type === "message" &&
      entry.message?.role === "toolResult" &&
      (!provider || entry.message.provider === provider)
    ) {
      add(entry.message.usage);
    } else if (entry.type === "usage" && (!provider || entry.provider === provider)) {
      add(entry.usage);
    } else if (!provider && (entry.type === "compaction" || entry.type === "branch_summary")) {
      add(entry.usage);
    }
  }
  return {
    ...total,
    ...(sawAssistantUsage ? { latestCacheHitRate } : {}),
  };
}
