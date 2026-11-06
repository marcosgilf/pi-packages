import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIUsageProvider, formatOpenAIUsageStatus, formatOpenAIUsageSummary } from "../src/openai-usage.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function openAIContext(auth: "oauth" | "api-key" | "none"): ExtensionContext {
  return {
    model: { id: "gpt-6-luna", provider: "openai", baseUrl: "https://api.openai.com/v1" },
    modelRegistry: {
      hasConfiguredAuth: vi.fn(() => auth !== "none"),
      isUsingOAuth: vi.fn(() => auth === "oauth"),
      getApiKeyAndHeaders: vi.fn(() => {
        throw new Error("OpenAI status must not read credentials.");
      }),
    },
  } as unknown as ExtensionContext;
}

describe("OpenAI local provider status", () => {
  it("identifies ChatGPT OAuth without claiming quota or reading its token", async () => {
    vi.stubEnv("OPENAI_ADMIN_KEY", "unused-admin-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const ctx = openAIContext("oauth");
    const provider = createOpenAIUsageProvider(ctx);
    const snapshot = await provider.fetchUsage();

    expect(provider.id).toBe(snapshot.providerId);
    expect(snapshot).toMatchObject({
      providerId: "openai",
      authMethod: "chatgpt-oauth",
      windows: [],
      state: "unsupported",
    });
    expect(snapshot).not.toHaveProperty("accountId");
    expect(formatOpenAIUsageStatus(snapshot)).toBe("OpenAI ChatGPT");
    expect(formatOpenAIUsageSummary(snapshot)).toEqual([
      "OpenAI provider status",
      "Authentication: Sign in with ChatGPT",
      "ChatGPT subscription quota: unavailable",
      "No supported ChatGPT quota source is available for this Pi login.",
    ]);
    expect(ctx.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("distinguishes API-key auth from ChatGPT OAuth", async () => {
    const snapshot = await createOpenAIUsageProvider(openAIContext("api-key")).fetchUsage();

    expect(snapshot.authMethod).toBe("api-key");
    expect(snapshot.state).toBe("unsupported");
    expect(formatOpenAIUsageStatus(snapshot)).toBe("OpenAI API key");
    expect(formatOpenAIUsageSummary(snapshot)[1]).toBe("Authentication: OpenAI API key");
  });

  it("reports missing local auth without a network request", async () => {
    const snapshot = await createOpenAIUsageProvider(openAIContext("none")).fetchUsage();

    expect(snapshot.authMethod).toBe("unconfigured");
    expect(snapshot.state).toBe("unavailable");
    expect(formatOpenAIUsageStatus(snapshot)).toBe("OpenAI · auth not configured");
  });
});
