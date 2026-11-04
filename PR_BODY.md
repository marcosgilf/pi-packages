## What this PR does

Adds OpenRouter key usage, budgets, and free-model request allowance to Pi's usage system.

### Changes

- **`packages/pi-usage/src/openrouter-usage.ts`** - New provider that calls `GET /api/v1/key` at `https://openrouter.ai` using Pi's existing OpenRouter credential. Reports:
  - Credit spend by day/week/month
  - Key/account budgets (member/workspace scopes)
  - Free-model daily request allowance
  - BYOK (Bring Your Own Key) spend separately
  - Does not expose account identifiers or call other origins
  - Five-minute cache with stale-while-revalidate fallback
  - Sanitized HTTP error messages (no response body leakage)

- **`packages/pi-footer/src/index.ts`** - Registers `OPEN_OPENROUTER_USAGE_EVENT` and displays OpenRouter status in the footer alongside Copilot and OpenAI.

- **`packages/pi-usage/src/index.ts`** - Registers `registerOpenRouterUsage` and routes `/openrouter-usage` command when OpenRouter model is active.

- **`packages/pi-usage/src/events.ts`** - Exports `OPENROUTER_USAGE_STATUS_KEY` and `OPEN_OPENROUTER_USAGE_EVENT`.

- **`packages/pi-modal/src/index.ts`** - Adds `wrapText()` helper so long modal text rows wrap at content width instead of truncating with `…`.

- **`packages/pi-usage/README.md`** - Documents the new `/openrouter-usage` command and clarifies that key spend/budgets are not subscription quota.

- **`packages/pi-footer/README.md`** - Documents OpenRouter label in footer.

- **Tests** - 30 tests across `openrouter-usage`, `active-provider`, `extension`, and `footer` suites, all passing.

### Provider contract

Usage windows use stable `limitId` values: `spend_daily`, `spend_weekly`, `spend_monthly`, `byok_spend_daily`, `byok_spend_weekly`, `byok_spend_monthly`, `effective_budget`, `key_limit`, `free_model_daily_requests`. Identify by `limitId`, not provider-specific names.

### Version bumps (Changesets)

- `@marcosgilf/pi-usage` — minor (new provider)
- `@marcosgilf/pi-footer` — patch (event/label integration)
- `@marcosgilf/pi-modal` — patch (text wrapping)

### Constraints respected

- No OAuth tokens persisted or sent across origins
- No undocumented quota adapters or generic polling
- No inferred identity from JWT `sub` or `client_id`
- Provider-neutral contract: quota windows use `limitId`, not `primary`/`secondary`
- Keeps Copilot's GitHub CLI flow unchanged
- OpenAI status remains local-only