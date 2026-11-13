# Vendored libraries

- `supabase.js`: official UMD bundle of `@supabase/supabase-js` 2.119.0 (MIT licence). Copied from `node_modules/@supabase/supabase-js/dist/umd/supabase.js`. It sets `window.supabase`.
  The app loads it only when a real account is used. Demo mode never loads it.
  To update: install the new version with npm, copy the same file, re-run the tests.
