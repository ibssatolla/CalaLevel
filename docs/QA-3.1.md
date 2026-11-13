# Phase 3.1: quality assurance report

Scope: verify Phase 3, fix verified defects only, no new features. Date of the run: 2026-11-13.
Environment: headless Google Chrome (Playwright) on Linux, local static server, system time zone Europe/Oslo.
Everything below was executed unless it is listed under "Not executed".

## Automated tests (executed)

| Suite | Result |
| --- | --- |
| `unit3.mjs` (domain), Europe/Oslo | 82/82 |
| `unit3.mjs`, America/Los_Angeles | 82/82 |
| `unit3.mjs`, Pacific/Auckland | 82/82 |
| `unit3.mjs`, Asia/Kolkata and UTC (extra) | 82/82 each |
| `flows2.mjs` (Phase 2 regression) | 154/154, six runs in a row |
| `flows3.mjs` (Phase 2.1) | 80/80 |
| `flows4.mjs` (Phase 3) | 59/59 |
| `flows5.mjs` (new in 3.1) | 48/48 |

Dependencies were installed from `tests/package.json` with `npm install`. No `PLAYWRIGHT_DIR` or `LIBS_DIR` override was used for the final run.

## Browser flows (executed)

- New user: level 1, 0 XP, new character, three quests, all five tabs reachable (`flows4`).
- Character: rename (valid, empty, too long), avatar, frame, background, training focus, equipment, persistence after reload (`flows4`, `flows5`).
- Quests: generation, progress from workouts, reward paid once, reloads do not pay twice, expired quests stay expired and are never paid, a new day gives a new set (`flows4`, `flows5`).
- Workout: start, complete sets, pause, resume, complete, XP, quest progress, attributes, history record (`flows2`, `flows4`, `flows5`).
- Existing features: Skill Tree, achievements, Battle Arena, Park Map, demo mode, profile, navigation (`flows2`, `flows3`).

## Data integrity (executed)

`flows5` section A builds a save with the real Phase 2.1 app (3,000 XP baseline, a finished workout, a claimed legacy quest, Dips unlocked, an unfinished second workout, a demo slot), then opens it in Phase 3.

- XP and level identical before and after.
- Workouts, skills, spent XP, achievements and legacy quest claims unchanged.
- The unfinished session is kept and finishes normally (history +1, no second active session).
- `cala_backup_before_v3_live` equals the old save byte for byte.
- Demo slot is untouched until demo mode opens, then upgraded with its own character and a `_demo` backup. Live data does not change while in demo mode.
- XP on screen equals baseline + history + legacy claims + ledger.

## Mobile and desktop audit (executed, `qa31.mjs`)

Viewports: 320x568, 390x844, 375x812, 430x932, 768x1024, 1440x900. Live and demo data. Seven screens each, three modals, and workout mode.

- No horizontal overflow, no element outside the viewport, no clipped text, no empty icons, no console errors, no uncaught page errors.
- Body bottom padding is at least the tab bar height on every mobile size.
- All three modals and workout mode fit inside the viewport.
- Touch targets: at least 44 px on all touch viewports after the fix below.
- Desktop header links are 38 px high (mouse pointer, left as is).
- Screenshots: `docs/qa-3.1/`. Files named `v-*` are plain viewport shots. Files named `qa-live-*` are section crops of a full-page capture, so the fixed header or tab bar can appear in the middle of them. That comes from the capture method, not from the page.

## Performance and reliability (executed)

- Load with 4x slower CPU: quest board visible in about 0.7 to 0.9 s, 196 KB JS, 71 KB CSS, state about 6 KB, about 1,460 DOM nodes.
- Idle: no mutation of the quest board or XP text in 3.5 s.
- Listeners on `document` and `window` stay constant after 3 workouts, a rename and navigation (net of add and remove, after the lazy map has started).
- `localStorage.setItem` throwing and `localStorage.getItem` throwing: the app loads, a workout finishes, no uncaught errors.
- Scripts, fonts, map tiles and Spline blocked: quests, profile, workout and rewards still work, map section still renders.
- Offline, midnight, time zones, reduced motion: `flows4`.

## Bugs found and fixed

1. After a workout ended, the other workout cards stayed `aria-disabled` until reload, so Mobility could not be started right after Push. Present since Phase 2.1. Fixed in `js/session.js` (`updateSelectionState()` after the record is saved). Regression check in `flows5`.
2. The rename button used the list icon. Added a pencil icon (`edit`) in `js/icons.js` and used it in `index.html`.
3. Quest card footer: the difficulty dots sat lower than the progress text because of an old `margin-top`. Reset in `styles.css`.
4. Profile card on phones: the XP bar was only as wide as its text. The identity block now uses the full card width.
5. `.btn-sm` and `.chip` were 40 px high on touch screens. They are now 44 px with `pointer: coarse`.

## Test defects fixed (not app defects)

- `flows2` depended on the weekday it ran on (written on a Thursday). The harness now starts the page clock on a Thursday and lets it run (`fixedTime` option).
- `flows2` leaderboard check assumed no quest pays out. One 15-rep set can complete the random side quest, so the expected XP now includes the ledger.
- The new listener test first counted only `add`. It now counts net listeners and warms up the lazy map first.

## Not executed

- Real phones or tablets. All checks ran in desktop Chrome with touch emulation.
- Safe-area insets. The CSS uses `env(safe-area-inset-*)` (checked in the stylesheet), but no device with a notch was used.
- Safari and Firefox.
- Contrast ratios were not re-measured for the Phase 3 screens.
- Real GPS and live routing. The routing server is blocked in the sandbox.
- Long-term storage growth. Quest history grows by about 1 KB per day and is not pruned.

## Remaining limitations

- `localStorage` can be edited by hand. Online rankings would need server checks.
- Setup changes (equipment, focus) apply from the next day.
- Phase 2 quests that were done but unclaimed at upgrade cannot be claimed.
- The history card on the Quests screen has a 560 px maximum width. This is intentional.
