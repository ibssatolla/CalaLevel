# Known limitations (Phase 3.3)

## Not verified on real Supabase
- The live project is connected and migrated, but no account flow has run on it. See `docs/SUPABASE-LIVE-CHECK.md`.
- The migrations were applied through the tool connection, not the CLI. `supabase/config.toml` was written by hand and not checked with the CLI.
- Dashboard settings (Site URL, redirect URLs, password rules, SMTP, rate limits) are unconfirmed.
- The security advisor reports 14 warnings for the RPC functions that signed-in users may call. This is intended.
- The email link opened in a different browser than the one that signed up: the PKCE code cannot be exchanged. The app shows a message. The real Supabase behaviour here is untested.

## Cheating
- Workouts and quest completion are reported by the browser. The server checks ranges, the daily XP cap (3000), the quest count and the reward caps. It cannot tell whether a workout happened.
- Achievements and cosmetics are reported by the browser. The server accepts only ids in `unlock_catalog`.
- `spentXp` (skill purchases) is stored in the state snapshot and can be forged.
- A user can read their own data and call the functions directly. That is allowed. They cannot change XP or level except through the functions' rules.

## Behaviour
- Accounts and demo need `localStorage`. With blocked storage (some private modes) Welcome shows a notice and progress cannot be kept.
- Offline: a returning user who has a local copy can open the app. A new account cannot sign up offline. Changes made offline sync when the connection returns. Two devices editing offline at once resolve by the server ledger for XP and by last write for the state snapshot.
- Email links must open in the same browser that asked for them.
- Local progress made before accounts is imported once per account. After that, the old local copy is only a backup.
- The Terms and Privacy texts (screens `terms` and `privacy` in `index.html`) are drafts written for this phase. The owner must have them reviewed before launch. They are not legal advice.
- Account deletion removes the user and all rows. It does not remove backups kept by Supabase.
- The login does not offer social providers or magic links.

## Password reset (3.3.3)

- Only the newest reset email works. Each request writes a new code in the browser.
- The link must open in the browser that asked for it. Opening it elsewhere uses up the link, and the user must ask for a new one.
- The send limits (60 s, 5 per hour) live in the browser. They protect the mail quota but do not replace the server limits.
- Supabase's built-in mailer allows very few emails per hour. Set up custom SMTP before real users depend on reset.
