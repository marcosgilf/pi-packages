# pi-footer

Responsive custom footer for Pi's session context, provider quota/status, and extension statuses. It uses Pi's footer data and session APIs to keep native information while arranging extension details around it.

## Install

```sh
pi install npm:@marcosgilf/pi-footer
```

`pi-footer` loads `pi-session` and `pi-usage` from package dependencies. Remove separate `npm:@marcosgilf/pi-session` and `npm:@marcosgilf/pi-usage` entries from Pi settings to avoid loading either extension twice.

- Wide terminals show the path, then session context and Pi extension statuses on the left with active provider status and model on the right.
- Narrow terminals stack path, provider/model, and session/status lines. Provider/model starts at the left edge; long text ends with `...`.
- MCP count includes non-hidden registered tool namespaces; offline or zero-tool configured servers are not counted.
- Click session context or active provider status to open details. `/session-usage` and Command+Shift+S (`super+shift+s`) open session details; `/usage` and `super+shift+u` open active provider details; `/copilot-usage` and `/openai-usage` open provider-specific details. OpenAI shows local authentication state only; ChatGPT quota is unavailable.

A custom footer replaces Pi's built-in layout. Pi does not expose a public API to compose its built-in footer component, so this extension uses Pi's public footer data and context status APIs to preserve available statuses in a custom layout.

Pi extensions run with Pi's operating-system permissions. Review package source before installing.
