import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRadiusUsageProvider,
  formatRadiusUsageStatus,
  formatRadiusUsageSummary,
  parseRadiusUsage,
} from "../src/radius-usage.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function testToken(orgId: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `piga.${encode({ alg: "HS256" })}.${encode({ sub: "usr_test", account_id: orgId })}.signature`;
}

const billingResponse = {
  ok: true,
  currency: "USD",
  as_of: "2026-11-20T15:29:32.369Z",
  balance: { credit_balance: 9.24, reserved: 1.7, available: 7.54, updated_at: "2026-11-20T15:29:30.244Z" },
  current_period: {
    starts_at: "2026-11-01T00:00:00.000Z",
    ends_at: "2026-12-01T00:00:00.000Z",
    actual_charged: 0.76,
    actual_charge_count: 105,
  },
  all_time: { credited: 10, credit_count: 1, actual_charged: 0.76, actual_charge_count: 105 },
  capabilities: { create_checkout_session: true, create_portal_session: "allowed", redeem_credit_code: true },
};

const budgetsResponse = {
  ok: true,
  currency: "USD",
  overview: {
    asOf: "2026-11-20T15:29:32.884Z",
    selection: { kind: "principal", principalId: "usr_test" },
    budgets: [
      {
        budget: { id: "bgt_team", name: "Team", enabled: true, group: null },
        limits: [
          {
            period: "month",
            perMember: { kind: "principal", limit: 20, used: 5, resetAt: "2026-12-01T00:00:00.000Z" },
            shared: { limit: 100, used: 40, resetAt: "2026-12-01T00:00:00.000Z" },
          },
        ],
      },
    ],
  },
  canManageBudgets: true,
};

const testAuth = {
  token: testToken("org_test123"),
  keyId: "test-key-id",
  orgId: "org_test123",
  method: "radius-oauth" as const,
};

function radiusContext(options: { configured?: boolean; token?: string; baseUrl?: string } = {}) {
  const modelRegistry = {
    hasConfiguredAuth: vi.fn(() => options.configured !== false),
    isUsingOAuth: vi.fn(() => true),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: true as const, apiKey: options.token ?? testToken("org_test123") })),
  };
  const ctx = {
    model: {
      id: "kimi-k3",
      provider: "radius",
      baseUrl: options.baseUrl ?? "https://radius.pi.dev/v1",
    },
    modelRegistry,
  } as unknown as ExtensionContext;
  return { ctx, modelRegistry };
}

describe("Radius usage provider", () => {
  it("parses monthly charges, credit balance, and own budget limits", () => {
    const usage = parseRadiusUsage(billingResponse, budgetsResponse, testAuth, 1_800_000_000_000);

    expect(usage).toMatchObject({
      providerId: "radius",
      accountId: "org_test123",
      authMethod: "radius-oauth",
      fetchedAt: 1_800_000_000_000,
      state: "available",
    });
    expect(JSON.stringify(usage)).not.toContain(testAuth.token);
    expect(usage.windows.find(({ limitId }) => limitId === "spend_monthly")).toMatchObject({
      label: "Radius charges this month",
      used: 0.76,
      resetsAt: Date.parse("2026-12-01T00:00:00.000Z"),
      unit: "USD",
    });
    expect(usage.windows.find(({ limitId }) => limitId === "credit_balance")).toMatchObject({
      label: "Credit balance",
      remaining: 7.54,
      unit: "USD",
    });
    expect(usage.windows.find(({ limitId }) => limitId === "budget_bgt_team_month")).toMatchObject({
      label: "Team budget (month)",
      used: 5,
      limit: 20,
      remaining: 15,
      usedPercent: 25,
      resetsAt: Date.parse("2026-12-01T00:00:00.000Z"),
      unit: "USD",
    });
    expect(formatRadiusUsageStatus(usage)).toBe("Radius $7.54 available");
    const summary = formatRadiusUsageSummary(usage);
    expect(summary).toContain("Organization: org_test123");
    expect(summary.some((line) => line.includes("Charges this month: $0.76"))).toBe(true);
    expect(summary.some((line) => line.includes("$1.70 reserved"))).toBe(true);
    expect(summary.some((line) => line.includes("Team budget (month): $5.00 / $20.00 used; $15.00 remaining"))).toBe(
      true,
    );
  });

  it("uses Pi's configured credential only with Radius's official endpoint and organization from the token", async () => {
    const token = testToken("org_fetch_test");
    const { ctx, modelRegistry } = radiusContext({ token });
    const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/billing")) return new Response(JSON.stringify(billingResponse), { status: 200 });
      if (url.endsWith("/budgets/usage")) return new Response(JSON.stringify(budgetsResponse), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    const usage = await createRadiusUsageProvider(ctx, true).fetchUsage();
    const [input, init] = fetch.mock.calls[0] ?? [];

    expect(usage.providerId).toBe("radius");
    expect(usage.accountId).toBe("org_fetch_test");
    expect(modelRegistry.getApiKeyAndHeaders).toHaveBeenCalledOnce();
    expect(String(input)).toBe("https://radius.pi.dev/v1/organizations/org_fetch_test/billing");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}`, Accept: "application/json" });
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not call Radius when auth is missing or model endpoint is custom", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const missingAuth = radiusContext({ configured: false });
    const missing = await createRadiusUsageProvider(missingAuth.ctx).fetchUsage();
    expect(missing.state).toBe("unavailable");
    expect(missingAuth.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();

    const customEndpoint = radiusContext({ baseUrl: "https://proxy.example/v1" });
    const custom = await createRadiusUsageProvider(customEndpoint.ctx).fetchUsage();
    expect(custom.state).toBe("unsupported");
    expect(customEndpoint.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caches per credential and returns stale data without exposing a failed response body", async () => {
    const { ctx } = radiusContext({ token: testToken("org_cache_test") });
    const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/billing")) return new Response(JSON.stringify(billingResponse), { status: 200 });
      return new Response(JSON.stringify(budgetsResponse), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    const first = await createRadiusUsageProvider(ctx).fetchUsage();
    const cached = await createRadiusUsageProvider(ctx).fetchUsage();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cached.fetchedAt).toBe(first.fetchedAt);

    fetch.mockImplementation(async () => new Response("private refresh body", { status: 503 }));
    const stale = await createRadiusUsageProvider(ctx, true).fetchUsage();
    expect(stale.state).toBe("stale");
    expect(stale.windows).toEqual(first.windows);
    expect(stale.error).toBe("Radius usage request failed with HTTP 503.");
    expect(JSON.stringify(stale)).not.toContain("private refresh body");
  });

  it("reports HTTP errors without exposing Radius response bodies", async () => {
    const { ctx } = radiusContext({ token: testToken("org_error_test") });
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("private error body", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(createRadiusUsageProvider(ctx, true).fetchUsage()).rejects.toThrow("HTTP 401");
  });

  it("rejects malformed billing and budget data rather than showing false zeros", () => {
    expect(() =>
      parseRadiusUsage(
        { ...billingResponse, balance: { ...billingResponse.balance, available: "7.54" } },
        undefined,
        testAuth,
      ),
    ).toThrow(/Invalid Radius usage data/);
    expect(() => parseRadiusUsage(billingResponse, { overview: { budgets: {} } }, testAuth)).toThrow(
      /Invalid Radius usage data/,
    );
    expect(() => parseRadiusUsage({ balance: null }, undefined, testAuth)).toThrow(/Invalid Radius usage data/);
  });
});
