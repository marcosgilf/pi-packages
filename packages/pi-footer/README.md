# pi-footer

Single owner for Pi's custom footer. It loads `pi-session` and `pi-usage`, then combines their data and click actions. Both feature extensions use `pi-modal` for details.

## Install

```sh
pi install npm:@marcosgilf/pi-footer
```

`pi-footer` loads `pi-session` and `pi-usage` from package dependencies. Remove separate `npm:@marcosgilf/pi-session` and `npm:@marcosgilf/pi-usage` entries from Pi settings to avoid loading either extension twice.

- Click context indicator to open session details.
- Click Copilot plan usage to open quota details.
- Wide terminals combine session/skill info on the left and usage/model info on the right; narrow terminals stack usage/model and session/skill lines.
- `/session-usage` and Command+Shift+S (`super+shift+s`) open session details.
- `/copilot-usage` and `super+shift+u` open Copilot details.

Pi extensions run with Pi's operating-system permissions. Review package source before installing.
