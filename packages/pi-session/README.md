# pi-session

Show context percentage/window in Pi's default footer and detailed token, cache, cost, and context usage in a modal.

## Install

```sh
pi install npm:@marcosgilf/pi-session
```

- When installed alone, the default footer shows session context use.
- `/session-usage` opens detailed session information.
- Command+Shift+S (`super+shift+s`) opens the same modal.
- In modal: `c` copies full summary; Ctrl/Cmd+C copies selected text; click outside closes.
- Install `@marcosgilf/pi-footer` to place session context before skill statuses and Copilot usage beside the model. It loads this extension as a dependency; do not install both packages separately.

Pi extensions run with Pi's operating-system permissions. Review package source before installing.
