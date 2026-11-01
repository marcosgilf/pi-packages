# 📊 pi-usage

Show usage for the active provider in Pi's footer, with details in a modal.

## Install

```sh
pi install npm:@marcosgilf/pi-usage
```

- `/usage` opens details for the active provider; `super+shift+u` does the same.
- `/copilot-usage` and `/openai-usage` open provider-specific details. Each command works only when its provider is active.
- In the modal, `c` copies the full summary; Ctrl/Cmd+C copies selected text; click outside closes.
- Install `@marcosgilf/pi-footer` to show provider usage beside the model and session context. It loads this extension as a dependency; do not install both packages separately.

Pi extensions run with Pi's operating-system permissions. Review package source before installing.

GitHub Copilot usage runs `gh api` against GitHub's undocumented `copilot_internal/user` endpoint when a Copilot model is active. It uses the GitHub CLI's signed-in account, which can differ from Pi's Copilot login; make sure both use the same account. GitHub may require the `user` OAuth scope: run `gh auth login -h github.com` or `gh auth refresh -h github.com -s user` if access fails. GitHub may change this endpoint.

OpenAI status uses only local Pi model and authentication metadata. It makes no network requests. It distinguishes Sign in with ChatGPT from API-key authentication, but does not show ChatGPT quota or OpenAI API organization usage and costs. Pi does not expose an individual OpenAI account ID or email through this status.

## Provider contract

`UsageProvider`, `UsageSnapshot`, and `UsageWindow` types are exported from the package root for provider implementations. Identify quota windows by stable `limitId` or `durationMs`; do not assume provider-specific names such as `primary` or `secondary`. Timestamps use Unix milliseconds.
