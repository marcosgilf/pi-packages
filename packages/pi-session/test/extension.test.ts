import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

describe("pi-session extension", () => {
  it("registers the session command and Command+Shift+S shortcut", () => {
    const registerCommand = vi.fn();
    const registerShortcut = vi.fn();
    const pi = {
      on: vi.fn((_event: string, _handler: (event: unknown, ctx: ExtensionContext) => void) => vi.fn()),
      events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
      registerCommand,
      registerShortcut,
    } as unknown as ExtensionAPI;

    extension(pi);

    expect(registerCommand).toHaveBeenCalledWith(
      "session-usage",
      expect.objectContaining({ description: "Show session token, cost, and context usage" }),
    );
    expect(registerShortcut).toHaveBeenCalledWith(
      "super+shift+s",
      expect.objectContaining({ description: "Show session token, cost, and context usage" }),
    );
  });
});
