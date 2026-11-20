import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COPILOT_USAGE_STATUS_KEY,
  OPEN_OPENAI_USAGE_EVENT,
  OPEN_OPENROUTER_USAGE_EVENT,
  OPEN_RADIUS_USAGE_EVENT,
  OPENAI_USAGE_STATUS_KEY,
  OPENROUTER_USAGE_STATUS_KEY,
  RADIUS_USAGE_STATUS_KEY,
} from "../src/events.ts";
import extension from "../src/index.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("active provider usage", () => {
  it("shows active provider status and switches with the selected model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-usage-active-provider-test-"));
    try {
      await writeFile(
        join(directory, "gh"),
        `#!/bin/sh\nprintf '%s\\n' '{"copilot_plan":"pro","quota_snapshots":{"premium_interactions":{"percent_remaining":80,"credits_used":200,"entitlement":1000,"quota_remaining":800,"has_quota":true}}}'\n`,
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);
      const radiusToken = `piga.${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"account_id":"org_active_test"}').toString("base64url")}.sig`;
      const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/billing"))
          return new Response(
            JSON.stringify({
              balance: { credit_balance: 9.24, reserved: 0, available: 7.54 },
              current_period: { ends_at: "2026-12-01T00:00:00.000Z", actual_charged: 0.76 },
            }),
            { status: 200 },
          );
        if (url.endsWith("/budgets/usage"))
          return new Response(JSON.stringify({ overview: { budgets: [] } }), { status: 200 });
        return new Response(JSON.stringify({ data: { usage_monthly: 25.5 } }), { status: 200 });
      });
      vi.stubGlobal("fetch", fetch);

      const copilotModel = {
        id: "copilot-model",
        provider: "github-copilot",
        baseUrl: "https://api.individual.githubcopilot.com",
        reasoning: true,
      };
      const openaiModel = {
        id: "gpt-6-luna",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        reasoning: true,
      };
      const openrouterModel = {
        id: "openai/gpt-4.1",
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        reasoning: true,
      };
      const radiusModel = {
        id: "kimi-k3",
        provider: "radius",
        baseUrl: "https://radius.pi.dev/v1",
        reasoning: true,
      };
      let openaiOAuth = true;
      const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
      const statuses = new Map<string, string>();
      const commands = new Map<
        string,
        { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }
      >();
      const emit = vi.fn();
      const setStatus = vi.fn((key: string, value: string | undefined) => {
        if (value === undefined) statuses.delete(key);
        else statuses.set(key, value);
      });
      const pi = {
        on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
          handlers.set(name, [...(handlers.get(name) ?? []), handler]);
          return vi.fn();
        },
        events: { on: vi.fn(() => vi.fn()), emit },
        registerCommand: (
          name: string,
          command: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> },
        ) => commands.set(name, command),
        registerShortcut: vi.fn(),
      } as unknown as ExtensionAPI;
      const ctx = {
        mode: "tui",
        model: copilotModel,
        ui: { setStatus, notify: vi.fn() },
        modelRegistry: {
          hasConfiguredAuth: () => true,
          isUsingOAuth: (model: { provider: string }) =>
            model.provider === "openrouter" ||
            model.provider === "radius" ||
            (model.provider === "openai" && openaiOAuth),
          getApiKeyAndHeaders: async (model: { provider: string }) =>
            model.provider === "radius"
              ? { ok: true, apiKey: radiusToken }
              : { ok: true, apiKey: "test-openrouter-key" },
        },
      } as unknown as ExtensionContext;
      const dispatch = (name: string, event: unknown = {}) => {
        for (const handler of handlers.get(name) ?? []) handler(event, ctx);
      };

      extension(pi);
      dispatch("session_start");
      await vi.waitFor(() => expect(statuses.get(COPILOT_USAGE_STATUS_KEY)).toBe("Copilot Pro 20%"));
      expect(statuses.has(OPENAI_USAGE_STATUS_KEY)).toBe(false);

      (ctx as { model: typeof openaiModel }).model = openaiModel;
      dispatch("model_select", { model: openaiModel, previousModel: copilotModel, source: "set" });
      await vi.waitFor(() => expect(statuses.get(OPENAI_USAGE_STATUS_KEY)).toBe("OpenAI ChatGPT"));
      expect(statuses.has(COPILOT_USAGE_STATUS_KEY)).toBe(false);
      expect(fetch).not.toHaveBeenCalled();

      expect(commands.get("usage")?.description).toContain("active provider");
      expect(commands.get("openai-usage")?.description).toContain("authentication status");
      expect(commands.get("openrouter-usage")?.description).toContain("OpenRouter");
      await commands.get("usage")?.handler("", ctx);
      expect(emit).toHaveBeenCalledWith(OPEN_OPENAI_USAGE_EVENT, undefined);

      openaiOAuth = false;
      dispatch("agent_end");
      await vi.waitFor(() => expect(statuses.get(OPENAI_USAGE_STATUS_KEY)).toBe("OpenAI API key"));

      (ctx as unknown as { model: typeof openrouterModel }).model = openrouterModel;
      dispatch("model_select", { model: openrouterModel, previousModel: openaiModel, source: "set" });
      await vi.waitFor(() => expect(statuses.get(OPENROUTER_USAGE_STATUS_KEY)).toBe("OpenRouter $25.50/month"));
      expect(statuses.has(OPENAI_USAGE_STATUS_KEY)).toBe(false);
      expect(fetch).toHaveBeenCalledOnce();
      await commands.get("usage")?.handler("", ctx);
      expect(emit).toHaveBeenNthCalledWith(2, OPEN_OPENROUTER_USAGE_EVENT, undefined);

      (ctx as unknown as { model: typeof radiusModel }).model = radiusModel;
      dispatch("model_select", { model: radiusModel, previousModel: openrouterModel, source: "set" });
      await vi.waitFor(() => expect(statuses.get(RADIUS_USAGE_STATUS_KEY)).toBe("Radius $7.54 available"));
      expect(statuses.has(OPENROUTER_USAGE_STATUS_KEY)).toBe(false);
      await commands.get("usage")?.handler("", ctx);
      expect(emit).toHaveBeenNthCalledWith(3, OPEN_RADIUS_USAGE_EVENT, undefined);

      for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
      expect(statuses.has(OPENAI_USAGE_STATUS_KEY)).toBe(false);
      expect(statuses.has(OPENROUTER_USAGE_STATUS_KEY)).toBe(false);
      expect(statuses.has(RADIUS_USAGE_STATUS_KEY)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
