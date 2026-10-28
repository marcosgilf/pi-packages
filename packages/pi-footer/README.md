# pi-footer

Bundle Pi's session and Copilot usage status extensions. This package does not replace Pi's default footer; Pi renders its own working directory, token and context stats, model, and extension statuses.

## Install

```sh
pi install npm:@marcosgilf/pi-footer
```

`pi-footer` loads `pi-session` and `pi-usage` from package dependencies. Remove separate `npm:@marcosgilf/pi-session` and `npm:@marcosgilf/pi-usage` entries from Pi settings to avoid loading either extension twice.

- Session context, Copilot usage, and MCP server count appear through Pi's default extension-status rendering. MCP count includes non-hidden registered tools; offline or zero-tool servers are not counted.
- Use `/session-usage` and Command+Shift+S (`super+shift+s`) for session details.
- Use `/copilot-usage` and `super+shift+u` for Copilot quota details.
- Status labels are not clickable; use commands or shortcuts to open details.

Pi extensions run with Pi's operating-system permissions. Review package source before installing.
