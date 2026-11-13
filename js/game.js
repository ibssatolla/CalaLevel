// Orchestration. Connects the character, the quest engine and the progression service through events.
// This is the only place that decides the order of: settle quests -> new day -> pay rewards -> cosmetics -> level and rank events.
// The XP itself is only ever added in progression.js. Nothing here does XP arithmetic.
import { state, saveState } from './state.js';
import { emit, on, EVT } from './events.js';
import { getProgressSnapshot } from './progression.js';
import { ensureCharacter, syncCosmetics } from './character.js';
import { ensureDailyQuests, syncQuests, processRewards } from './quests.js';
import { dateKey } from './utils.js';
import { RANKS } from './config.js';

// Runs the whole daily cycle. Safe to call as often as you like: every step is idempotent.
// `before` is the progress snapshot from before the triggering event (a workout), so level-ups can be found.
export function runDailyCycle(now = new Date(), before = getProgressSnapshot()) {
    const today = dateKey(now);
    const at = now.getTime();
    const first = syncQuests(today, state.data, at);          // settle earlier days, pick up today's work
    const created = ensureDailyQuests(today);                  // one set per date, never replaced
    const second = syncQuests(today, state.data, at);          // new quests see work already logged today
    const granted = processRewards();                          // eligible -> paid through the ledger
    const cosmetics = syncCosmetics();
    saveState();

    const completed = [...first.completed, ...second.completed];
    [...first.progressed, ...second.progressed].forEach(quest => emit(EVT.QUEST_PROGRESS_UPDATED, { quest }));
    first.expired.forEach(quest => emit(EVT.QUEST_EXPIRED, { quest }));
    completed.forEach(quest => emit(EVT.QUEST_COMPLETED, { quest }));
    granted.forEach(({ quest, tx }) => emit(EVT.REWARD_GRANTED, { quest, tx }));
    cosmetics.forEach(item => emit(EVT.COSMETIC_UNLOCKED, { item }));

    const after = getProgressSnapshot();
    if (after.level > before.level) emit(EVT.LEVEL_UP, { level: after.level, rank: RANKS.find(r => r.id === after.rankId) });
    if (after.rankId !== before.rankId) emit(EVT.RANK_UNLOCKED, { rank: RANKS.find(r => r.id === after.rankId) });
    return { created, completed, granted, cosmetics, after };
}

// Called once after the state is loaded: gives existing players a character, then runs the daily cycle.
export function bootGame(now = new Date()) {
    ensureCharacter(state.data, now);
    return runDailyCycle(now);
}

// Wires the domain reactions. Call before bootGame.
export function initGame() {
    on(EVT.WORKOUT_COMPLETED, ({ before }) => runDailyCycle(new Date(), before));
}
