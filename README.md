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

- [`pi-usage`](./packages/pi-usage) — GitHub Copilot plan and quota usage.

## Add a package

Create a workspace under `packages/<name>`, declare its Pi entrypoint and Pi host packages in
`peerDependencies`, then list its source entrypoint in the root `pi.extensions` manifest. Keep
package versions independent; use `npm run changeset` for published behavior changes.

## CI and releases

GitHub Actions runs `npm run check` and `npm test` on pull requests to `main` and before release processing. A push to `main` runs Changesets: it creates a version pull request when changesets are pending, then publishes packages after that pull request is merged. Configure the repository's `NPM_TOKEN` secret and allow `GITHUB_TOKEN` to create pull requests before the first release.

## License

MIT. See [`LICENSE`](./LICENSE).
