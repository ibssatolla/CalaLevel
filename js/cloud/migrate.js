// Import of progress that was saved in this browser before accounts existed (the old shared localStorage slot).
// The old data is never changed or deleted by this. After an import it stays where it is, as a backup.
// Nothing is uploaded without the user choosing "Import". Another person logging in on this browser is asked, not assumed.
import { state, getLegacyData } from '../state.js';
import { isAchievementUnlocked, getTotalXp, levelFromXp } from '../progression.js';
import { COSMETICS, isDefaultItem } from '../cosmetics.js';
import * as api from './api.js';

const FLAG = uid => `cala_legacy_done_${uid}`;
const defaults = new Set(COSMETICS.filter(isDefaultItem).map(c => c.id));
export const legacyChoice = uid => { try { return localStorage.getItem(FLAG(uid)); } catch (e) { return null; } };
export function setLegacyChoice(uid, value) { try { localStorage.setItem(FLAG(uid), value); } catch (e) { /* ignore */ } }

// Runs fn with the old data temporarily as the app state, so the normal progression code can read it. Restores afterwards.
function withState(data, fn) {
    const saved = state.data;
    state.data = data;
    try { return fn(); } finally { state.data = saved; }
}

// { data, summary } or null. Skipped when this account already chose (imported or started fresh).
export function findLegacy(uid, { ignoreChoice = false } = {}) {
    if (!ignoreChoice && legacyChoice(uid)) return null;
    const data = getLegacyData();
    if (!data) return null;
    const summary = withState(data, () => ({
        workouts: data.workoutHistory.length, totalXp: getTotalXp(), level: levelFromXp(getTotalXp()), name: data.character?.name || 'Athlete'
    }));
    return { data, summary };
}

export function buildPayload(data) {
    return withState(data, () => {
        const total = getTotalXp();
        const c = data.character;
        const cap = (list, n) => list.slice(-n);
        const workouts = cap(data.workoutHistory, 2000).map(h => ({
            id: String(h.id), date: h.date, type: h.type, title: h.title || '', durationSec: h.stats.durationSec, exercises: h.exercises, xp: Math.min(5000, Math.max(0, Math.round(h.stats.xp))),
            details: { dateKey: h.dateKey, stats: { sets: h.stats.sets, reps: h.stats.reps } }
        }));
        const b = data.userProfile.baseline;
        const { avatar, frame, background, title, badge } = c?.selected || {};
        return {
            total_xp: Math.min(10000000, Math.round(total)),
            character: { name: c?.name || 'Athlete', avatar: avatar || 'avatar-user', options: { frame, background, title, badge }, equipment: c?.preferences.equipment || [], focus: c?.preferences.focus || 'balanced' },
            workouts,
            quests: cap(data.quests.items, 2000).map(q => ({
                id: q.id, date: q.date, slot: q.slot, templateId: q.templateId, category: q.category, title: q.title, description: q.description, difficulty: q.difficulty,
                metric: q.metric, target: q.target, progress: q.progress, rewardXp: q.rewardXp, status: q.status, completedAt: q.completedAt, rewardStatus: q.rewardStatus,
                extra: { tier: q.tier, generationVersion: q.generationVersion }
            })),
            achievements: data.userProfile.achievements.filter(isAchievementUnlocked).map(a => a.key),
            cosmetics: (c?.unlocked || []).filter(id => !defaults.has(id)),
            app_state: {
                weeklySchedule: data.weeklySchedule, skills: data.skills.map(s => ({ id: s.id, status: s.status, unlockedAt: s.unlockedAt ?? null })), spentXp: data.userProfile.spentXp,
                baseline: { workouts: b.workouts, reps: b.reps, streak: b.streak, streakEndsOn: b.streakEndsOn }, achievementsSeen: data.userProfile.achievementsSeen, activity: data.userProfile.activity
            }
        };
    });
}

// Sends the old data to the account. Throws on failure; the old data is untouched either way.
export async function importLegacy(uid, data) {
    const result = await api.importLocalProgress(buildPayload(data));
    setLegacyChoice(uid, 'imported');
    return result;
}
