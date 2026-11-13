# Phase 3.3 architecture assessment

Written before implementation. Decisions are marked **Decision**.

## 1. Current application

- Vanilla JavaScript ES modules. No framework, no bundler, no `package.json` in the app root. Served as static files.
- Five main screens and four secondary screens (`js/router.js`, see `docs/NAVIGATION.md`). One `.screen` is in the layout at a time.
- All state is one object, `state.data` (`js/state.js`, version 3). It is saved as JSON to `localStorage`.
  - Real progress: `cala_state_v2`. Demo progress: `cala_state_demo_v1`. Mode flag: `cala_mode`.
  - Backups: `cala_backup_before_v3_*`, `cala_backup_unreadable`, `cala_backup_before_demo_split`.
- Everything the UI shows is derived from that object. `progression.js` is the only XP authority: total XP = baseline + legacy quest claims + reward ledger + workout history. Level, rank and attributes are computed from it. They are not stored.
- Character (`character.js`): id, name, selected cosmetics, unlocked cosmetics, preferences (`equipment: bar|parallel`, `focus: balanced|strength|skill`), attribute base.
- Quest engine (`quests.js`): deterministic daily quests (main, side, optional) generated from character preferences and workout history. Rewards are paid through the ledger with idempotent ids (`quest:<id>`).
- Workouts (`session.js`): `finishSession` writes one history record with a client generated id. XP rule: 10 per set + reps (timed holds: 1 per 5 s) + 25 bonus for a complete session.
- Achievements and cosmetic unlocks are derived from history and level. Skill purchases use `spentXp`.
- Demo mode is a separate storage slot with sample data and simulated rivals.
- There are no accounts. Anyone who opens the page owns the "real" slot.

## 2. Conflicts with Supabase

| Area | Conflict |
|---|---|
| No bundler | The spec names `VITE_*` variables. There is no Vite. |
| Hash router | Supabase email links can put tokens in the URL hash, which the router uses for screens. |
| Synchronous state | The whole app reads `state.data` synchronously. Network calls cannot sit in that path. |
| Client rules | The quest engine, achievements and level rules run in the browser. |
| Anonymous "real" slot | Protected data must need a login. |
| Quest generation | `bootGame` creates quests on every load, before any onboarding exists. |

## 3. Decisions

**D1. Stay buildless.** No Vite. Public config is `js/env.js` (generated from `.env` by `scripts/write-env.mjs`, using the names `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`). The anon key is public by design. The service-role key is never used by the frontend and not needed anywhere in this phase.

**D2. Vendor supabase-js.** `vendor/supabase.js` is the official UMD bundle of `@supabase/supabase-js@2.119.0` (MIT). No CDN at runtime.

**D3. PKCE auth flow.** Verification and reset links return `?code=...` in the query string, not tokens in the hash. The hash stays free for the router. The client removes the code from the URL after the exchange. Limit: opening the email link in a different browser than the one that signed up cannot finish the PKCE exchange. The email is still verified, and the user is told to log in.

**D4. The local engine stays; Supabase is the system of record.**
- The browser keeps running the existing engine against `state.data`. Nothing in the progression rules changes.
- After login the state is **hydrated from Supabase** into `state.data` and cached in a per-user localStorage slot (`cala_state_u_<userId>`). Cache is a copy, not the truth.
- Changes are **pushed** in small, idempotent operations (see D6). A failed push stays queued and retries.
- Offline: the cached slot is used and a banner says changes are waiting to sync.

**D5. Schema.** The tables in the spec, plus: `user_preferences.secondary_goals`, `policy_acceptances`, `app_state` (JSON for things that have no relational shape yet: weekly schedule, skill status, spent XP), `workouts.xp`.

**D6. XP integrity.**
- `xp_transactions` has `unique (user_id, source_type, source_id)`. A reward cannot be stored twice.
- Users have **no** insert, update or delete right on `xp_transactions`, `characters.level`, `characters.current_xp`, `characters.total_xp`. Column grants block direct writes.
- XP enters only through `security definer` functions:
  - `record_workout(...)` computes XP **on the server** from the submitted sets with the same rule as `xpForSet`. The client's XP number is ignored.
  - `record_quest(...)` and `grant_quest_reward(...)` pay a quest once. The amount comes from a server table (main 100, side 50, optional 40). `unique (user_id, quest_date, slot)` limits quests to three per day, which bounds quest XP per day.
  - `import_local_progress(...)` one-time import of pre-account progress (see D8).
