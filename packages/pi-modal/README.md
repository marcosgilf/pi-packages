# pi-modal

Shared modal component for Pi extensions. Supports refresh, plain-text copy, and styled rows.

Feature packages provide modal content and actions. This package provides the TUI shell, extra top/bottom padding, and outside-click dismissal. Press `c` to copy full modal text or Ctrl/Cmd+C to copy active fullscreen selection.

## Use

```ts
import { showModal, type ModalContent } from "@marcosgilf/pi-modal";
```

`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` are Pi-provided peer dependencies.
