import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("pi-footer package wiring", () => {
  it("loads feature factories through package imports and requires compatible versions", async () => {
    const footer = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
      pi: { extensions: string[] };
    };
    const workspace = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")) as {
      pi: { extensions: string[] };
    };

    expect(footer.pi.extensions).toEqual(["./src/index.ts"]);
    expect(footer.dependencies["@marcosgilf/pi-session"]).toBe("^0.1.0");
    expect(footer.dependencies["@marcosgilf/pi-usage"]).toBe("^0.2.0");
    expect(workspace.pi.extensions).toEqual(["./packages/pi-footer/src/index.ts"]);
  });
});
