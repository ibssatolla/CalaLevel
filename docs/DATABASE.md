# Database

Migrations: `supabase/migrations/`. Run in order. They target Supabase (Postgres 15+). They were tested on Postgres 16 with a stub `auth` schema, and applied to the live project `qhmdfaiqunmxkfibytqg` (Postgres 17) on 2026-11-13. The file names carry the version numbers the live project recorded, so a later `supabase db push` sees them as already applied.

| File | Content |
|---|---|
| `20261113091735_core_schema.sql` | Tables, constraints, indexes, triggers, reference data |
| `20261113091907_functions.sql` | The RPC functions the app calls |
| `20261113091918_security.sql` | RLS, policies, grants and revokes |

## Tables

The nine tables in the spec, plus four support tables.

| Table | Content |
|---|---|
| `profiles` | One row per user: email copy, username, onboarding step, completion time |
| `characters` | Name, avatar, cosmetic choice, `total_xp`, `current_xp` and `level` (read-only for users) |
| `user_preferences` | Primary goal, secondary goals, experience, environment, equipment, frequency, duration |
| `workouts` | One row per finished workout. XP is computed by the server. |
| `quests` | Daily quests per user and date |
| `quest_progress` | Progress and completion per quest |
| `xp_transactions` | Append-only XP ledger. Unique on `(user_id, source_type, source_id)`. |
| `achievements` | Unlocked achievements |
| `cosmetics` | Unlocked cosmetics |
| `app_state` | Opaque JSON of the local state, for restore on a new device |
| `policy_acceptances` | Terms and privacy version and timestamp per user |
| `policy_versions` | Current versions (public read) |
| `unlock_catalog`, `quest_reward_caps` | Reference data (public read) |

All user tables reference `auth.users(id) on delete cascade`. Deleting the auth user removes every row.

## RLS and grants

- RLS is on for every table.
- `authenticated` has `select` on its own rows only (`user_id = auth.uid()`). It has no `insert`, `update` or `delete` on any table.
- `anon` can read only `policy_versions`, `unlock_catalog` and `quest_reward_caps`.
- Every write goes through a `security definer` function with a fixed `search_path`. Each one calls `_require_user()` and uses `auth.uid()`, never a user-supplied id.
- `is_email_verified()` checks `auth.users.email_confirmed_at`. Progress functions refuse unverified users, so a missing client check is not enough to write data.
- Triggers: `characters_guard_xp` blocks direct XP or level changes. `xp_transactions` rejects update and delete. `xp_transactions_recalc` sets character XP and level from the ledger.

## Functions

| Function | Purpose |
|---|---|
| `get_progress()` | Profile, character, preferences, totals, history for hydration |
| `set_username(text)` | 3-24 characters, letters, digits and underscore, unique |
| `accept_policies(terms, privacy)` | Stores versions and time. Rejects unknown versions. |
| `save_character(name, avatar, options)` | Name 1-20 characters, cosmetics must be unlocked |
| `save_goals(primary, secondary[])` | Needs the character first |
| `save_preferences(...)` | Validates every field |
| `complete_onboarding()` | Needs verified email, accepted policies, character, goals, preferences |
| `record_workout(...)` | Server computes XP. Daily cap 3000. Idempotent by workout id. |
| `sync_quests(jsonb)` | At most 5 quests per day. Rewards capped by slot: 100, 50, 40. Idempotent. |
| `sync_unlocks(achievements[], cosmetics[])` | Only ids in `unlock_catalog` |
| `save_app_state(jsonb)` | Stores the state snapshot |
| `import_local_progress(jsonb)` | One-time import into an empty account |
| `delete_my_account()` | Deletes the auth user and, by cascade, all data |

Onboarding steps only move forward (`_step_rank`). Calling a step function twice gives the same result.

## Error codes

Functions raise `P0001` with a short code as the message. `js/cloud/errors.js` turns the common ones into user text. The rest fall back to a generic message.

`not_authenticated`, `email_not_verified`, `policies_not_accepted`, `unknown_policy_version`, `invalid_username`, `username_taken`, `invalid_name`, `invalid_cosmetics`, `invalid_goal`, `goals_required`, `invalid_preferences`, `preferences_required`, `character_required`, `onboarding_incomplete`, `invalid_workout`, `daily_xp_cap`, `invalid_quests`, `invalid_unlocks`, `invalid_state`, `invalid_import`, `account_not_empty`, `xp_is_read_only`, `ledger_is_append_only`.

## XP integrity

- A reward is one ledger row. The unique key on `(user_id, source_type, source_id)` makes a repeat call a no-op.
- The character `xp` column is derived from the ledger by trigger. Users cannot write it.
- Browser total = server total. On load the client sets its baseline to `server_total - ledger - history_xp`, so the same account shows the same XP on every device.

Limits: the server cannot know whether a workout really happened. It checks plausible ranges and the daily cap, nothing more. See `docs/KNOWN-LIMITATIONS-3.3.md`.

## Data migration (local to account)

1. After the first login, the app looks for a local save from before accounts (the old key `cala_state_v2`).
2. If it finds progress, the import screen offers "Import" or "Start fresh".
3. Import calls `import_local_progress`. The old data is never changed or deleted by the app. It stays as a backup. If the call fails, the local data stays and the screen offers a retry.
4. The function runs once per account. A second call returns `{imported:false, reason:'already_imported'}`. A non-empty account raises `account_not_empty`.
5. Profile > Account has "Import again" for the case where the user chose fresh and changed their mind, as long as the account is still empty.

## Password reset

Forgot password sends the Supabase reset mail. The link returns with `?code=`. The app exchanges the code, shows the Reset screen (the `recovery` gate status) and blocks all other routes until a new password is set. Same browser required.

## Account deletion

Profile > Account > Delete. The user types the password. The app re-authenticates, calls `delete_my_account()`, clears every `cala*` key for that user, and reloads at Welcome.
