---
"@marcosgilf/pi-usage": minor
"@marcosgilf/pi-footer": patch
---

Condense OpenAI usage status when quota is unavailable

When OpenAI (or any provider) has no quota data available (`state: "unavailable"` or `"unsupported"`), the status line now shows just the provider name (e.g., `OpenAI ChatGPT`) instead of `OpenAI ChatGPT · quota unavailable`. This makes the footer cleaner and more consistent across providers.