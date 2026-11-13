// Keeps the browser state and the account (Supabase) in step.
//
//   Account -> browser: buildStateFromSnapshot() turns get_progress() into the same state object the app always used.
//   Browser -> account: flush() sends what changed, in small steps that are safe to repeat (see supabase/migrations).
//
// The account is the system of record. The per-user localStorage copy is a cache, so the app opens fast and works offline.
// While offline, changes wait in the cache and are sent later. Nothing here does XP arithmetic: the server computes
// workout XP itself, and a mismatch with the local number makes the app reload the account state.
import * as api from './api.js';
import { dbCode, isNetworkError, isSessionError } from './errors.js';
import { refreshSession } from '../auth/auth.js';
import { state, replaceLiveState, saveState, onSaved, createFreshState, getUserSlot } from '../state.js';
import { isAchievementUnlocked } from '../progression.js';
import { COSMETICS, isDefaultItem } from '../cosmetics.js';
import { dateKey } from '../utils.js';

const META_PREFIX = 'cala_sync_u_';
const defaultCosmetics = new Set(COSMETICS.filter(isDefaultItem).map(c => c.id));
const hooks = { onHydrated: () => {}, onSessionLost: () => {}, onRejected: () => {} };
export const setSyncHooks = h => Object.assign(hooks, h);

// ---- Small storage helpers (meta = what the account already has) ----
const metaKey = () => `${META_PREFIX}${getUserSlot()}`;
function readMeta() {
    try {
        const m = JSON.parse(localStorage.getItem(metaKey()) || 'null');
        if (m && typeof m === 'object') return { workouts: m.workouts || [], quests: m.quests || {}, unlocks: m.unlocks ?? null, character: m.character ?? null, app: m.app ?? null, rejected: m.rejected || {}, at: m.at || null };
    } catch (e) { /* unreadable: treat as empty */ }
    return { workouts: [], quests: {}, unlocks: null, character: null, app: null, rejected: {}, at: null };
}
function writeMeta(m) { try { localStorage.setItem(metaKey(), JSON.stringify(m)); } catch (e) { /* storage blocked */ } }
export function clearSyncMeta(userId) { try { localStorage.removeItem(`${META_PREFIX}${userId}`); } catch (e) { /* ignore */ } }

// ---- Mapping: account preferences <-> the existing quest engine preferences ----
export function enginePreferences(prefs) {
    const eq = prefs?.available_equipment || [];
    const goal = prefs?.primary_goal;
    return {
        equipment: [
            ...(eq.some(e => ['pullup-bar', 'gym', 'rings'].includes(e)) ? ['bar'] : []),
            ...(eq.some(e => ['parallel-bars', 'gym'].includes(e)) ? ['parallel'] : [])
        ],
        focus: goal === 'strength' ? 'strength' : goal === 'skills' ? 'skill' : 'balanced'
    };
}

