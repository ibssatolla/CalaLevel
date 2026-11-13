# Tests

## Domain tests (Node only, no install)
```
node tests/unit3.mjs
TZ=America/Los_Angeles node tests/unit3.mjs
TZ=Pacific/Auckland node tests/unit3.mjs
```
Covers character creation and migration, attributes, cosmetics, quest generation, difficulty tiers, recovery rules, daily uniqueness, midnight, expiry, time zones and daylight saving, reward idempotency and events.

## Browser tests
Need Google Chrome and `playwright-core`.
```
cd tests
npm install
node flows2.mjs   # Phase 2 regression: dashboard, skill tree, workouts, map, navigation, demo mode
node flows3.mjs   # Phase 2.1: fresh user, migrations, GPS, lazy loading
node flows4.mjs   # Phase 3: quests, rewards, character, offline, midnight, time zones
node flows6.mjs   # Phase 3.2: screens, routes, back, tab memory, scroll, safe areas
node flows5.mjs   # Phase 3.1: migration from a save made by the real Phase 2.1 app, demo/live split, storage and network failures, listeners, expired quests
node qa31.mjs     # Phase 3.1: five viewports (plus 320 px), overflow, tap targets, clipping, icons, modals, console, failed requests. Writes screenshots and shots/qa-report.json
node perf31.mjs   # load time with 4x slower CPU
```
Set `CHROME_PATH` to use another Chrome or Chromium. The map libraries come from `node_modules` (installed above), so the tests also run offline. Screenshots go to `tests/shots`.

`flows5.mjs` reads the Phase 2.1 app from `P21_ROOT` (default `../../phase2.1-backup`). Without it, section A is reported as `NOT EXECUTED`.

## Phase 3.3: accounts and database

These need PostgreSQL 16 on a local socket and the packages in `tests/supabase` (`cd tests/supabase && npm install`).
```
# once: start a throwaway server (socket /tmp, port 54329, user postgres). Override with PGHOST, PGPORT, PGUSER.
node supabase/sql-tests.mjs   # real migrations, RLS, grants, XP integrity, onboarding, import, deletion (33 checks)
node flows7.mjs               # new user, signup to Home
node flows8.mjs               # returning user, session restore, password reset, security, deletion
node flows9.mjs               # demo isolation, XP integrity, offline, migration, profile edit, blocked storage
```
The online suites start `tests/supabase/local-supabase.mjs`, a stand-in for Supabase auth and REST over a real PostgreSQL with the real migrations. It is not Supabase. Results and limits: `docs/TEST-RESULTS-3.3.md`.

`flows2` to `flows6` run as a signed-in offline user (the harness injects a fake session and a cached account). Pass `account: false` to the harness to turn that off.
