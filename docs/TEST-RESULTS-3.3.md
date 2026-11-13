# Phase 3.3 test results

Run on 2026-11-13 in the cloud workspace: Chrome (playwright-core), Node, PostgreSQL 16.

**Every online test ran against a local stand-in, not against Supabase.** The stand-in (`tests/supabase/local-supabase.mjs`) serves the auth and REST endpoints that supabase-js calls. Behind it sits a real PostgreSQL with the real migrations, the real API roles and JWT claims. RLS, grants, functions and triggers are real. Email delivery, rate limits, token lifetimes, JWT signing keys and dashboard settings are not.

## Results

| Suite | Command | Result |
|---|---|---|
| SQL: migrations, RLS, grants, XP integrity, onboarding, import, deletion | `node tests/supabase/sql-tests.mjs` | 33/33 |
| Domain | `node tests/unit3.mjs` | 82/82 |
| Phase 2 regression (signed-in offline user) | `flows2` | 145/145 |
| Phase 2.1 | `flows3` | 80/80 |
| Phase 3 quests and character | `flows4` | 59/59 |
| Phase 3.1 migration, failures | `flows5` | 47/47 |
| Phase 3.2 screens | `flows6` | 66/66 |
| New user: signup to Home | `flows7` | 59/59 |
| Returning user, session restore, reset, security, deletion | `flows8` | 53/53 |
| Demo isolation, XP integrity through the app, offline, migration, profile edit, blocked storage | `flows9` | 48/48 |

`flows9` failed once in four runs because a check read a button before an async lookup finished. The check now waits. Five runs after the change passed.

`flows3` prints a console error from the OSRM routing service (no internet in the workspace). The check treats it as expected and passes.

## Mutation checks

Each change was made on purpose, the tests were run, and the change was reverted.

| Change | Detected by |
|---|---|
| Remove the daily XP cap | 2 SQL tests |
| Drop the reward uniqueness constraint | 6 or more SQL tests |
| Grant `update` on `characters` | 2 SQL tests |
| Route guard that allows every route | `flows7` crashed |
| Write the password to `localStorage` | `flows8` password check |

## What the tests cover

- New user: welcome, signup validation, verify screen, resend cooldown, verification link, character, goals, preferences, completion, quests only after completion, bottom nav hidden on flow screens, progress saved after each step, resume after reload, repeated calls.
- Returning user: login, wrong password, session restore, no onboarding for existing users, logout, protected routes, reset password by link, deletion with password.
- Security: direct table writes denied, XP and level not writable, other users' rows invisible, anon limited to reference tables, unverified user refused by functions, no password or secret in browser storage.
- Demo: separate storage slot, banner, no cloud calls, no account routes, nothing seeded into a real account.
- XP: no duplicate reward on repeat or from two devices, browser total equals server total after reload.
- Migration: local progress imports once, a failed import keeps local data, a second import is refused.
- Technical: console errors, failed requests, blocked storage, offline start for a returning user.

Screenshots from the real app: `tests/shots/33-*.png` (welcome, signup, login, forgot, verify, character, goals, preferences, completion, home, bottom nav, profile, account, import prompt, preference edit, demo).

## Not executed

- Account flows on the live project (signup, mail, login, onboarding, workout, import, deletion). Only structure, grants and anonymous access were checked there.
- Real email delivery, spam filtering, the real verification and reset mail.
- Supabase rate limits and Auth dashboard settings.
- Session expiry and token refresh over a long session.
- `qa31` (viewport audit) and `perf31` were not re-run after Phase 3.3 changes.
- A real iPhone or Android browser.

## Live Supabase (Phase 3.3.2)

The three migrations are applied to the live project and its structure, grants and policies were checked. Anonymous access is denied as intended and the publishable key works. No account flow ran on the live project. Details, commands and open items: `docs/SUPABASE-LIVE-CHECK.md`. The numbers above are still from the local stand-in.

## 3.3.3 reset fix

`flows8` now has 60 checks against the local stand-in (real Postgres and supabase-js, not Supabase): countdown after a send, a 429 keeps the earlier code and shows a wait, the 5-per-hour limit, a link in another browser, an expired link with an error in the address, and the link opening the new-password screen. Other suites unchanged and green. Not run against the live project.