- A trigger on `xp_transactions` recomputes `total_xp`, `current_xp` and `level` in `characters` with the same level curve as `progression.js`.
- **Honest limit:** workout sets and quest completion are still reported by the browser, because the engine runs there. The server bounds the damage (sets per workout, duration, daily workout XP, three quests per day, fixed rewards, idempotency) but cannot prove a workout happened. Full anti-cheat needs the engine on the server. Not in scope.

**D7. Onboarding is server-side state.** `profiles.onboarding_step` and `onboarding_completed` are only changed by functions (`save_character`, `save_goals`, `save_preferences`, `complete_onboarding`). Each function is idempotent. A user can resume on any device. `complete_onboarding` checks that character and preferences exist.

**D8. Existing local data.**
- The old `cala_state_v2` slot is never deleted or edited.
- After the first login, if it holds real progress and the account is new, the app offers: *Import to this account* or *Start fresh*. Nothing is uploaded silently, so a second person on the same browser cannot inherit it.
- Import runs `import_local_progress` once per account (unique transaction `legacy_import`). History is uploaded as workouts. Baseline XP is one transaction. If the import fails, the local data stays and a recovery message is shown. The import can be retried.
- Trust boundary: the imported baseline is claimed by the client. It is accepted once, validated for range, and marked as `legacy_import` so it can be audited.

**D9. Quests wait for onboarding.** `ensureDailyQuests` and `bootGame` only run when `profiles.onboarding_completed` is true (or in demo mode). Goal and preference answers map into the existing character preferences (`equipment`, `focus`) so the existing generator personalises quests without changes to its rules.

**D10. Gate and routes.** One module (`js/auth/gate.js`) decides the status: `loading`, `guest`, `unverified`, `onboarding`, `ready`, `demo`. The router asks it before showing any screen, on first load, link clicks and browser back/forward. Onboarding and auth screens have no tab bar and no header navigation.

**D11. Account deletion without a service key.** `delete_my_account()` is a `security definer` function that deletes the caller's row in `auth.users`. All user tables cascade. The app asks for the password again first. No Storage is used (avatars are built-in presets, no uploads), so no files can remain. If uploads are added later, the function must delete them first.

**D12. Policy acceptance.** `policy_acceptances (user_id, policy_type, version, accepted_at)`. Written by the signup trigger from the signup metadata, with `accepted_at` set by the database. Versions are checked against `policy_versions`.

**D13. Verification.** Supabase "Confirm email" must be on. As a second layer, every table policy and function also calls `is_email_verified()`, so an unverified session cannot read or write personal data.

## 4. Data migration summary

1. First login on a device with old local data and a new account -> prompt.
2. Import -> `import_local_progress` -> hydrate -> mark the old slot as imported (flag only, data kept).
3. Start fresh -> old slot stays untouched and is offered again from Profile > Account.

## 5. Required configuration

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public).
- Dashboard: Confirm email ON, redirect URLs, password min length 8, email templates (see `docs/SUPABASE-SETUP.md`).

## 6. Security considerations

- RLS on every table. Policies use `(select auth.uid())`.
- No password or token is stored by the app. supabase-js keeps its own session in `localStorage` (`sb-*` key). This is the library's standard storage. Passwords are never written there.
- No service-role key in any frontend file. A test scans the shipped files for it.
- Functions that run as owner set `search_path = ''` and use schema-qualified names.
- Rate limits and CAPTCHA are Supabase project settings and are listed as manual steps.

## 7. Implementation sequence

1. Migrations, then SQL tests on a real local Postgres with a stub `auth` schema.
2. Local Supabase-compatible test server (emulated GoTrue and PostgREST over the real SQL) so the real supabase-js client and the real app can be tested end to end.
3. Client modules: config, client, auth, gate, sync, migration.
4. Router guard, onboarding screens, account settings.
5. Wire quests to onboarding, wire push and pull to saves.
6. Tests, screenshots, docs, report.
