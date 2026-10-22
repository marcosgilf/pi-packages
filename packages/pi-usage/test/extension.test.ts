import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

afterEach(() => vi.unstubAllEnvs());

describe("pi-usage extension", () => {
  it("registers standalone commands and publishes quota status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-usage-extension-test-"));
    try {
      const gh = join(directory, "gh");
      await writeFile(
        gh,
        `#!/bin/sh\nprintf '%s\\n' '{"copilot_plan":"enterprise","quota_snapshots":{"premium_interactions":{"percent_remaining":75,"credits_used":5000,"entitlement":20000,"quota_remaining":15000,"has_quota":true}}}'\n`,
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);

      const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
      const registerCommand = vi.fn();
      const registerShortcut = vi.fn();
      const setStatus = vi.fn();
      const pi = {
        on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
          handlers.set(event, handler);
          return vi.fn();
        },
        events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
        registerCommand,
        registerShortcut,
      } as unknown as ExtensionAPI;
      const ctx = { mode: "tui", ui: { setStatus } } as unknown as ExtensionContext;

      extension(pi);
      handlers.get("session_start")?.({}, ctx);
      await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("pi-usage", "Copilot Enterprise 25%"));

      expect(registerCommand).toHaveBeenCalledWith(
        "copilot-usage",
        expect.objectContaining({ description: "Show GitHub Copilot plan and quota usage" }),
      );
      expect(registerShortcut).toHaveBeenCalledWith(
        "super+shift+u",
        expect.objectContaining({ description: "Show GitHub Copilot AI-credit usage" }),
      );
      handlers.get("session_shutdown")?.({}, ctx);
      expect(setStatus).toHaveBeenLastCalledWith("pi-usage", undefined);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
