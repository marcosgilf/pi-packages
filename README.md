# 🧩 Pi Packages

An npm workspace for small, independently installable Pi Coding Agent packages.

## Development

Use the Node.js version in `.node-version`, then run:

```sh
npm install
npm test
npm run check
```

`npm run check` runs Biome and TypeScript checks. `npm test` runs package tests with Vitest.

## Packages

- [`pi-footer`](./packages/pi-footer) — one footer owner that combines session and Copilot usage.
- [`pi-session`](./packages/pi-session) — context indicator in Pi's default footer plus session details.
- [`pi-usage`](./packages/pi-usage) — Copilot plan/percentage in Pi's default footer plus quota details.
- [`pi-modal`](./packages/pi-modal) — shared modal UI library.

## Versioning

Use Changesets for published packages:

- Start each new package at `0.0.0`; add a `minor` changeset for its first `0.1.0` release.
- Bump existing packages from their latest published version. For example, `pi-usage@0.1.0` needs a `minor` changeset to release as `0.2.0`.
- Keep internal semver ranges compatible with current workspace versions. Set `bumpVersionsWithWorkspaceProtocolOnly` to `false` so Changesets updates those ranges in its version PR.
- Merge the Changesets version PR to publish packages. Do not pre-bump new package manifests to `0.1.0` with a patch changeset; that releases `0.1.1`.

## Add a package

Create a workspace under `packages/<name>` and declare Pi host packages in `peerDependencies`.
List standalone extensions in the root `pi.extensions` manifest; owner extensions can import and
invoke feature-package factories through declared dependencies. Keep package versions independent;
use `npm run changeset` for published behavior changes.

## CI and releases

GitHub Actions runs `npm run check` and `npm test` on pull requests to `main` and before release processing. Changesets creates a version pull request for pending changesets. Merging it publishes packages and creates package-specific GitHub tags and releases from their changelogs. The npm version badge and GitHub releases link update as packages ship. Configure the repository's `NPM_TOKEN` secret and allow `GITHUB_TOKEN` to create pull requests.

## License

MIT. See [`LICENSE`](./LICENSE).
