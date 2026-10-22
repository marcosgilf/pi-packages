import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { satisfies } = createRequire(import.meta.url)("semver") as {
  satisfies(version: string, range: string): boolean;
};

describe("Pi package wiring", () => {
  it("uses one footer entrypoint and compatible internal dependency ranges", async () => {
    const names = ["pi-footer", "pi-session", "pi-usage", "pi-modal"];
    const manifests = await Promise.all(
      names.map(
        async (name) =>
          JSON.parse(await readFile(new URL(`../../${name}/package.json`, import.meta.url), "utf8")) as {
            name: string;
            version: string;
            dependencies?: Record<string, string>;
            pi?: { extensions?: string[] };
          },
      ),
    );
    const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
    const footer = byName.get("@marcosgilf/pi-footer");
    expect(footer?.pi?.extensions).toEqual(["./src/index.ts"]);

    for (const manifest of manifests) {
      for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
        const localPackage = byName.get(dependency);
        if (localPackage) {
          expect(
            satisfies(localPackage.version, range),
            `${manifest.name} ${range} must include workspace ${localPackage.version}`,
          ).toBe(true);
        }
      }
    }
  });
});
