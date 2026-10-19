# 📊 pi-usage

[![npm](https://img.shields.io/npm/v/@marcosgilf/pi-usage)](https://www.npmjs.com/package/@marcosgilf/pi-usage) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Show GitHub Copilot plan and quota usage in Pi.

## ✨ Features

- Show Copilot plan and usage beside Pi's model in the footer.
- Open a quota modal by clicking the footer usage in fullscreen mode, running `/copilot-usage`, or pressing `super+shift+u`.
- Refresh modal data with `r` and copy a plain-text summary with `c`.
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

Start Pi. The footer shows the plan and quota percentage. Run `/copilot-usage` for the modal.

## 💬 Commands

- `/copilot-usage` opens the modal and refreshes account quota.
- `super+shift+u` opens the same modal.
- In the modal, `r` refreshes data and `c` copies plain text. Esc or Enter closes it.

The quota request uses GitHub's undocumented `copilot_internal/user` endpoint through `gh`. GitHub may change this endpoint.

## 🚧 Limitations

- Footer mouse clicks work in Pi fullscreen mode. Use the command or shortcut in regular mode.
- Terminal mouse selection copies the rendered modal layout. Press `c` to copy plain text.
- Clipboard copy uses macOS `pbcopy`.

## 🗂️ Package layout

- `src/index.ts` is the Pi extension entrypoint.
- `src/copilot-usage.ts` registers commands, footer, and modal behavior.
- `src/core.ts` parses and formats Copilot quota and session data.
- `test/` contains Vitest tests.

## 🔎 Keywords

`pi-package`, `pi-extension`, `github-copilot`, `usage`, `quota`

## 📄 License

MIT. See [`LICENSE`](./LICENSE).
