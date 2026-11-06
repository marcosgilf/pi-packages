# @marcosgilf/pi-usage

## 0.6.0

### Minor Changes

- c26f252: Condense OpenAI usage status when quota is unavailable
  
  When OpenAI (or any provider) has no quota data available (`state: "unavailable"` or `"unsupported"`), the status line now shows just the provider name (e.g., `OpenAI ChatGPT`) instead of `OpenAI ChatGPT · quota unavailable`. This makes the footer cleaner and more consistent across providers.

## 0.5.0

### Minor Changes

- 66163b6: Add OpenRouter key usage, budgets, and free-model request allowance to `/usage` and the footer.

### Patch Changes

- Updated dependencies [66163b6]
  - @marcosgilf/pi-modal@0.1.1

## 0.4.0

### Minor Changes

- ff57d87: Show active GitHub Copilot quota and local OpenAI provider/auth status. OpenAI subscription quota remains unavailable.

## 0.3.0

### Minor Changes

- 143aa66: Export provider-neutral usage snapshot and provider types.

## 0.2.0

### Minor Changes

- 78883d6: Give pi-session and pi-usage standalone indicators and modals, share modal UI, and let pi-footer arrange both in one responsive footer.

### Patch Changes

- Updated dependencies [78883d6]
  - @marcosgilf/pi-modal@0.1.0

## 0.1.0

### Minor Changes

- 394cfd4: Add the GitHub Copilot usage extension.
