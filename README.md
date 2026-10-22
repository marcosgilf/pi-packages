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
- [`pi-session`](./packages/pi-session) — session token, cache, cost, and context details.
- [`pi-usage`](./packages/pi-usage) — GitHub Copilot plan and quota details.
- [`pi-modal`](./packages/pi-modal) — shared modal UI library.

## Add a package

Create a workspace under `packages/<name>`, declare its Pi entrypoint and Pi host packages in
`peerDependencies`, then list its source entrypoint in the root `pi.extensions` manifest. Keep
package versions independent; use `npm run changeset` for published behavior changes.

## CI and releases

GitHub Actions runs `npm run check` and `npm test` on pull requests to `main` and before release processing. Changesets creates a version pull request for pending changesets. Merging it publishes packages and creates package-specific GitHub tags and releases from their changelogs. The npm version badge and GitHub releases link update as packages ship. Configure the repository's `NPM_TOKEN` secret and allow `GITHUB_TOKEN` to create pull requests.

## License

MIT. See [`LICENSE`](./LICENSE).
