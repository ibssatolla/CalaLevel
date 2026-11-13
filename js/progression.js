// Single source of truth for XP, levels, streaks and derived profile stats.
// Nothing here touches the DOM.
import { state } from './state.js';
import { dateKey, addDays } from './utils.js';
import { XP_PER_SET, XP_COMPLETION_BONUS, XP_CURVE, RANKS } from './config.js';

export { XP_PER_SET, XP_COMPLETION_BONUS };

// Level L starts at base * (L - 1) * L total XP. With base 500: 0, 1000, 3000, 6000, 10000, ...
export function xpForLevel(level) {
    return XP_CURVE.base * (level - 1) * level;
}

export function levelFromXp(xp) {
    let level = 1;
    while (xpForLevel(level + 1) <= xp) level++;
    return level;
}

// Rank has its own table (config.js). The highest rank whose minLevel is reached wins.
export function rankForLevel(level) {
    let rank = RANKS[0];
    for (const r of RANKS) if (level >= r.minLevel) rank = r;
    return rank;
}

export function rankTitleForLevel(level) {
    return rankForLevel(level).title;
}

export function levelProgress(totalXp) {
    const level = levelFromXp(totalXp);
    const floor = xpForLevel(level);
    const ceiling = xpForLevel(level + 1);
    const pct = Math.min(100, Math.max(0, ((totalXp - floor) / (ceiling - floor)) * 100));
    return { level, floor, ceiling, intoLevel: totalXp - floor, toNext: ceiling - totalXp, pct };
}

// Lifetime XP. Never goes down when XP is spent on skills, so the level cannot drop.
// Sources: the starting baseline, workout history, old Phase 2 quest claims (kept as they were),
// and the reward ledger (quests from Phase 3 on). This is the only place XP is added up.
export function getTotalXp() {
    const { userProfile, workoutHistory } = state.data;
    const legacyQuests = Object.values(userProfile.questClaims || {}).reduce((a, b) => a + b, 0);
    return userProfile.baseline.xp + legacyQuests + getLedgerXp() + workoutHistory.reduce((sum, h) => sum + h.stats.xp, 0);
}

// ---- Reward ledger ----
// Every XP reward that is not a workout is one entry with a unique id. Granting the same id again does nothing,
// so a reward can never be paid twice, however often the code runs.
export function getLedgerXp() {
    return (state.data.userProfile.ledger || []).reduce((sum, t) => sum + t.xp, 0);
}

export function hasReward(id) {
    return (state.data.userProfile.ledger || []).some(t => t.id === id);
}

// Returns the new entry, or null when the id was already paid (or the input is not valid).
export function grantReward({ id, xp, source, sourceId, date, at = Date.now() }) {
    if (typeof id !== 'string' || !id || !Number.isFinite(xp) || xp <= 0) return null;
    const profile = state.data.userProfile;
    if (!Array.isArray(profile.ledger)) profile.ledger = [];
    if (profile.ledger.some(t => t.id === id)) return null;
    const tx = { id, xp: Math.round(xp), source: String(source || 'reward'), sourceId: String(sourceId || ''), date: date || dateKey(new Date(at)), at };
    profile.ledger.push(tx);
    return tx;
}

// Level, rank and XP at one moment. Compared before and after an event to find level-ups and new ranks.
export function getProgressSnapshot() {
    const xp = getTotalXp();
    const level = levelFromXp(xp);
    return { xp, level, rankId: rankForLevel(level).id };
}

export function getAvailableXp() {
    return Math.max(0, getTotalXp() - state.data.userProfile.spentXp);
}

export function getLevel() {
    return levelFromXp(getTotalXp());
}

// ---- XP for a workout ----

// Reps count 1 XP each. Timed holds count 1 XP per 5 seconds.
export function xpForSet(exercise, set) {
    const effort = exercise.unit === 'sec' ? Math.round(set.reps / 5) : set.reps;
    return XP_PER_SET + Math.max(0, effort);
}

// session.exercises[i].sets is the list of sets actually completed: [{ reps }]
export function computeSessionTotals(session) {
    let sets = 0;
    let reps = 0;
    let xp = 0;
    let planned = 0;
    session.exercises.forEach(ex => {
        planned += ex.targetSets;
        ex.sets.forEach(set => {
            sets += 1;
            if (ex.unit === 'reps') reps += set.reps;
            xp += xpForSet(ex, set);
        });
    });
    const complete = sets > 0 && sets >= planned;
    if (complete) xp += XP_COMPLETION_BONUS;
    return { sets, reps, xp, planned, complete };
}

// ---- Stats derived from workout history ----

export function getWorkoutCount() {
    const { baseline } = state.data.userProfile;
    return baseline.workouts + state.data.workoutHistory.length;
}

