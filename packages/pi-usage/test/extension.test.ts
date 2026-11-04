import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_COPILOT_USAGE_EVENT } from "../src/events.ts";
import extension from "../src/index.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pi-usage extension", () => {
  it("registers current usage commands and publishes only active provider status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-usage-extension-test-"));
    try {
      await writeFile(
        join(directory, "gh"),
        `#!/bin/sh\nprintf '%s\\n' '{"copilot_plan":"enterprise","quota_snapshots":{"premium_interactions":{"percent_remaining":75,"credits_used":5000,"entitlement":20000,"quota_remaining":15000,"has_quota":true}}}'\n`,
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);

      const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
      const commands = new Map<
        string,
        { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }
      >();
      const emit = vi.fn();
      const registerShortcut = vi.fn();
      const setStatus = vi.fn();
      const pi = {
        on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
          handlers.set(event, [...(handlers.get(event) ?? []), handler]);
          return vi.fn();
        },
        events: { on: vi.fn(() => vi.fn()), emit },
        registerCommand: (
          name: string,
          command: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> },
        ) => commands.set(name, command),
        registerShortcut,
      } as unknown as ExtensionAPI;
      const ctx = {
        mode: "tui",
        model: { id: "copilot-model", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com" },
        modelRegistry: {
          isUsingOAuth: () => false,
          getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "github-token" }),
        },
        ui: { setStatus, notify: vi.fn() },
      } as unknown as ExtensionContext;

      extension(pi);
      for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
      await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("pi-usage", "Copilot Enterprise 25%"));

      expect(commands.get("usage")?.description).toContain("active provider");
      expect(commands.get("copilot-usage")?.description).toContain("GitHub Copilot");
      expect(commands.get("openai-usage")?.description).toContain("OpenAI");
      expect(commands.get("openrouter-usage")?.description).toContain("OpenRouter");
      await commands.get("usage")?.handler("", ctx);
      expect(emit).toHaveBeenCalledWith(OPEN_COPILOT_USAGE_EVENT, undefined);
      expect(registerShortcut).toHaveBeenCalledWith(
        "super+shift+u",
        expect.objectContaining({ description: "Show usage for the active provider" }),
      );
      for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
      expect(setStatus).toHaveBeenCalledWith("pi-usage", undefined);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
