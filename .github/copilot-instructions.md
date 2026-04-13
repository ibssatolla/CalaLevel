# CalaLevel - AI Coding Instructions

## Project Overview
**CalaLevel** is a gamified calisthenics training application built with vanilla JavaScript. It's an RPG-style fitness tracker where users earn XP, unlock skills via a skill tree, compete in battles, and discover workout parks on an interactive map.

## Architecture & Data Flow

### Core Modules (`js/` directory)

**`state.js`** - Single source of truth using localStorage
- Manages app state via `state.data` object with hardcoded defaults
- Structure: `userProfile` (level, XP, achievements), `skills` (skill tree graph), `challenges`, `leaderboard`, `weeklySchedule`
- Persistence: Uses `localStorage` with key `cala_state_v1`; handles version migrations
- **Pattern**: Always call `saveState()` after mutations to persist changes

**`map.js`** - Leaflet.js-based park discovery system
- Hardcoded `parksData` array (~24 parks across 6 Norwegian cities)
- Features: real-time geolocation tracking, route navigation, filtering (all/unclaimed/claimed)
- Global state: `userLocation`, `isNavigating`, `isTrackingMode`, `currentDestination`
- Integration: Leaflet Routing Machine for turn-by-turn navigation
- **Pattern**: Filter buttons trigger `renderMarkers()` and filter by `currentFilter` value

**`utils.js`** - UI helpers
- `showToast()`: Toast notification system (3s auto-dismiss)
- `capitalize()`: String formatting utility

**`script.js`** - Main orchestrator (795 lines)
- Initializes modules on `DOMContentLoaded`
- **Skill Tree System**: Renders interactive nodes with SVG connection lines; locks based on parent requirements
- **Battles System**: Challenge cards and sorted leaderboard (dynamically updates "You" rank)
- **Profile UI**: XP bar animation, level badge, achievement display
- **3D Core**: Spline 3D viewer integration for progress visualization

### Data Model Patterns

**Skill Tree Structure**:
```javascript
{ id, name, level, status: 'locked'|'unlocked'|'mastered', cost, x, y, parents: [] }
```
- Parent-child relationships via `parents` array (IDs)
- Unlock requires: all parents `mastered` or `unlocked` + sufficient XP

**User Profile**:
```javascript
{ level, rankTitle, xp, nextLevelXp, stats, activity, achievements }
```
- XP and level linked; achievements track progression milestones

## Critical Developer Workflows

### Adding UI Features
1. Create DOM elements in `index.html` (use `.glass-card` class for consistency)
2. Add selectors & event listeners in `script.js`
3. Update UI via render functions (e.g., `renderSkillTree()`, `renderBattles()`)
4. Persist state changes: `saveState()` after mutations

### Modifying Skill Tree
- Edit `defaultState.skills` in `state.js`
- Use percentage-based positioning (`x`, `y` as CSS percentages)
- Run `renderSkillTree()` to re-draw nodes and SVG connections
- Test unlock logic: check parent requirements in `handleSkillClick()`

### Adding Parks
- Add entries to `parksData` in `map.js` (include lat/lng, difficulty, type)
- Filter system uses `type: 'claimed'|'unclaimed'|'my-team'`
- `renderMarkers()` handles display; Leaflet auto-manages markers

### Updating UI Theme
- All colors in `styles.css` `:root` CSS variables (`--primary`, `--secondary`, etc.)
- Glass-morphism effect: `.glass-card`, `.glass-header` (uses `rgba()` borders)
- Typography: Outfit font family; responsive breakpoints use rem units

## Project Conventions

**Naming**:
- State objects: camelCase (e.g., `userProfile`, `currentFilter`)
- DOM class names: kebab-case (e.g., `skill-node`, `glass-card`)
- Constants/categories: match domain (e.g., skill types, park types)

**Error Handling**:
- `localStorage` operations wrapped in try-catch
- Geolocation failures handled gracefully (watches for permission denial)
- Missing DOM elements checked with `if (element)` before use

**State Mutations**:
- Always mutate `state.data` directly (not via return values)
- Call `saveState()` immediately after mutations
- Re-render affected UI components synchronously

## External Dependencies

- **Leaflet.js** + **Leaflet Routing Machine** - Map and navigation
- **Spline 3D Viewer** - Embedded 3D progress visualization
- **Google Fonts (Outfit)** - Typography
- **CartoDB Dark Matter tiles** - Map styling

## Common Integration Points

| Feature | Files | Key Functions |
|---------|-------|----------------|
| Skill unlocking | `script.js`, `state.js` | `unlockSkill()` → `saveState()` |
| Park filtering | `map.js` | Filter buttons → `renderMarkers()` with `currentFilter` |
| Toast notifications | `utils.js`, any module | `showToast(title, message)` |
| XP changes | `state.js`, `script.js` | Update `userProfile.xp` → `renderProfile()` |

---

**Last Updated**: February 2026  
**Scope**: MVP calisthenics gamification app (no backend—localStorage only)
