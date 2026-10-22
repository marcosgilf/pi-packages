import { describe, expect, it } from "vitest";
import { formatPlanUsage, formatUsageSummary, getUsageProgress, parseCopilotUsage } from "../src/core.ts";

const enterpriseUsage = {
  copilot_plan: "enterprise",
  token_based_billing: true,
  quota_reset_date_utc: "2026-11-01T00:00:00.000Z",
  quota_snapshots: {
    premium_interactions: {
      token_based_billing: true,
      percent_remaining: 24,
      credits_used: 15192,
      entitlement: 20000,
      quota_remaining: 4810.5,
      unlimited: false,
      has_quota: true,
    },
  },
};

describe("Copilot usage", () => {
  it("parses account quota, plan, and reset date", () => {
    expect(parseCopilotUsage(enterpriseUsage)).toEqual({
      plan: "Copilot Enterprise",
      unit: "AI credits",
      used: 15192,
      limit: 20000,
      remaining: 4810.5,
      percentUsed: 76,
      resetAt: "2026-11-01T00:00:00.000Z",
      unlimited: false,
    });
  });

  it("parses legacy premium-request quota and unlimited accounts", () => {
    const legacy = parseCopilotUsage({
      copilot_plan: "pro",
      quota_snapshots: { premium_interactions: { percent_remaining: 80, entitlement: 300, quota_remaining: 240 } },
    });
    expect(legacy.unit).toBe("premium requests");
    expect(legacy.percentUsed).toBe(20);
    expect(legacy.plan).toBe("Copilot Pro");

    const unlimited = parseCopilotUsage({
      copilot_plan: "enterprise",
      quota_snapshots: { premium_interactions: { unlimited: true, has_quota: false } },
    });
    expect(unlimited.unlimited).toBe(true);
    expect(unlimited.percentUsed).toBeUndefined();
    expect(getUsageProgress(unlimited)).toBeUndefined();
  });

  it("rejects missing quota data", () => {
    expect(() => parseCopilotUsage({ copilot_plan: "enterprise" })).toThrow(/no Copilot usage quota/);
  });

  it("formats plan, quota, progress, and plain text", () => {
    const usage = parseCopilotUsage(enterpriseUsage);
    expect(formatPlanUsage()).toBe("");
    expect(formatPlanUsage(usage)).toBe("Copilot Enterprise 76%");
    expect(getUsageProgress(usage)).toBe(76);
    expect(formatUsageSummary(usage)).toEqual([
      "Copilot usage and plan",
      "Plan: Copilot Enterprise",
      "AI credits (resets monthly): 15,192 / 20,000 (76% used)",
      "Resets: Nov 1 UTC",
    ]);

    const unlimited = parseCopilotUsage({
      copilot_plan: "enterprise",
      quota_snapshots: { premium_interactions: { unlimited: true } },
    });
    expect(formatUsageSummary(unlimited)).toEqual([
      "Copilot usage and plan",
      "Plan: Copilot Enterprise",
      "premium requests: unlimited",
      "Resets monthly",
    ]);
  });
});
