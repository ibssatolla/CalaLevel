# CalaLevel

Vanilla JavaScript (ES modules), no build step, state in `localStorage`. Gamified calisthenics tracker.

## Rules
- Keep the design system (`css/tokens.css`). No new dependencies.
- One XP authority: `js/progression.js`. Rewards go through `grantReward()` (ledger, idempotent by id). Do not add XP anywhere else.
- Domain code (`character.js`, `quests.js`, `game.js`, `progression.js`) has no DOM access. UI files (`*-ui.js`, `dashboard.js`, `profile.js`) only render.
- Only `js/state.js` touches `localStorage` for game state. `js/auth/gate.js` owns the gate and per-user cache keys.
- The browser never writes tables. Writes go through the RPC functions in `supabase/migrations/`. Never add the service-role key or any secret to the repo or `js/env.js`. Never store passwords.
- Account status and routing: `js/auth/gate.js`. Cloud calls: `js/cloud/`. Onboarding: `js/onboarding/`. Setup: `docs/SUPABASE-SETUP.md`. Demo mode must not call Supabase. New state fields need a sanitizer there and a state version bump if the shape changes.
- Real progress and demo progress are separate slots. Never seed demo data into a real account.
- Existing saves must keep loading. Back up before any migration.

## Layout

Screens and routing: `js/router.js`, see `docs/NAVIGATION.md`. One `.screen` is visible at a time.
- `js/config.js` game numbers, `js/quest-templates.js` quests, `js/cosmetics.js` cosmetics, `js/events.js` event bus.
- `docs/PHASE3.md` explains the character system, quest engine, date strategy and migration.

## Tests
- `node tests/unit3.mjs` (Node only, domain). Try `TZ=America/Los_Angeles node tests/unit3.mjs`.
- Browser tests in `tests/` need `playwright-core` and Chrome. See `tests/README.md`. Run `flows2` to `flows9` and `node tests/supabase/sql-tests.mjs` (needs local PostgreSQL 16, see `tests/README.md`); `qa31.mjs` audits layout on six viewport sizes.
