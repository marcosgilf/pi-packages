import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

afterEach(() => vi.unstubAllEnvs());

describe("pi-usage lifecycle", () => {
  it("does not republish status when an in-flight fetch finishes after shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-usage-lifecycle-test-"));
    try {
      const usage = JSON.stringify({
        copilot_plan: "enterprise",
        quota_snapshots: {
          premium_interactions: {
            percent_remaining: 75,
            credits_used: 5000,
            entitlement: 20000,
            quota_remaining: 15000,
            has_quota: true,
          },
        },
      });
      await writeFile(join(directory, "gh"), `#!/bin/sh\nsleep 0.15\nprintf '%s\\n' '${usage}'\n`, { mode: 0o755 });
      vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);

      const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
      const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }>();
      const statusCalls: [string, string | undefined][] = [];
      const setStatus = vi.fn((key: string, text: string | undefined) => statusCalls.push([key, text]));
      const tui = { terminal: { rows: 24 }, requestRender: vi.fn() } as unknown as TUI;
      const theme = {
        fg: (_style: string, text: string) => text,
        bg: (_style: string, text: string) => text,
        bold: (text: string) => text,
      } as unknown as Theme;
      const keybindings = {
        matches: (data: string, action: string) =>
          (action === "app.interrupt" && data === "escape") || (action === "tui.input.submit" && data === "enter"),
      } as unknown as KeybindingsManager;
      let modal: (Component & { dispose?(): void }) | undefined;
      let closeModal: (() => void) | undefined;
      const custom = vi.fn(
        (factory: (tui: TUI, theme: Theme, keys: KeybindingsManager, done: (value: unknown) => void) => Component) =>
          new Promise<void>((resolve) => {
            closeModal = () => resolve();
            modal = factory(tui, theme, keybindings, () => closeModal?.());
          }),
      );
      const pi = {
        on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
          handlers.set(event, handler);
          return vi.fn();
        },
        events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
        registerCommand: (
          name: string,
          options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> | void },
        ) => {
          commands.set(name, options);
        },
        registerShortcut: vi.fn(),
      } as unknown as ExtensionAPI;
      const ctx = { mode: "tui", ui: { setStatus, notify: vi.fn(), custom } } as unknown as ExtensionContext;

      extension(pi);
      const command = commands.get("copilot-usage")?.handler;
      if (!command) throw new Error("Copilot command was not registered");

      handlers.get("session_start")?.({}, ctx);
      const firstCommand = command("", ctx);
      handlers.get("session_shutdown")?.({}, ctx);
      await firstCommand;
      expect(custom).not.toHaveBeenCalled();
      expect(statusCalls.filter(([key, text]) => key === "pi-usage" && text !== undefined)).toHaveLength(0);

      handlers.get("session_start")?.({}, ctx);
      await vi.waitFor(() => expect(statusCalls.at(-1)).toEqual(["pi-usage", "Copilot Enterprise 25%"]));
      const modalCommand = command("", ctx);
      await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
      modal?.handleInput?.("r");
      await new Promise((resolve) => setTimeout(resolve, 30));
      handlers.get("session_shutdown")?.({}, ctx);
      const shutdownIndex = statusCalls.length - 1;
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(statusCalls.slice(shutdownIndex + 1).filter(([key]) => key === "pi-usage")).toHaveLength(0);
      modal?.handleInput?.("escape");
      modal?.dispose?.();
      await modalCommand;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
