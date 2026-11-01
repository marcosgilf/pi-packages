# 📊 pi-usage

Show GitHub Copilot plan and usage percentage in Pi's default footer, with a modal for quota details.

## Install

```sh
pi install npm:@marcosgilf/pi-usage
```

- When installed alone, the default footer shows Copilot plan and percentage.
- `/copilot-usage` opens quota details.
- `super+shift+u` opens the same modal.
- In modal: `c` copies full summary; Ctrl/Cmd+C copies selected text; click outside closes.
- Install `@marcosgilf/pi-footer` to place usage beside the model and coordinate it with session context. It loads this extension as a dependency; do not install both packages separately.

Pi extensions run with Pi's operating-system permissions. Review package source before installing.

The quota request uses GitHub's undocumented `copilot_internal/user` endpoint through `gh`. Install and sign in to GitHub CLI. The `user` OAuth scope may be required:

```sh
gh auth refresh -h github.com -s user
```

GitHub may change this endpoint.

## Provider contract

`UsageProvider`, `UsageSnapshot`, and `UsageWindow` types are exported from the package root for provider implementations. Identify quota windows by stable `limitId` or `durationMs`; do not assume provider-specific names such as `primary` or `secondary`. Timestamps use Unix milliseconds. Current extension runtime still reports Copilot usage only.
