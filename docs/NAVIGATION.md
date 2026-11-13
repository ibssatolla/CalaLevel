# Navigation (Phase 3.2)

The app is a set of screens. The bottom bar switches screens. It does not scroll.

## Routes

| Route | Type | Parent tab |
|---|---|---|
| `home`, `quests`, `train`, `discover`, `profile` | main | itself |
| `skills`, `arena`, `map` | secondary | discover |
| `library` | secondary | train |

Old hashes: `#top` -> home, `#training` -> train, `#community` -> arena, `#features` -> discover, `#programs` -> train (scrolls to programs). Unknown hashes go to home.

## Behaviour

- Each screen is a `.screen` element. Inactive screens have `hidden`.
- The window scrolls. The router saves scrollY per route and restores it on return.
- Each tab remembers its last screen. Tapping the active tab on a secondary screen goes to the tab root. Tapping it on a root screen scrolls to the top.
- Secondary screens use `pushState`. Main screens use `replaceState`. The header back button calls `history.back()` when there is history, otherwise it goes to the parent.
- Transitions: fade for tab changes, slide in from the right for push, from the left for back. Reduced motion makes them near instant.
- On each change the router updates active tab, `aria-current`, header title, back button, `document.title`, focus (screen heading) and the live region `#screen-announcer`.
- The map starts when its screen first opens. Entering it sends a `resize` event so Leaflet re-measures.

## Safe areas

`viewport-fit=cover`. Header uses `env(safe-area-inset-top)`. Tab bar uses `env(safe-area-inset-bottom)`.

## Adding a screen

Add a `<div class="screen" id="screen-<id>" data-screen data-tab data-title hidden>` in `index.html`, add the route to `js/router.js`, and link to `#<id>`.

## Tests

`tests/flows6.mjs`. Not tested: a real phone, Safari, Firefox.
