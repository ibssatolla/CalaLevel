// Tunable game rules. Change numbers here, not in the logic.
// No DOM, no storage.

// ---- XP and levels ----
export const XP_PER_SET = 10;
export const XP_COMPLETION_BONUS = 25;
// Level L starts at base * (L - 1) * L total XP: 0, 1000, 3000, 6000, 10000, ...
export const XP_CURVE = { base: 500 };

// ---- Ranks ----
// Rank is its own table. A rank starts at a level, but the two are not the same thing,
// so ranks can be moved or added without touching the level curve.
export const RANKS = [
    { id: 'rookie', title: 'Rookie', minLevel: 1 },
    { id: 'trainee', title: 'Trainee', minLevel: 3 },
    { id: 'challenger', title: 'Challenger', minLevel: 4 },
    { id: 'street-warrior', title: 'Street Warrior', minLevel: 5 },
    { id: 'iron-athlete', title: 'Iron Athlete', minLevel: 6 },
    { id: 'calisthenics-adept', title: 'Calisthenics Adept', minLevel: 7 },
    { id: 'elite', title: 'Elite', minLevel: 8 },
    { id: 'master', title: 'Master', minLevel: 9 },
    { id: 'legend', title: 'Legend', minLevel: 10 }
];

// ---- Character attributes ----
// points -> value: value = 1 + floor(sqrt(points / divisor)). More training always helps,
// but each step costs more than the last. That keeps the numbers from inflating.
export const ATTRIBUTE_CURVE = { divisor: 20 };
// Adding a discipline later = add an attribute here and weights in ATTRIBUTE_WEIGHTS (character.js).
export const ATTRIBUTES = [
    { id: 'strength', label: 'Strength', short: 'STR', desc: 'Reps of push, pull and leg exercises.', icon: 'dumbbell' },
    { id: 'endurance', label: 'Endurance', short: 'END', desc: 'Time under training and high-rep sets.', icon: 'flame' },
    { id: 'control', label: 'Control', short: 'CTL', desc: 'Holds, core work and skill practice.', icon: 'target' },
    { id: 'mobility', label: 'Mobility', short: 'MOB', desc: 'Mobility and stretching time.', icon: 'activity' }
];
export const ENDURANCE_RULES = {
    pointsPerMinute: 1,        // minutes of logged training
    maxMinutesPerSession: 60,  // one very long session cannot dominate
    highRepThreshold: 15,      // reps in one set that count as endurance work
    highRepFactor: 0.25
};

// ---- Daily quests ----
export const QUEST_CONFIG = {
    generationVersion: 1,
    // The default day: 1 main, 1 side, 1 optional. Side count can be raised here.
    structure: { main: 1, side: 1, optional: 1 },
    // XP per slot. Difficulty changes the goal, not the reward, so XP cannot be farmed with hard goals.
    rewards: { main: 100, side: 50, optional: 40 },
    // How much work one day of the same movement pattern can be before the engine rests it.
    highLoadReps: { beginner: 50, intermediate: 80, advanced: 120 },
    // After this many training days in a row the side quest gets easier and the optional quest becomes recovery.
    restAfterConsecutiveDays: 3,
    // Tier rules. A tier needs real training history, not just XP.
    tiers: {
        intermediate: { minWorkouts: 5, minLevel: 3 },
        advanced: { minWorkouts: 30, minLevel: 6, minRecentWorkouts: 8, recentDays: 28, minOwnedSkills: 3 }
    },
    // A movement goal never goes above this multiple of the user's best day for that movement.
    capabilityCap: 1.25
};

// ---- Character preferences ----
export const EQUIPMENT_IDS = ['bar', 'parallel'];
export const FOCUS_IDS = ['balanced', 'strength', 'skill'];
