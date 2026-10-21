# 📊 pi-usage

[![npm](https://img.shields.io/npm/v/@marcosgilf/pi-usage)](https://www.npmjs.com/package/@marcosgilf/pi-usage) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Show GitHub Copilot plan and quota usage in Pi.

## ✨ Features

- Keep only context percentage/window and Copilot plan usage in the footer; color context use at Pi's warning thresholds.
- Open Copilot quota details by clicking plan usage, running `/copilot-usage`, or pressing `super+shift+u`.
- Open session token, cache, cost, and context details by clicking the context indicator or running `/session-usage`.
- Reuse one modal shell for refresh (`r`) and plain-text copy (`c`).
- Hide the progress bar for unlimited plans.

## 📦 Install

Install the published package:

```sh
pi install npm:@marcosgilf/pi-usage
```

For one-run testing, use `pi -e npm:@marcosgilf/pi-usage`. To load a local checkout, run `npm install` in the monorepo, then `pi -e ./packages/pi-usage`.

Pi extensions run with Pi's operating-system permissions. Review package source before installing.

## 🚀 Quick start

Install `gh`, sign in to GitHub, and grant the `user` OAuth scope if needed:

```sh
gh auth refresh -h github.com -s user
```

Start Pi. The footer shows context use and Copilot plan/quota percentage. Run `/copilot-usage` for quota details or `/session-usage` for session totals.

## 💬 Commands

- `/copilot-usage` opens Copilot plan/quota details and refreshes account quota.
- `super+shift+u` opens the Copilot modal.
- `/session-usage` opens session token, cache, cost, and context details.
- Clicking the context percentage opens session details in Pi fullscreen mode.
- In either modal, `r` refreshes data and `c` copies plain text. Esc or Enter closes it.

The quota request uses GitHub's undocumented `copilot_internal/user` endpoint through `gh`. GitHub may change this endpoint.

## 🚧 Limitations

- Footer mouse clicks work in Pi fullscreen mode. Use the command or shortcut in regular mode.
- Terminal mouse selection copies the rendered modal layout. Press `c` to copy plain text.
- Clipboard copy uses macOS `pbcopy`.

## 🗂️ Package layout

- `src/index.ts` is the Pi extension entrypoint.
- `src/copilot-usage.ts` registers commands and the footer.
- `src/modal.ts` provides the shared modal shell and keyboard actions.
- `src/core.ts` parses and formats Copilot quota, context, and session data.
- `test/` contains Vitest tests.

## 🔎 Keywords

`pi-package`, `pi-extension`, `github-copilot`, `usage`, `quota`

## 📄 License

MIT. See [`LICENSE`](./LICENSE).