// ---- Account -> browser ----
export function buildStateFromSnapshot(snap, previous = null) {
    const st = createFreshState();
    const ch = snap.character;
    if (ch) {
        st.character = {
            id: `char-${ch.id}`,
            name: ch.name,
            createdAt: Date.parse(ch.created_at) || Date.now(),
            selected: { avatar: ch.avatar_id, ...(ch.cosmetic_options || {}) },
            unlocked: [...defaultCosmetics, ...(snap.cosmetics || [])],
            preferences: enginePreferences(snap.preferences),
            attributeBase: { strength: 0, endurance: 0, control: 0, mobility: 0 }
        };
    }
    st.workoutHistory = (snap.workouts || []).map(w => {
        const d = w.details || {};
        const stats = d.stats || {};
        const ex = Array.isArray(w.exercises) ? w.exercises : [];
        const sets = Number.isFinite(stats.sets) ? stats.sets : ex.reduce((n, e) => n + (Array.isArray(e.reps) ? e.reps.length : 0), 0);
        const reps = Number.isFinite(stats.reps) ? stats.reps : ex.filter(e => e.unit === 'reps').reduce((n, e) => n + (Array.isArray(e.reps) ? e.reps.reduce((a, b) => a + b, 0) : 0), 0);
        const when = new Date(w.completed_at);
        return {
            id: w.client_id, date: when.toISOString(), dateKey: d.dateKey || dateKey(when), type: w.type, title: w.title || '',
            exercises: ex, stats: { sets, reps, xp: w.xp, durationSec: w.duration }
        };
    });
    const questDate = new Map();
    st.quests.items = (snap.quests || []).map(q => {
        questDate.set(q.client_id, q.date);
        const granted = q.reward_status === 'granted';
        return {
            id: q.client_id, templateId: q.template_id, characterId: st.character?.id || '', date: q.date, slot: q.slot, category: q.category || '',
            title: q.title, description: q.description || '', difficulty: q.difficulty, tier: q.extra?.tier || 'beginner', metric: q.metric,
            target: Number(q.target), progress: Number(q.progress), rewardXp: q.reward_xp, status: q.status,
            completedAt: q.completed_at ? Date.parse(q.completed_at) : null,
            rewardStatus: granted ? 'granted' : q.status === 'completed' ? 'eligible' : 'none',
            rewardTxId: granted ? `quest:${q.client_id}` : null, generationVersion: q.extra?.generationVersion || 1
        };
    });
    st.quests.lastCheckedKey = st.quests.items.reduce((m, q) => (q.date > m ? q.date : m), '') || null;
    const ledger = (snap.quest_rewards || []).map(r => ({
        id: `quest:${r.source_id}`, xp: r.xp, source: 'quest', sourceId: r.source_id, date: questDate.get(r.source_id) || '', at: Date.parse(r.at) || 0
    }));
    const app = snap.app_state || {};
    const histXp = st.workoutHistory.reduce((n, h) => n + h.stats.xp, 0);
    const ledgerXp = ledger.reduce((n, t) => n + t.xp, 0);
    // Whatever the ledger holds beyond workouts and quest rewards (the imported baseline) is the baseline XP.
    // That makes the browser total equal the account total by construction.
    const b = app.baseline || {};
    st.userProfile.baseline = {
        xp: Math.max(0, (snap.total_xp || 0) - histXp - ledgerXp), workouts: b.workouts || 0, reps: b.reps || 0, streak: b.streak || 0,
        streakEndsOn: typeof b.streakEndsOn === 'string' ? b.streakEndsOn : st.userProfile.baseline.streakEndsOn
    };
    st.userProfile.ledger = ledger;
    st.userProfile.spentXp = app.spentXp || 0;
    if (Array.isArray(app.achievementsSeen)) st.userProfile.achievementsSeen = app.achievementsSeen;
    if (Array.isArray(app.activity)) st.userProfile.activity = app.activity;
    st.userProfile.achievements.forEach(a => { a.unlocked = (snap.achievements || []).includes(a.key); });
    if (Array.isArray(app.skills)) st.skills = st.skills.map(s => ({ ...s, ...(app.skills.find(x => x.id === s.id) || {}) }));
    if (Array.isArray(app.weeklySchedule) && app.weeklySchedule.length === 7) st.weeklySchedule = app.weeklySchedule;
    // A workout in progress lives on this device only.
    if (previous?.activeSession) st.activeSession = previous.activeSession;
    return st;
}

// What the account holds, in the same shape the "changed?" checks use, so a fresh download is never sent back.
function metaFromSnapshot(snap) {
    const quests = {};
    (snap.quests || []).forEach(q => { quests[q.client_id] = `${q.status}|${Number(q.progress)}`; });
    return { workouts: (snap.workouts || []).map(w => w.client_id), quests, unlocks: null, character: null, app: null, rejected: {}, at: Date.now() };
}

export function applySnapshot(snap) {
    const previous = state.data;
    replaceLiveState(buildStateFromSnapshot(snap, previous));
    const meta = metaFromSnapshot(snap);
    // The signatures for unlocks, character and app state are taken from the state we just built.
    meta.unlocks = unlockSignature();
    meta.character = characterSignature();
    meta.app = appSignature();
    writeMeta(meta);
    emitStatus({ status: 'synced', problem: null });
}

