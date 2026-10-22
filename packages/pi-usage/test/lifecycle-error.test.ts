import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

afterEach(() => vi.unstubAllEnvs());

describe("pi-usage stale errors", () => {
  it("does not notify after quota fetch fails after session shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-usage-stale-error-test-"));
    try {
      await writeFile(
        join(directory, "gh"),
        "#!/bin/sh\nsleep 0.15\nprintf '%s\\n' 'authentication required' >&2\nexit 1\n",
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);

      const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
      let copilotCommand: ((args: string, ctx: ExtensionContext) => Promise<void> | void) | undefined;
      const notify = vi.fn();
      const pi = {
        on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
          handlers.set(event, handler);
          return vi.fn();
        },
        events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
        registerCommand: (name: string, options: { handler: typeof copilotCommand }) => {
          if (name === "copilot-usage") copilotCommand = options.handler ?? undefined;
        },
        registerShortcut: vi.fn(),
      } as unknown as ExtensionAPI;
      const ctx = {
        mode: "tui",
        ui: { setStatus: vi.fn(), notify, custom: vi.fn() },
      } as unknown as ExtensionContext;

      extension(pi);
      handlers.get("session_start")?.({}, ctx);
      const command = copilotCommand?.("", ctx);
      if (!command) throw new Error("Copilot command was not registered");
      handlers.get("session_shutdown")?.({}, ctx);
      await command;

      expect(notify).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
