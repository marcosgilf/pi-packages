import { describe, expect, it } from "vitest";
import { formatContextUsageIndicator, formatSessionUsageSummary, formatTokens, summarizeSession } from "../src/core.ts";

describe("session usage", () => {
  it("summarizes provider usage and formats token counts", () => {
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
      latestCacheHitRate: 31.25,
    });
    expect(summarizeSession(entries).input).toBe(114);
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(9_000)).toBe("9.0k");
    expect(formatTokens(17_000)).toBe("17k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(131_000_000)).toBe("131M");
  });

  it("includes tool and summary usage in session totals", () => {
    expect(
      summarizeSession([
        { type: "message", message: { role: "toolResult", usage: { input: 2, cost: { total: 0.01 } } } },
        { type: "compaction", usage: { output: 3, cacheRead: 4 } },
        { type: "branch_summary", usage: { cacheWrite: 5, cost: { total: 0.02 } } },
      ]),
    ).toEqual({ input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 0.03 });
  });

  it("formats context thresholds and session details", () => {
    expect(formatContextUsageIndicator(70, 1_000_000)).toEqual({ text: "70.0%/1.0M", style: "text" });
    expect(formatContextUsageIndicator(75.7, 1_000_000)).toEqual({ text: "75.7%/1.0M", style: "warning" });
    expect(formatContextUsageIndicator(90, 1_000_000)).toEqual({ text: "90.0%/1.0M", style: "warning" });
    expect(formatContextUsageIndicator(90.1, 1_000_000)).toEqual({ text: "90.1%/1.0M", style: "error" });
    expect(formatContextUsageIndicator(null, 1_000_000)).toEqual({ text: "?/1.0M", style: "dim" });

    const stats = {
      input: 891,
      output: 446_000,
      cacheRead: 131_000_000,
      cacheWrite: 4_900_000,
      cost: 3.947,
      latestCacheHitRate: 98.1,
    };
    const context = { percent: 10.2, tokens: 102_000, contextWindow: 1_000_000 };
    expect(formatSessionUsageSummary(stats, context, { subscription: true })).toEqual([
      "Session usage",
      "↑891 ↓446k R131M W4.9M CH98.1%",
      "$3.947 (sub)",
      "10.2%/1.0M (auto)",
    ]);
    expect(formatSessionUsageSummary(stats, context, { autoCompaction: false }).at(-1)).toBe("10.2%/1.0M");
  });
});
