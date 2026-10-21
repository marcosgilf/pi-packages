import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatContextUsageIndicator,
  formatPlanUsage,
  formatProgressBar,
  formatSessionUsageSummary,
  formatTokens,
  formatUsageSummary,
  getUsageProgress,
  parseCopilotUsage,
  summarizeSession,
  writeClipboard,
} from "../src/core.ts";

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

  it("formats plan, quota, progress, and plain clipboard text", () => {
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
    expect(formatProgressBar(50, 8)).toBe("████░░░░");
    expect(formatProgressBar(125, 3)).toBe("███");
    expect(formatProgressBar(75, 0)).toBe("");

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

  it("keeps the footer context colors at Pi's usage thresholds", () => {
    expect(formatContextUsageIndicator(70, 1_000_000)).toEqual({ text: "70.0%/1.0M", style: "text" });
    expect(formatContextUsageIndicator(75.7, 1_000_000)).toEqual({ text: "75.7%/1.0M", style: "warning" });
    expect(formatContextUsageIndicator(90, 1_000_000)).toEqual({ text: "90.0%/1.0M", style: "warning" });
    expect(formatContextUsageIndicator(90.1, 1_000_000)).toEqual({ text: "90.1%/1.0M", style: "error" });
    expect(formatContextUsageIndicator(null, 1_000_000)).toEqual({ text: "?/1.0M", style: "dim" });
  });

  it("formats footer token, cache, cost, and context details for the modal", () => {
    expect(
      formatSessionUsageSummary(
        { input: 1000, output: 300, cacheRead: 600, cacheWrite: 200, cost: 0.04 },
        { percent: 75.7, tokens: 757_000, contextWindow: 1_000_000 },
      ),
    ).toEqual([
      "Session usage",
      "Tokens ↑1.8K (600 cached)",
      "Tokens ↓300",
      "Cache write: 200",
      "Cost: $0.040",
      "Context: 75.7% · 757.0K / 1.0M",
    ]);
  });

  it("writes clipboard text and reports command failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-usage-test-"));
    try {
      const output = join(directory, "clipboard.txt");
      const successCommand = join(directory, "pbcopy-success");
      const failureCommand = join(directory, "pbcopy-failure");
      await writeFile(
        successCommand,
        `#!${process.execPath}\nconst fs = require("node:fs"); process.stdin.pipe(fs.createWriteStream(${JSON.stringify(output)}));\n`,
        { mode: 0o755 },
      );
      await writeFile(
        failureCommand,
        `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on("end", () => process.exit(7));\n`,
        { mode: 0o755 },
      );
      const text = "Copilot usage and plan\nPlan: Copilot Enterprise";
      await writeClipboard(text, successCommand);
      expect(await readFile(output, "utf8")).toBe(text);
      await expect(writeClipboard(text, failureCommand)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("summarizes provider usage and whole-session footer stats", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          provider: "github-copilot",
          usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 1, cost: { total: 0.03 } },
        },
      },
      { type: "usage", provider: "github-copilot", usage: { input: 4, output: 1, cost: { total: 0.01 } } },
      {
        type: "message",
        message: { role: "assistant", provider: "openai", usage: { input: 100, output: 100, cost: { total: 1 } } },
      },
    ];

    expect(summarizeSession(entries, "github-copilot")).toEqual({
      input: 14,
      output: 3,
      cacheRead: 5,
      cacheWrite: 1,
      cost: 0.04,
    });
    expect(summarizeSession(entries).input).toBe(114);
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(17_000)).toBe("17.0K");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });
});