// ---- Browser -> account ----
function workoutPayload(h) {
    const ex = h.exercises.map(e => ({ id: String(e.id ?? e.name), name: e.name, unit: e.unit === 'sec' ? 'sec' : 'reps', sets: Array.isArray(e.reps) ? e.reps.length : 0, reps: e.reps }));
    const base = ex.reduce((n, e) => n + e.reps.reduce((a, r) => a + 10 + Math.max(0, e.unit === 'sec' ? Math.round(r / 5) : r), 0), 0);
    return {
        id: h.id, type: h.type, title: h.title || '', exercises: ex, duration: Math.max(0, Math.min(21600, Math.round(h.stats.durationSec || 0))),
        completedAt: h.date, complete: h.stats.xp - base >= 25, details: { dateKey: h.dateKey, stats: { sets: h.stats.sets, reps: h.stats.reps } }
    };
}
const questSig = q => `${q.status}|${q.progress}`;
function questPayload(q) {
    return {
        id: q.id, templateId: q.templateId, date: q.date, slot: q.slot, category: q.category, title: q.title, description: q.description,
        difficulty: q.difficulty, metric: q.metric, target: q.target, progress: q.progress, rewardXp: q.rewardXp, status: q.status,
        completedAt: q.completedAt, extra: { tier: q.tier, generationVersion: q.generationVersion }
    };
}
const unlockedAchievements = () => state.data.userProfile.achievements.filter(isAchievementUnlocked).map(a => a.key);
const unlockedCosmetics = () => (state.data.character?.unlocked || []).filter(id => !defaultCosmetics.has(id));
const unlockSignature = () => JSON.stringify([unlockedAchievements().sort(), unlockedCosmetics().sort()]);
const characterSignature = () => { const c = state.data.character; return c ? JSON.stringify([c.name, c.selected]) : null; };
function appData() {
    const d = state.data; const b = d.userProfile.baseline;
    return {
        weeklySchedule: d.weeklySchedule, skills: d.skills.map(s => ({ id: s.id, status: s.status, unlockedAt: s.unlockedAt ?? null })), spentXp: d.userProfile.spentXp,
        baseline: { workouts: b.workouts, reps: b.reps, streak: b.streak, streakEndsOn: b.streakEndsOn },
        achievementsSeen: d.userProfile.achievementsSeen, activity: d.userProfile.activity
    };
}
const appSignature = () => JSON.stringify(appData());

// What would be sent now.
export function pendingWork() {
    if (state.data.mode !== 'live') return { workouts: [], quests: [], unlocks: false, character: false, app: false, count: 0 };
    const meta = readMeta();
    const synced = new Set(meta.workouts);
    const workouts = state.data.workoutHistory.filter(h => !synced.has(h.id) && !meta.rejected[h.id]);
    const quests = state.data.quests.items.filter(q => meta.quests[q.id] !== questSig(q));
    const unlocks = meta.unlocks !== null && unlockSignature() !== meta.unlocks;
    const character = !!state.data.character && meta.character !== null && characterSignature() !== meta.character;
    const app = meta.app !== null && appSignature() !== meta.app;
    return { workouts, quests, unlocks, character, app, count: workouts.length + quests.length + (unlocks ? 1 : 0) + (character ? 1 : 0) + (app ? 1 : 0) };
}

let info = { status: 'idle', problem: null, lastSyncedAt: null };
const statusListeners = new Set();
function emitStatus(patch) {
    info = { ...info, ...patch };
    statusListeners.forEach(fn => { try { fn(getSyncInfo()); } catch (e) { console.warn(e); } });
}
export const getSyncInfo = () => ({ ...info, pending: pendingWork().count });
export const onSyncChange = fn => { statusListeners.add(fn); return () => statusListeners.delete(fn); };

let running = null;
let again = false;
let timer = null;
let enabled = false;

async function step(fn) {
    try { return await fn(); } catch (err) {
        if (isSessionError(err) && !isNetworkError(err)) {
            try { await refreshSession(); return await fn(); } catch (e2) { throw isSessionError(e2) ? Object.assign(e2, { sessionLost: true }) : e2; }
        }
        throw err;
    }
}

