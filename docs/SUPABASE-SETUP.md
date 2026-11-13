# Supabase setup

The project `qhmdfaiqunmxkfibytqg` exists and has the three migrations applied (steps 1 and 2 are done). Steps 3 and 5 are still open. See `docs/SUPABASE-LIVE-CHECK.md` for what was checked and what was not. The steps are kept in full for a second project or a rebuild.

## 1. Create the project

1. Sign in at supabase.com and create a project. Pick the region closest to your users.
2. Save the database password in a password manager. The app never needs it.
3. Open Project settings > API. Copy two values:
   - Project URL (`https://<ref>.supabase.co`)
   - The public key: the `anon` key or the `publishable` key.
4. Do not copy the `service_role` or `secret` key anywhere in this repository. `scripts/write-env.mjs` stops if it sees one.

## 2. Run the migrations

Run the three files in `supabase/migrations/` in order. Each file runs once. On the live project they are already applied. Do not run them again there.

Dashboard route: SQL editor > New query > paste the file > Run. Repeat for the next file.

CLI route:
```
supabase login
supabase link --project-ref <ref>
supabase db push
```
For the live project the files were applied through the Supabase tool connection, not the CLI. The file names carry the versions the project recorded, so `supabase db push` after `supabase link` should report nothing to do. Check with `supabase migration list` first. Never use `supabase db reset` on a hosted project.

After the run, check Table editor. Every table must show RLS enabled. Then run Database > Advisors (security) and fix anything it reports.

## 3. Authentication settings

All of these are dashboard settings. The repository cannot set them for you.

| Setting | Where | Value |
|---|---|---|
| Confirm email | Authentication > Providers > Email | On |
| Secure email change | same | On |
| Minimum password length | Authentication > Policies (or Sign In / Providers) | 8 |
| Password requirements | same | Lower case, upper case and digits |
| Site URL | Authentication > URL configuration | The URL where the app is served |
| Redirect URLs | same | Every origin and path you serve the app from, for example `https://app.example.com/`, `http://localhost:8080/` |
| Rate limits | Authentication > Rate limits | Keep the defaults or lower them |
| Allow new users to sign up | Authentication > Sign in / Providers | On |
| Anonymous sign-ins | same | Off. The app does not use them. |

`.env` sits in the app folder and a static server serves it. It holds only the two public values and is git-ignored. For a real deployment, upload `js/env.js` and leave `.env` out.

The app builds its link target from `location.origin + location.pathname`. That exact URL must be in the redirect list. If it is not, Supabase falls back to the Site URL and the verification link opens the wrong page.

### Email templates

Authentication > Email templates. Use the default templates, which carry `{{ .ConfirmationURL }}`. The app uses the PKCE flow, so the link comes back as `?code=...`. The code can only be exchanged in the same browser that requested it. If a user opens the link in another browser, the code exchange fails and the app shows "That link has expired or was opened in another browser. Log in, or ask for a new link." Supabase should already have confirmed the email at that point, so a normal login works. This behaviour is untested against a live project.

The built-in mail service has a low hourly limit and is meant for testing. Set up custom SMTP (Project settings > Authentication > SMTP) before real users sign up.

## 4. Connect the app

```
cp .env.example .env
# edit .env: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
node scripts/write-env.mjs
```
This writes `js/env.js`. The app has no build step, so this file is its config. Both values are public. Do not commit `.env`.

Serve the folder as static files over HTTP (for example `npx serve .`). Do not open `index.html` with `file://`. Auth links and ES modules need HTTP.

Without a valid `.env`, the app shows a setup screen and demo mode still works.

## 5. Check by hand

1. Sign up with a real address. Expect the verify screen.
2. Open the email link in the same browser. Expect the character screen.
3. Finish onboarding. Expect Home with quests.
4. In the SQL editor, run `select * from public.profiles;` and confirm one row, `onboarding_step = 'done'`.
5. Log out, log in. Expect Home, no onboarding.
6. Try Forgot password. Open the link, set a new password, log in.
7. Delete the account from Profile > Account. Confirm the rows are gone.

Record the result in `docs/TEST-RESULTS-3.3.md` under "Live Supabase". The same list is in `docs/SUPABASE-LIVE-CHECK.md`.

## Security notes

- The browser holds only the public key. All table writes go through `security definer` functions. Tables are read-only for `authenticated`.
- If the anon key leaks, nothing changes. If the service-role key leaks, rotate it in the dashboard at once.
- The password is sent to Supabase Auth and is never stored by the app. The session token lives in the supabase-js storage key `cala-auth`. That is the library's own storage, not a custom copy.
