import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenRouterUsageProvider,
  formatOpenRouterUsageStatus,
  formatOpenRouterUsageSummary,
  parseOpenRouterUsage,
} from "../src/openrouter-usage.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const keyResponse = {
  data: {
    label: "sk-or-v1-hidden-key-label",
    limit: 100,
    limit_remaining: 74.5,
    limit_reset: "monthly",
    usage: 25.5,
    usage_daily: 1.25,
    usage_weekly: 8.5,
    usage_monthly: 25.5,
    byok_usage: 2,
    byok_usage_daily: 0.25,
    byok_usage_weekly: 0.75,
    byok_usage_monthly: 2,
    is_free_tier: false,
    is_management_key: false,
    budgets: [
      {
        budget_id: null,
        guardrail_id: "guardrail-private-id",
        scope: "member",
        limit_usd: 50,
        spend_usd: 32.5,
        remaining_usd: 17.5,
        reset_interval: "weekly",
        resets_at: "2026-11-09T00:00:00.000Z",
        include_byok: false,
      },
    ],
    effective_budget: {
      budget_id: null,
      guardrail_id: "guardrail-private-id",
      scope: "member",
      limit_usd: 50,
      spend_usd: 32.5,
      remaining_usd: 17.5,
      reset_interval: "weekly",
      resets_at: "2026-11-09T00:00:00.000Z",
      include_byok: false,
    },
    free_model_daily_requests: { limit: 50, remaining: 38, used: 12 },
    rate_limit: { interval: "1h", requests: -1, note: "deprecated" },
  },
};

function openRouterContext(options: { configured?: boolean; apiKey?: string; baseUrl?: string } = {}) {
  const modelRegistry = {
    hasConfiguredAuth: vi.fn(() => options.configured !== false),
    isUsingOAuth: vi.fn(() => true),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: true as const, apiKey: options.apiKey ?? "test-openrouter-key" })),
  };
  const ctx = {
    model: {
      id: "openai/gpt-4.1",
      provider: "openrouter",
      baseUrl: options.baseUrl ?? "https://openrouter.ai/api/v1",
    },
    modelRegistry,
  } as unknown as ExtensionContext;
  return { ctx, modelRegistry };
}

describe("OpenRouter usage provider", () => {
  it("parses credit spend, effective budget, and free-model allowance separately from rate limits", () => {
    const usage = parseOpenRouterUsage(keyResponse, "openrouter-oauth", 1_800_000_000_000);

    expect(usage).toMatchObject({
      providerId: "openrouter",
      authMethod: "openrouter-oauth",
      fetchedAt: 1_800_000_000_000,
      state: "available",
    });
    expect(usage).not.toHaveProperty("accountId");
    expect(JSON.stringify(usage)).not.toContain("sk-or-v1");
    expect(JSON.stringify(usage)).not.toContain("guardrail-private-id");
    expect(usage.windows.find(({ limitId }) => limitId === "spend_monthly")).toMatchObject({
      label: "OpenRouter credit spend this month",
      used: 25.5,
      unit: "USD",
    });
    expect(usage.windows.find(({ limitId }) => limitId === "byok_spend_monthly")).toMatchObject({
      label: "External BYOK spend this month",
      used: 2,
      unit: "USD",
    });
    expect(usage.windows.find(({ limitId }) => limitId === "effective_budget")).toMatchObject({
      label: "Effective Member budget (weekly)",
      used: 32.5,
      limit: 50,
      remaining: 17.5,
      usedPercent: 65,
      resetsAt: Date.parse("2026-11-09T00:00:00.000Z"),
      unit: "USD",
    });
    expect(usage.windows.find(({ limitId }) => limitId === "free_model_daily_requests")).toMatchObject({
      label: "Free-model requests today",
      used: 12,
      limit: 50,
      remaining: 38,
      usedPercent: 24,
      unit: "requests",
    });
    expect(usage.windows.some(({ limitId }) => limitId?.includes("rate_limit"))).toBe(false);
    expect(formatOpenRouterUsageStatus(usage)).toBe("OpenRouter $25.50/month");
    expect(formatOpenRouterUsageSummary(usage).some((line) => line.includes("resets 2026-11-09T00:00:00.000Z"))).toBe(
      true,
    );
    expect(formatOpenRouterUsageSummary(usage)).toContain(
      "Key spend and budgets are not subscription quota or account credit balance.",
    );
    expect(formatOpenRouterUsageSummary(usage)).toContain("Request rate limits are not reported here.");
  });

  it("uses Pi's configured key only with OpenRouter's official key endpoint", async () => {
    const { ctx, modelRegistry } = openRouterContext({ apiKey: "secret-test-key" });
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(keyResponse), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    const usage = await createOpenRouterUsageProvider(ctx, true).fetchUsage();
    const [input, init] = fetch.mock.calls[0] ?? [];

    expect(usage.providerId).toBe("openrouter");
    expect(modelRegistry.getApiKeyAndHeaders).toHaveBeenCalledOnce();
    expect(String(input)).toBe("https://openrouter.ai/api/v1/key");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret-test-key", Accept: "application/json" });
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not call OpenRouter when auth is missing or model endpoint is custom", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const missingAuth = openRouterContext({ configured: false });
    const missing = await createOpenRouterUsageProvider(missingAuth.ctx).fetchUsage();
    expect(missing.state).toBe("unavailable");
    expect(missingAuth.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();

    const customEndpoint = openRouterContext({ baseUrl: "https://proxy.example/api/v1" });
    const custom = await createOpenRouterUsageProvider(customEndpoint.ctx).fetchUsage();
    expect(custom.state).toBe("unsupported");
    expect(customEndpoint.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caches per key and returns stale data without exposing a failed response body", async () => {
    const { ctx } = openRouterContext({ apiKey: "cache-stale-test-key" });
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(keyResponse), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    const first = await createOpenRouterUsageProvider(ctx).fetchUsage();
    const cached = await createOpenRouterUsageProvider(ctx).fetchUsage();
    expect(fetch).toHaveBeenCalledOnce();
    expect(cached.fetchedAt).toBe(first.fetchedAt);

    fetch.mockImplementationOnce(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("private refresh body", { status: 503 }),
    );
    const stale = await createOpenRouterUsageProvider(ctx, true).fetchUsage();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(stale.state).toBe("stale");
    expect(stale.windows).toEqual(first.windows);
    expect(stale.error).toBe("OpenRouter usage request failed with HTTP 503.");
    expect(JSON.stringify(stale)).not.toContain("private refresh body");
  });

  it("reports HTTP errors without exposing OpenRouter response bodies", async () => {
    const { ctx } = openRouterContext({ apiKey: "unique-error-key" });
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("private error body", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(createOpenRouterUsageProvider(ctx, true).fetchUsage()).rejects.toThrow("HTTP 401");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects malformed spend and budget data rather than showing false zeros", () => {
    expect(() => parseOpenRouterUsage({ data: { ...keyResponse.data, usage_monthly: -1 } }, "api-key")).toThrow(
      /Invalid OpenRouter usage data/,
    );
    expect(() => parseOpenRouterUsage({ data: { ...keyResponse.data, budgets: {} } }, "api-key")).toThrow(
      /Invalid OpenRouter usage data/,
    );
  });
});
