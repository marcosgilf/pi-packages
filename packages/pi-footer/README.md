# pi-footer

Responsive custom footer for Pi's session stats, Copilot usage, and extension statuses. It uses Pi's footer data and session APIs to keep native information while arranging extension details around it.

## Install

```sh
pi install npm:@marcosgilf/pi-footer
```

`pi-footer` loads `pi-session` and `pi-usage` from package dependencies. Remove separate `npm:@marcosgilf/pi-session` and `npm:@marcosgilf/pi-usage` entries from Pi settings to avoid loading either extension twice.

- Wide terminals show the path, then session stats and Pi extension statuses on the left with Copilot usage and model on the right.
- Narrow terminals stack path, usage/model, and session/status lines. Long text ends with `...`.
- MCP count includes non-hidden registered tool namespaces; offline or zero-tool configured servers are not counted.
- Click session stats or Copilot usage to open details. `/session-usage` and Command+Shift+S (`super+shift+s`) also open session details; `/copilot-usage` and `super+shift+u` open Copilot quota details.

A custom footer replaces Pi's built-in layout. Pi does not expose a public API to compose its built-in footer component, so this extension uses Pi's public footer data and context APIs to preserve its available stats and statuses in a custom layout.

Pi extensions run with Pi's operating-system permissions. Review package source before installing.
