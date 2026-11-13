# Live Supabase check (Phase 3.3.2)

Project: `CalaLevel`, ref `qhmdfaiqunmxkfibytqg`, region eu-west-1, Postgres 17. Date: 2026-11-13.
Frontend key: the publishable key (`sb_publishable_...`). No `sb_secret_` key, service-role key or database password was used or stored.

The Supabase CLI was not available in the workspace, and the workspace cannot reach supabase.co. The migrations were applied with the Supabase tool connection (`apply_migration`). Checks from a browser ran in the built-in browser pane of the desktop app.

## What was done

| Step | Result |
|---|---|
| Project state before | Empty: 0 tables, 0 migrations |
| `20261113091735_core_schema` | Applied, no error |
| `20261113091907_functions` | Applied, no error |
| `20261113091918_security` | Applied, no error |
| Remote migration list | The 3 versions above |
| `.env` and `js/env.js` | Written with URL and publishable key. `node scripts/write-env.mjs` printed `Wrote js/env.js` |

The applied SQL has the comment lines removed. Code is unchanged. Checked after applying: for all 29 public functions and all 14 tables, a hash of the definition on the live project equals the hash on a local database built from the files in `supabase/migrations/`.

The local files were renamed to the version numbers the live project recorded. Before: `20261113000001_...`, `...000002_...`, `...000003_...`. Now the names in the table above. This keeps `supabase db push` from trying to apply them a second time.

## Verified against the live project

- Auth service answers: `/auth/v1/health` returns 200.
- The publishable key is accepted by Auth and REST.
- `/auth/v1/settings`: email provider on, no other provider, `mailer_autoconfirm = false` (Confirm email is ON), sign-ups open.
- 14 tables exist, RLS on for all 14, 14 select policies.
- 29 functions exist, 10 triggers exist (on `auth.users`, `characters`, `xp_transactions`, and the touch triggers).
- Reference data: 2 policy versions, 28 unlock items, 3 quest reward caps.
- Table grants: neither `anon` nor `authenticated` has insert, update or delete on any table.
- `anon` can execute no function. `authenticated` can execute exactly 14 (the app's RPCs and `is_email_verified`).
- From the browser, with the publishable key and no login:
  - `policy_versions` and `unlock_catalog` can be read.
  - `profiles` and `xp_transactions` give `permission denied`. An insert into `profiles` gives `permission denied`.
  - `get_progress`, `record_workout` and `delete_my_account` give `permission denied`.
  - A wrong password gives `Invalid login credentials`.
  - The supabase-js 2.119.0 client (loaded from a CDN, not the vendored copy) starts with the project URL and key and returns no session.
- As `authenticated` with a made-up user id (SQL session, no user created, rolled back): `profiles` and `xp_transactions` show 0 rows, `is_email_verified()` is false, `get_progress()` raises `email_not_verified`, a direct `update` on `characters` gives `permission denied`.
- Security advisor: 14 warnings, all `authenticated_security_definer_function_executable`. These are the 14 RPCs. That is the design: each one reads `auth.uid()` and refuses unverified users. No other warning.
- The app with the real `js/env.js` (`tests/real-config.mjs`, 14/14): setup screen does not appear, Welcome, Signup, Login and Forgot load, guest is sent from `#home` and `#profile` to Welcome, demo mode opens Home and makes no request to Supabase. Here requests to supabase.co were blocked, so this tests the app side only.
- Local suites after the change: `sql-tests` 33/33, `flows7` 59/59, `flows8` 53/53. One check in `flows8` was changed: it required that `.env` does not exist in the app folder. `.env` now exists on purpose, so the check requires that it is git-ignored and holds no secret.

## Not verified

- A real signup, login, verification mail, reset mail, onboarding, workout, quest, import or deletion on the live project. No user was created, on purpose.
- Cross-user RLS with two real accounts. Only the "no rows for an unknown user" case was run.
- The vendored `vendor/supabase.js` against the live project (the CDN copy of the same version was used).
- The full app in a browser against the live project. The built-in browser cannot open a server started in the workspace, and the app is not hosted anywhere yet.
- Email delivery, SMTP, rate limits, the Site URL and Redirect URL settings. The dashboard values cannot be read with the tools used here. The settings endpoint above does not show them.
- Password policy on the server side.

## Commands

Done:
```
node scripts/write-env.mjs
node tests/real-config.mjs
node tests/supabase/sql-tests.mjs
node tests/flows7.mjs && node tests/flows8.mjs
```
Not done, and for you: `supabase login`, `supabase link --project-ref qhmdfaiqunmxkfibytqg` (asks for the database password in the terminal, not in chat), `supabase migration list` (expect 3 rows, local and remote equal). Never run `supabase db reset` against this project.

## Manual dashboard settings still open

Mark each as done once checked. See `docs/SUPABASE-SETUP.md` for the reasons.

| Setting | Where | Value | Status |
|---|---|---|---|
| Confirm email | Authentication > Sign In / Providers > Email | On | On (read from the settings endpoint) |
| Site URL | Authentication > URL configuration | URL where the app is served | Open |
| Redirect URLs | same | `<origin>/<path>/` for every place the app runs, for example `http://localhost:8080/` | Open |
| Password requirements | Authentication > Sign In / Providers | 8 or more, lower, upper, digit | Open |
| Custom SMTP | Project settings > Authentication > SMTP | Your own mail service | Open. Without it the built-in mailer has a very low hourly limit |
| Email templates | Authentication > Email templates | Defaults, link carries `{{ .ConfirmationURL }}` | Open |
| Rate limits | Authentication > Rate limits | Defaults or lower | Open |
| Anonymous sign-ins | Sign In / Providers | Off | Open |

Email verification and password reset count as unverified until one real mail has gone through and the link has opened the app.

## First live test (you, about 10 minutes)

1. Add the redirect URL for how you serve the app. Serve the folder with `npx serve .` and note the port.
2. Open the app, sign up with your own address, open the mail link in the same browser.
3. Finish onboarding. In the SQL editor: `select onboarding_step from public.profiles;` shows `done`.
4. Log a workout. `select source_type, xp_amount from public.xp_transactions;` shows one row. Reload: the XP is the same.
5. Try Forgot password, then delete the account from Profile > Account. Both tables are empty afterwards.
6. Write the result in `docs/TEST-RESULTS-3.3.md`.

## Reset flow (3.3.3)

Not verified on the live project yet. To test: ask for a link, wait for the email, open it in the same browser, set a new password. Expected: the new-password screen, then Home. In the dashboard, add `http://127.0.0.1:5501/` under Redirect URLs, and set up custom SMTP.
