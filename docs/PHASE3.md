# Phase 3: character system and daily quests

## Architecture

```
session.js ──emit WORKOUT_COMPLETED──▶ game.js ──▶ quests.js (settle, generate, pay)
                                          │            │
                                          │            └─▶ progression.js (ledger: the only place XP is added)
                                          ├─▶ character.js / cosmetics.js (unlock items)
                                          └─▶ emit QUEST_COMPLETED, REWARD_GRANTED, LEVEL_UP, RANK_UNLOCKED, COSMETIC_UNLOCKED
events.js  ◀── UI listens (toasts, level-up dialog, summary lines)
quests-ui.js, character-ui.js: presentation only
```

- State stays in `state.data` (`js/state.js`). Domain modules read and change that object. Only `state.js` touches `localStorage`. To move to a server later, replace `state.js` load and save.
- `progression.js` is the single XP authority: workout XP (history), legacy quest claims (Phase 2, read only), reward ledger.
- `game.js` decides the order of work. Every step is safe to run again.

## Character

Stored: `character { id, name, createdAt, selected{...}, unlocked[], preferences{equipment, focus}, attributeBase }`.
Not stored: level, XP, rank, attributes, titles. They are computed from progression and history, so they cannot drift.

Attribute rules (`character.js`, numbers in `config.js`). Effort of a set = reps, or seconds / 5 for holds.

| Exercise kind | Points |
| --- | --- |
| push, pull, legs | 100% strength |
| core, reps | 50% strength, 50% control |
| core, timed | 100% control |
| skill, timed | 100% control |
| skill, reps | 70% control, 30% mobility |
| mobility | 100% mobility |
| endurance | 1 point per minute of a session (max 60 per session) + 25% of reps in sets of 15 or more |

Value = 1 + floor(sqrt(points / 20)). Each step costs more than the last. Baseline totals from old accounts have no exercise type, so they are not turned into attributes. Demo mode has sample base points. To add a discipline: add an attribute in `config.js` and weights in `ATTRIBUTE_WEIGHTS`.

Ranks are their own table (`RANKS`, with `minLevel`). Cosmetics have a `requirement` (default, level, workouts, achievement, rank). Earned items are never removed. They have no effect on XP or quests.

## Quests

Each day: 1 main (100 XP), 1 side (50 XP), 1 optional (40 XP). Rewards and counts are in `QUEST_CONFIG`. Goals change with difficulty. Rewards do not.

Tier (beginner, intermediate, advanced) comes from evidence, never from XP alone:
- intermediate: level 3+ and 5+ workouts
- advanced: level 6+, 30+ workouts, 8+ workouts in the last 28 days and 3+ owned skills

Goal limits: a movement goal is at most 1.25 x the best day the player has logged for that movement (the lowest goal if there is no history). Equipment (profile setup) and owned skills gate templates. A pattern that had 50 to 120 reps (by tier) yesterday or today is rested. After 3 training days in a row the side quest is one tier lighter and the optional quest is recovery. Scheduled rest days get a mobility main quest and skill-only side work. Nothing punishes a rest day: there are no penalties and no streak requirements.

Generation is deterministic: seeded from character id, date and generation version. The set for a date is created once and never replaced.

Progress is computed from the logged workout history (verified events), not from buttons. Metrics: `best_workout_sets`, `reps`, `seconds`, `active_seconds`. Add a template in `quest-templates.js` to add a quest.

### Date strategy

The day is the player's local calendar date (`dateKey()`), read at the moment of each check. There is no 24-hour arithmetic, so daylight saving needs no special case. One set per date key. If the clock moves to a date that already has a set (travel), that set is reused. Expired quests never reopen. The app checks on load, when the tab becomes visible, and with a timer set for the next local midnight.

At rollover, unfinished quests of earlier days are settled once: if the logged work of that day reached the goal they complete (and are paid once), otherwise they expire. Expired quests are never paid. History is kept.

## Reward integrity

Four separate steps in `quests.js`: completion (`syncQuests`), eligibility (`rewardStatus: eligible`), processing (`processRewards` through `grantReward`), confirmation (`rewardStatus: granted` plus the ledger entry `quest:<questId>`). The ledger id is unique, so a second grant of the same reward does nothing. If the app stops between ledger write and status write, the next run sees the ledger entry and only marks the quest granted. Workout XP is safe by record id (a session id is recorded once).

## Migration

State version 3. Loading an older save:
1. A copy of the raw save is stored once in `cala_backup_before_v3_live` (or `_demo`).
2. All old fields load as before (XP, history, skills, spent XP, Phase 2 quest claims).
3. `character` is created when missing, dated from the first recorded workout.
4. `quests` and `ledger` start empty. Today's quests are created at once and see work already logged today.
5. Invalid or missing quest, ledger or character data is dropped or repaired. The app works without them.

Phase 2 daily quests that were completed but not claimed before the upgrade cannot be claimed any more. Claimed ones still count.

## Known limits

- Everything is in the browser. Someone who edits `localStorage` by hand can change their own data. Server checks are needed for online rankings.
- Quest history grows by about 1 KB per day. There is no pruning yet (`localStorage` allows about 5 MB).
- Training setup changes apply from the next day because today's set is fixed.