async function runFlush() {
    const meta = readMeta();
    let rehydrate = false;
    const work = pendingWork();
    if (work.count === 0) { emitStatus({ status: 'synced', problem: null }); return; }
    emitStatus({ status: 'syncing' });

    for (const h of work.workouts) {
        try {
            const r = await step(() => api.recordWorkout(workoutPayload(h)));
            meta.workouts.push(h.id);
            if (r.xp !== h.stats.xp) rehydrate = true;
        } catch (err) {
            const code = dbCode(err);
            if (code === 'daily_xp_cap' || code === 'invalid_workout') { meta.rejected[h.id] = code; hooks.onRejected({ code, workout: h }); rehydrate = true; continue; }
            writeMeta(meta); throw err;
        }
    }
    writeMeta(meta);

    for (let i = 0; i < work.quests.length; i += 20) {
        const batch = work.quests.slice(i, i + 20);
        const result = await step(() => api.syncQuests(batch.map(questPayload)));
        batch.forEach(q => { meta.quests[q.id] = questSig(q); });
        result.forEach(r => {
            const q = batch.find(x => x.id === r.id);
            if (!q) return;
            if (r.skipped) rehydrate = true;
            else if (r.status !== q.status) rehydrate = true; // the account refused the status (for example no workout that day)
            else if (r.xp_granted && state.data.userProfile.ledger.find(t => t.id === `quest:${q.id}`)?.xp !== r.xp_granted) rehydrate = true;
        });
        writeMeta(meta);
    }

    if (work.unlocks) {
        await step(() => api.syncUnlocks(unlockedAchievements(), unlockedCosmetics()));
        meta.unlocks = unlockSignature(); writeMeta(meta);
    }
    if (work.character && state.data.character) {
        const c = state.data.character;
        const { avatar, frame, background, title, badge } = c.selected;
        try {
            await step(() => api.saveCharacter({ name: c.name, avatar, options: { frame, background, title, badge } }));
            meta.character = characterSignature(); writeMeta(meta);
        } catch (err) {
            if (dbCode(err) === 'invalid_cosmetics' || dbCode(err) === 'invalid_name') { rehydrate = true; } else throw err;
        }
    }
    if (work.app) {
        await step(() => api.saveAppState(appData()));
        meta.app = appSignature(); writeMeta(meta);
    }
    meta.at = Date.now();
    writeMeta(meta);

    if (rehydrate) {
        const snap = await step(() => api.getProgress());
        applySnapshot(snap);
        hooks.onHydrated();
    }
    emitStatus({ status: 'synced', problem: null, lastSyncedAt: Date.now() });
}

// Sends what changed. Several calls at once share one run. Resolves when the account is up to date, or after a failure.
export function flush() {
    if (!enabled) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
        try {
            do {
                again = false;
                await runFlush();
            } while (again);
        } catch (err) {
            if (err?.sessionLost) { emitStatus({ status: 'error', problem: 'session' }); hooks.onSessionLost(); }
            else if (isNetworkError(err)) emitStatus({ status: 'offline', problem: 'network' });
            else { console.warn('Sync failed', err); emitStatus({ status: 'error', problem: String(err?.message || err) }); }
        } finally {
            running = null;
            const left = pendingWork().count;
            clearTimeout(timer);
            if (enabled && left > 0 && info.status !== 'synced') timer = setTimeout(flush, 20000); // retry later
        }
    })();
    return running;
}

let schedule = null;
let started = false;
// Starts watching saves. Call once per signed-in session.
export function startSync() {
    enabled = true;
    if (started) return;
    started = true;
    schedule = () => { clearTimeout(schedule.t); schedule.t = setTimeout(flush, 1200); };
    onSaved(() => { if (enabled && state.data.mode === 'live') schedule(); });
    window.addEventListener('online', () => flush());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
}
export function stopSync() { enabled = false; clearTimeout(timer); if (schedule) clearTimeout(schedule.t); }

// Used when the signed-in user changes or logs out: pending changes are tried once, never dropped silently.
export async function flushBeforeLeaving() {
    if (!enabled) return pendingWork().count === 0;
    await flush();
    return pendingWork().count === 0;
}
