// Small event bus shared by the domain code and the UI.
// Domain modules emit events after state has changed. The UI listens and shows feedback.
// A failing listener never stops the others, so a UI bug cannot lose a reward.

export const EVT = Object.freeze({
    WORKOUT_COMPLETED: 'WORKOUT_COMPLETED',
    EXERCISE_COMPLETED: 'EXERCISE_COMPLETED',
    QUEST_PROGRESS_UPDATED: 'QUEST_PROGRESS_UPDATED',
    QUEST_COMPLETED: 'QUEST_COMPLETED',
    QUEST_EXPIRED: 'QUEST_EXPIRED',
    REWARD_GRANTED: 'REWARD_GRANTED',
    LEVEL_UP: 'LEVEL_UP',
    RANK_UNLOCKED: 'RANK_UNLOCKED',
    ACHIEVEMENT_UNLOCKED: 'ACHIEVEMENT_UNLOCKED',
    COSMETIC_UNLOCKED: 'COSMETIC_UNLOCKED'
});

const listeners = new Map();

export function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
}

export function emit(type, payload = {}) {
    (listeners.get(type) || []).forEach(fn => {
        try { fn(payload); } catch (e) { console.error(`Listener for ${type} failed`, e); }
    });
}

// Test helper: removes every listener.
export function resetEvents() { listeners.clear(); }