export function getTotalReps() {
    const { baseline } = state.data.userProfile;
    return baseline.reps + state.data.workoutHistory.reduce((s, h) => s + h.stats.reps, 0);
}

// Consecutive days with a workout, counted back from today (or yesterday, if today has none yet).
// The pre-history streak joins on only if the chain reaches the day it ended.
export function getStreak(today = dateKey()) {
    const { baseline } = state.data.userProfile;
    const days = new Set(state.data.workoutHistory.map(h => h.dateKey));
    const yesterday = addDays(today, -1);

    let cursor;
    if (days.has(today)) cursor = today;
    else if (days.has(yesterday)) cursor = yesterday;
    else {
        const baselineAlive = baseline.streak > 0 && (baseline.streakEndsOn === today || baseline.streakEndsOn === yesterday);
        return baselineAlive ? baseline.streak : 0;
    }

    let count = 0;
    while (days.has(cursor)) {
        count++;
        cursor = addDays(cursor, -1);
    }
    if (baseline.streak > 0 && cursor === baseline.streakEndsOn) count += baseline.streak;
    return count;
}

// ---- Leaderboard ----

export function getLeaderboard() {
    const total = getTotalXp();
    return state.data.leaderboard
        .map(p => (p.name === 'You' ? { ...p, xp: total } : p))
        .sort((a, b) => b.xp - a.xp)
        .map((p, i) => ({ ...p, rank: i + 1 }));
}

export function getGlobalRank() {
    const me = getLeaderboard().find(p => p.name === 'You');
    return me ? me.rank : 0;
}

// ---- Skills ----

// Single place that decides whether a skill can be bought. Called by the UI for messages
// and again inside unlockSkill, so the rule cannot be bypassed.
export function checkSkillUnlock(skillId) {
    const { skills } = state.data;
    const skill = skills.find(s => s.id === skillId);
    if (!skill) return { ok: false, reason: 'Unknown skill.' };
    if (skill.status !== 'locked') return { ok: false, reason: `${skill.name} is already unlocked.` };

    const missing = skill.parents
        .map(pid => skills.find(s => s.id === pid))
        .filter(p => !p || p.status === 'locked');
    if (missing.length) {
        return { ok: false, reason: `Unlock ${missing.map(p => (p ? p.name : '?')).join(' and ')} first.` };
    }

    const level = getLevel();
    if (level < skill.requiredLevel) {
        return { ok: false, reason: `Requires level ${skill.requiredLevel}. You are level ${level}.` };
    }

    const available = getAvailableXp();
    if (available < skill.cost) {
        return { ok: false, reason: `Need ${(skill.cost - available).toLocaleString()} more XP.` };
    }
    return { ok: true, skill };
}

export function unlockSkill(skillId) {
    const result = checkSkillUnlock(skillId);
    if (!result.ok) return result;
    result.skill.status = 'unlocked';
    result.skill.unlockedAt = Date.now();
    state.data.userProfile.spentXp += result.skill.cost;
    return result;
}

// ---- Achievements ----

export function isAchievementUnlocked(badge) {
    switch (badge.key) {
        case 'first-steps': return getWorkoutCount() >= 1;
        case 'week-warrior': return getStreak() >= 7;
        case 'rep-master': return getTotalReps() >= 1000;
        case 'muscle-up-king': {
            const s = state.data.skills.find(x => x.id === 'muscleup');
            return !!s && s.status !== 'locked';
        }
        // Park visits and battles are not tracked yet. A real account never unlocks them; demo mode shows sample values.
        default: return state.data.mode === 'demo' && !!badge.unlocked;
    }
}

// Days (YYYY-MM-DD) in the 7 days ending today that count as trained, including the seeded streak.
export function getTrainedDays(today = dateKey()) {
    const { baseline } = state.data.userProfile;
    const set = new Set(state.data.workoutHistory.map(h => h.dateKey));
    for (let i = 0; i < baseline.streak; i++) set.add(addDays(baseline.streakEndsOn, -i));
    return Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map(k => ({ key: k, trained: set.has(k) }));
}

// ---- Achievements: progress for the cards ----

export const UNTRACKED_ACHIEVEMENTS = ['park-explorer', 'battle-ready'];

export const ACHIEVEMENT_ICONS = {
    'first-steps': 'footprints', 'week-warrior': 'flame', 'rep-master': 'dumbbell',
    'park-explorer': 'pin', 'battle-ready': 'swords', 'muscle-up-king': 'crown'
};

export function achievementProgress(badge) {
    switch (badge.key) {
        case 'first-steps': return { value: Math.min(1, getWorkoutCount()), target: 1 };
        case 'week-warrior': return { value: Math.min(7, getStreak()), target: 7 };
        case 'rep-master': return { value: Math.min(1000, getTotalReps()), target: 1000 };
        default: return null;
    }
}
