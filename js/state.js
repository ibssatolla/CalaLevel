import { dateKey, addDays, cleanText } from './utils.js';
import { COSMETICS, DEFAULT_SELECTION, getCosmetic, isDefaultItem } from './cosmetics.js';
import { EQUIPMENT_IDS, FOCUS_IDS } from './config.js';

// Real progress and demo progress live in separate storage slots, so they can never mix.
const LIVE_KEY = 'cala_state_v2';
const DEMO_KEY = 'cala_state_demo_v1';
const MODE_KEY = 'cala_mode';
const LEGACY_KEY = 'cala_state_v1';
const BACKUP_CORRUPT_KEY = 'cala_backup_unreadable';
const BACKUP_SEEDED_KEY = 'cala_backup_before_demo_split';
// 1: first release. 2: baseline + history. 3 (Phase 3): character, daily quests and the reward ledger.
export const STATE_VERSION = 3;
const BACKUP_V3_KEY = 'cala_backup_before_v3';
// Phase 3.3: a real account keeps its cached copy in its own slot, one per user. The old shared slot (LIVE_KEY) is
// no longer played from. It is only offered for import after a login and is never changed or deleted.
const USER_KEY_PREFIX = 'cala_state_u_';
let userSlot = null;
const userKey = () => (userSlot ? `${USER_KEY_PREFIX}${userSlot}` : null);
export const setUserSlot = id => { userSlot = id || null; };
export const getUserSlot = () => userSlot;
export const userStateKey = id => `${USER_KEY_PREFIX}${id}`;
const savedListeners = new Set();
export const onSaved = fn => { savedListeners.add(fn); return () => savedListeners.delete(fn); };

// Things the UI should tell the user once after loading (set by initState).
export const bootNotes = { storageOk: true, recovered: false, movedToDemo: false, upgraded: false };

// A fresh object every call, so saved data never shares references with the defaults.
export function createFreshState() { return createDefaultState(); }
function createDefaultState() {
    return {
        version: STATE_VERSION,
        mode: 'live',
        weeklySchedule: [
            { day: 'Mon', type: 'push', title: 'Push Strength', exercises: [] },
            { day: 'Tue', type: 'pull', title: 'Pull Power', exercises: [] },
            { day: 'Wed', type: 'rest', title: 'Active Recovery', exercises: [] },
            { day: 'Thu', type: 'legs', title: 'Legs & Core', exercises: [] },
            { day: 'Fri', type: 'skill', title: 'Skill Day', exercises: [] },
            { day: 'Sat', type: 'full', title: 'Full Body', exercises: [] },
            { day: 'Sun', type: 'rest', title: 'Rest Day', exercises: [] }
        ],
        workoutHistory: [],
        activeSession: null,
        // Created by ensureCharacter() right after loading. Null only until then.
        character: null,
        // Daily quests. One set per local calendar day. History is kept.
        quests: { items: [], lastCheckedKey: null },
        userProfile: {
            // Progress the user had before workout history started. Totals shown in the
            // profile are always baseline + history, so they cannot drift apart.
            // A new account starts at zero.
            baseline: { xp: 0, workouts: 0, reps: 0, streak: 0, streakEndsOn: addDays(dateKey(), -1) },
            spentXp: 0,
            // Claimed daily quests: { 'YYYY-MM-DD:questId': xp }. Counted in lifetime XP.
            questClaims: {},
            // Reward ledger (Phase 3 on): [{ id, xp, source, sourceId, date, at }]. One entry per paid reward.
            ledger: [],
            // Achievement keys the user has already been told about. null = not seeded yet.
            achievementsSeen: null,
            activity: [],
            achievements: [
                { id: 1, key: 'first-steps', name: 'First Steps', icon: '👟', desc: 'Completed first workout', unlocked: false },
                { id: 2, key: 'week-warrior', name: 'Week Warrior', icon: '🔥', desc: '7 day streak', unlocked: false },
                { id: 3, key: 'rep-master', name: 'Rep Master', icon: '💪', desc: '1000 total reps', unlocked: false },
                { id: 4, key: 'park-explorer', name: 'Park Explorer', icon: '🗺️', desc: 'Visited 5 different parks', unlocked: false },
                { id: 5, key: 'battle-ready', name: 'Battle Ready', icon: '⚔️', desc: 'Won first battle', unlocked: false },
                { id: 6, key: 'muscle-up-king', name: 'Muscle Up King', icon: '👑', desc: 'Unlock Muscle Up', unlocked: false }
            ]
        },
        skills: [
            { id: 'pushup', name: 'Push Up', level: 1, requiredLevel: 1, status: 'unlocked', cost: 0, x: 50, y: 10, parents: [] },
            { id: 'dips', name: 'Dips', level: 2, requiredLevel: 2, status: 'locked', cost: 500, x: 30, y: 30, parents: ['pushup'] },
            { id: 'pullup', name: 'Pull Up', level: 2, requiredLevel: 2, status: 'locked', cost: 500, x: 70, y: 30, parents: ['pushup'] },
            { id: 'muscleup', name: 'Muscle Up', level: 3, requiredLevel: 4, status: 'locked', cost: 2000, x: 50, y: 50, parents: ['dips', 'pullup'] },
            { id: 'frontlever', name: 'Front Lever', level: 4, requiredLevel: 5, status: 'locked', cost: 5000, x: 80, y: 70, parents: ['pullup'] },
            { id: 'planche', name: 'Planche', level: 4, requiredLevel: 5, status: 'locked', cost: 5000, x: 20, y: 70, parents: ['dips'] }
        ],
        // Battles and rankings need other players. There is no server yet, so a real account has none.
        challenges: [],
        leaderboard: [{ name: 'You', xp: 0 }]
    };
}

// Demo mode: sample progress and simulated rivals. Stored apart from real progress.
function createDemoState() {
    const s = createDefaultState();
    s.mode = 'demo';
    s.userProfile.baseline = { xp: 12450, workouts: 42, reps: 3500, streak: 12, streakEndsOn: addDays(dateKey(), -1) };
    s.userProfile.activity = [
        { id: 1, title: 'Morning Park Session', date: 'Earlier', xp: 450, icon: '🌳' },
        { id: 2, title: 'Push-up Blitz', date: 'Earlier', xp: 120, icon: '⚔️' },
        { id: 3, title: 'Skill Training: Dips', date: 'Earlier', xp: 300, icon: '🪜' }
    ];
    s.userProfile.achievements.forEach(a => { if (a.key !== 'battle-ready' && a.key !== 'muscle-up-king') a.unlocked = true; });
    s.skills.find(k => k.id === 'pushup').status = 'mastered';
    s.skills.find(k => k.id === 'dips').status = 'unlocked';
    s.skills.find(k => k.id === 'pullup').status = 'unlocked';
    s.challenges = [
        { id: 1, title: 'Push-up Blitz', type: 'Rep Battle', opponent: 'AlexStr', status: 'Open' },
        { id: 2, title: 'Planche Hold', type: 'Time Attack', opponent: 'GymRat99', status: 'Open' },
        { id: 3, title: 'Muscle-up Race', type: 'Speed Run', opponent: 'BarStar', status: 'Open' }
    ];
    s.leaderboard = [
        { name: 'SarahGains', xp: 15400 },
        { name: 'IronMike', xp: 14200 },
        { name: 'CalisthenicsKing', xp: 13800 },
        { name: 'You', xp: 0 },
        { name: 'NewbieJoe', xp: 800 }
    ];
    return s;
}

export const state = { data: createDefaultState() };

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

function sanitizeExercise(ex) {
    if (!isObj(ex) || typeof ex.name !== 'string') return null;
    const unit = ex.unit === 'sec' || (typeof ex.reps === 'string' && ex.reps.endsWith('s')) ? 'sec' : 'reps';
    const reps = typeof ex.reps === 'string' ? parseInt(ex.reps, 10) : ex.reps;
    return {
        id: String(ex.id ?? ex.name),
        name: ex.name,
        unit,
        sets: Math.max(1, Math.round(num(ex.sets, 3))),
        reps: Math.max(0, Math.round(num(reps, 10)))
    };
}

function sanitizeHistoryEntry(entry) {
    if (!isObj(entry) || typeof entry.date !== 'string' || Number.isNaN(Date.parse(entry.date))) return null;
    const stats = isObj(entry.stats) ? entry.stats : {};
    const exercises = Array.isArray(entry.exercises) ? entry.exercises.filter(isObj) : [];
    return {
        ...entry,
        id: entry.id ?? `legacy-${Date.parse(entry.date)}`,
        type: typeof entry.type === 'string' ? entry.type : 'full',
        dateKey: typeof entry.dateKey === 'string' ? entry.dateKey : dateKey(new Date(entry.date)),
        exercises,
        stats: {
            sets: num(stats.sets),
            reps: num(stats.reps),
            xp: num(stats.xp),
            durationSec: num(stats.durationSec)
        }
    };
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const normalizeState = (saved, mode = 'live') => normalize(saved, mode);

function sanitizeCharacter(c) {
    if (!isObj(c) || typeof c.id !== 'string' || !c.id) return null;
    const known = new Set(COSMETICS.map(i => i.id));
    const unlocked = new Set([...COSMETICS.filter(isDefaultItem).map(i => i.id), ...(Array.isArray(c.unlocked) ? c.unlocked.filter(id => known.has(id)) : [])]);
    const selected = { ...DEFAULT_SELECTION };
    if (isObj(c.selected)) {
        Object.keys(selected).forEach(cat => {
            const item = getCosmetic(c.selected[cat]);
            if (item && item.category === cat && unlocked.has(item.id)) selected[cat] = item.id;
        });
    }
    const prefs = isObj(c.preferences) ? c.preferences : {};
    const base = isObj(c.attributeBase) ? c.attributeBase : {};
    return {
        id: c.id,
        name: cleanText(c.name) || 'Athlete',
        createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
        selected,
        unlocked: [...unlocked],
        preferences: {
            equipment: Array.isArray(prefs.equipment) ? EQUIPMENT_IDS.filter(id => prefs.equipment.includes(id)) : [],
            focus: FOCUS_IDS.includes(prefs.focus) ? prefs.focus : 'balanced'
        },
        attributeBase: Object.fromEntries(['strength', 'endurance', 'control', 'mobility'].map(k => [k, Math.max(0, num(base[k]))]))
    };
}

function sanitizeQuest(q) {
    if (!isObj(q) || typeof q.id !== 'string' || typeof q.templateId !== 'string' || !DATE_KEY.test(q.date)) return null;
    if (!['main', 'side', 'optional'].includes(q.slot) || !['active', 'completed', 'expired'].includes(q.status)) return null;
    if (!isObj(q.metric) || typeof q.metric.kind !== 'string' || !Number.isFinite(q.target) || q.target <= 0) return null;
    const status = q.status;
    return {
        id: q.id,
        templateId: q.templateId,
        characterId: String(q.characterId ?? ''),
        date: q.date,
        slot: q.slot,
        category: String(q.category ?? ''),
        title: String(q.title ?? '').slice(0, 120),
        description: String(q.description ?? '').slice(0, 240),
        difficulty: Math.min(3, Math.max(1, Math.round(num(q.difficulty, 1)))),
        tier: ['beginner', 'intermediate', 'advanced'].includes(q.tier) ? q.tier : 'beginner',
        metric: { ...q.metric },
        target: q.target,
        progress: Math.max(0, num(q.progress)),
        rewardXp: Math.min(1000, Math.max(0, num(q.rewardXp))),
        status,
        completedAt: Number.isFinite(q.completedAt) ? q.completedAt : null,
        rewardStatus: ['none', 'eligible', 'granted'].includes(q.rewardStatus) ? q.rewardStatus : 'none',
        rewardTxId: typeof q.rewardTxId === 'string' ? q.rewardTxId : null,
        generationVersion: num(q.generationVersion, 1)
    };
}

function sanitizeQuests(quests) {
    const out = { items: [], lastCheckedKey: null };
    if (!isObj(quests)) return out;
    const seen = new Set();
    (Array.isArray(quests.items) ? quests.items : []).forEach(raw => {
        const q = sanitizeQuest(raw);
        if (q && !seen.has(q.id)) { seen.add(q.id); out.items.push(q); }
    });
    if (typeof quests.lastCheckedKey === 'string' && DATE_KEY.test(quests.lastCheckedKey)) out.lastCheckedKey = quests.lastCheckedKey;
    return out;
}

function sanitizeLedger(ledger) {
    const seen = new Set();
    return (Array.isArray(ledger) ? ledger : []).filter(t => {
        const ok = isObj(t) && typeof t.id === 'string' && t.id && Number.isFinite(t.xp) && t.xp > 0 && t.xp <= 1000 && !seen.has(t.id);
        if (ok) seen.add(t.id);
        return ok;
    }).map(t => ({ id: t.id, xp: Math.round(t.xp), source: String(t.source ?? 'reward'), sourceId: String(t.sourceId ?? ''), date: DATE_KEY.test(t.date) ? t.date : '', at: num(t.at) }));
}

function sanitizeSchedule(schedule, fallback) {
    if (!Array.isArray(schedule) || schedule.length !== 7) return fallback;
    const ok = schedule.every(d => isObj(d) && typeof d.day === 'string' && typeof d.type === 'string' && typeof d.title === 'string');
    if (!ok) return fallback;
    return schedule.map(d => ({
        day: d.day,
        type: d.type,
        title: d.title,
        exercises: Array.isArray(d.exercises) ? d.exercises.map(sanitizeExercise).filter(Boolean) : []
    }));
}

// Turns saved data (any version) into a valid current-version state.
// Unknown or malformed fields fall back to defaults instead of crashing the app.
function normalize(saved, mode = 'live') {
    const def = mode === 'demo' ? createDemoState() : createDefaultState();
    if (!isObj(saved)) return def;

    const history = (Array.isArray(saved.workoutHistory) ? saved.workoutHistory : [])
        .map(sanitizeHistoryEntry).filter(Boolean);

    const out = { ...def, workoutHistory: history, mode };
    out.weeklySchedule = sanitizeSchedule(saved.weeklySchedule, def.weeklySchedule);
    out.character = sanitizeCharacter(saved.character);
    out.quests = sanitizeQuests(saved.quests);

    const profile = isObj(saved.userProfile) ? saved.userProfile : {};
    if (isObj(profile.baseline)) {
        // v2 save
        out.userProfile.baseline = {
            xp: Math.max(0, num(profile.baseline.xp, def.userProfile.baseline.xp)),
            workouts: Math.max(0, num(profile.baseline.workouts)),
            reps: Math.max(0, num(profile.baseline.reps)),
            streak: Math.max(0, num(profile.baseline.streak)),
            streakEndsOn: typeof profile.baseline.streakEndsOn === 'string' ? profile.baseline.streakEndsOn : def.userProfile.baseline.streakEndsOn
        };
        out.userProfile.spentXp = Math.max(0, num(profile.spentXp));
    } else if ((saved.version ?? 1) < 2 && isObj(profile.stats)) {
        // v1 save: stats were running totals. Subtract what history already accounts for,
        // so history is counted once.
        const histXp = history.reduce((s, h) => s + h.stats.xp, 0);
        const histReps = history.reduce((s, h) => s + h.stats.reps, 0);
        out.userProfile.baseline = {
            xp: Math.max(0, num(profile.xp, def.userProfile.baseline.xp) - histXp),
            workouts: Math.max(0, num(profile.stats.workouts) - history.length),
            reps: Math.max(0, num(profile.stats.reps) - histReps),
            streak: Math.max(0, num(profile.stats.streak)),
            streakEndsOn: addDays(dateKey(), -1)
        };
    }
    if (isObj(profile.questClaims)) {
        Object.entries(profile.questClaims).forEach(([k, v]) => {
            if (/^\d{4}-\d{2}-\d{2}:[a-z0-9-]+$/.test(k) && Number.isFinite(v) && v > 0 && v <= 1000) out.userProfile.questClaims[k] = v;
        });
    }
    out.userProfile.ledger = sanitizeLedger(profile.ledger);
    if (Array.isArray(profile.achievementsSeen)) {
        out.userProfile.achievementsSeen = profile.achievementsSeen.filter(k => typeof k === 'string');
    }
    if (Array.isArray(profile.activity)) out.userProfile.activity = profile.activity.filter(isObj);
    if (Array.isArray(profile.achievements) && profile.achievements.length) {
        out.userProfile.achievements = def.userProfile.achievements.map(d => {
            const s = profile.achievements.find(a => isObj(a) && a.name === d.name);
            return s ? { ...d, unlocked: !!s.unlocked } : d;
        });
    }

    // Skills: only the status is taken from the save. Cost, layout and requirements always come from the code.
    if (Array.isArray(saved.skills)) {
        const valid = ['locked', 'unlocked', 'mastered'];
        out.skills = def.skills.map(d => {
            const s = saved.skills.find(x => isObj(x) && x.id === d.id);
            if (!s || !valid.includes(s.status)) return d;
            const at = typeof s.unlockedAt === 'number' && Number.isFinite(s.unlockedAt) ? s.unlockedAt : null;
            return { ...d, status: s.status, unlockedAt: at };
        });
        // v1 saves already had skill costs deducted from xp, so spentXp stays 0 for them.
    }

    if (Array.isArray(saved.challenges)) {
        out.challenges = def.challenges.map(d => {
            const s = saved.challenges.find(x => isObj(x) && x.id === d.id);
            return s && ['Open', 'In Progress'].includes(s.status) ? { ...d, status: s.status } : d;
        });
    }

    if (isObj(saved.activeSession) && Array.isArray(saved.activeSession.exercises) && saved.activeSession.id) {
        out.activeSession = saved.activeSession;
    }

    return out;
}

const isSeedBaseline = b => b.xp === 12450 && b.workouts === 42 && b.reps === 3500 && b.streak === 12;

// True when a real account still carries the old built-in demo progress.
export function hasLegacySeed() {
    return state.data.mode === 'live' && isSeedBaseline(state.data.userProfile.baseline);
}

export function isDemo() {
    return state.data.mode === 'demo';
}

function readKey(key) {
    try { return localStorage.getItem(key); } catch (e) { bootNotes.storageOk = false; return null; }
}
function writeKey(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { bootNotes.storageOk = false; return false; }
}

export const getMode = () => (readKey(MODE_KEY) === 'demo' ? 'demo' : 'live');

export function initState() {
    const mode = getMode();
    const raw = mode === 'demo' ? readKey(DEMO_KEY) : (userKey() ? readKey(userKey()) : null);
    const fresh = () => (mode === 'demo' ? createDemoState() : createDefaultState());

    if (!raw) {
        // First visit (or the first time this account is used on this device). Saved at once so date-based defaults stay fixed.
        state.data = fresh();
        saveState();
        return;
    }

    try {
        const parsed = JSON.parse(raw);
        // Saves from before Phase 3 get a one-time copy before the upgrade. Nothing is removed by it.
        if ((parsed?.version ?? 1) < 3 && readKey(`${BACKUP_V3_KEY}_${mode}`) === null) {
            writeKey(`${BACKUP_V3_KEY}_${mode}`, raw);
            bootNotes.upgraded = true;
        }
        state.data = normalize(parsed, mode);
        const d = state.data;
        // Old versions seeded every new account with demo progress. If that account was never used,
        // keep the data as the demo and start the real account fresh. Nothing is deleted.
        const untouched = d.workoutHistory.length === 0 && d.userProfile.spentXp === 0 && !d.activeSession
            && Object.keys(d.userProfile.questClaims).length === 0;
        if (mode === 'live' && isSeedBaseline(d.userProfile.baseline) && untouched && (parsed.version ?? 1) >= 2) {
            writeKey(BACKUP_SEEDED_KEY, raw);
            if (readKey(DEMO_KEY) === null) writeKey(DEMO_KEY, JSON.stringify({ ...d, mode: 'demo' }));
            state.data = createDefaultState();
            bootNotes.movedToDemo = true;
            saveState();
        }
    } catch (e) {
        // Never overwrite what we cannot read. Keep a copy first.
        console.error('Saved state is unreadable, starting fresh and keeping a backup', e);
        writeKey(BACKUP_CORRUPT_KEY, raw);
        bootNotes.recovered = true;
        state.data = fresh();
    }
    state.data.version = STATE_VERSION;
}

// Switches between real and demo progress. Each keeps its own data. Reloads the page.
export function switchMode(mode) {
    saveState();
    writeKey(MODE_KEY, mode === 'demo' ? 'demo' : 'live');
    location.reload();
}

// Removes the old built-in demo progress from a real account that has since been used.
// Real workout history and quest claims stay. Skills and spent XP are reset, because they were bought with demo XP.
export function removeLegacySeed() {
    if (!hasLegacySeed()) return;
    const d = state.data;
    const clean = createDefaultState();
    writeKey(BACKUP_SEEDED_KEY, JSON.stringify(d));
    d.userProfile.baseline = clean.userProfile.baseline;
    d.userProfile.spentXp = 0;
    d.userProfile.activity = [];
    d.userProfile.achievementsSeen = null;
    d.userProfile.achievements = clean.userProfile.achievements;
    d.skills = clean.skills;
    saveState();
}

// Returns true when the write succeeded. Callers that care can warn the user.
// Demo progress goes to its own slot. A real account goes to its own per-user cache slot. Nobody signed in: nothing is saved.
export function saveState() {
    const key = state.data.mode === 'demo' ? DEMO_KEY : userKey();
    if (!key) return true;
    const ok = writeKey(key, JSON.stringify(state.data));
    if (state.data.mode !== 'demo') savedListeners.forEach(fn => { try { fn(); } catch (e) { console.warn(e); } });
    return ok;
}

// Replaces the live state with data built from the account (cloud) and caches it. Used after loading from the server.
export function replaceLiveState(raw) {
    state.data = normalize(raw, 'live');
    state.data.version = STATE_VERSION;
    if (userKey()) writeKey(userKey(), JSON.stringify(state.data));
}

// The old shared local slot, for import after login. Never edited here. Returns null when it holds no real progress.
// A sample-seed baseline from older versions is not the user's own progress and is removed from the copy (not from storage).
export function getLegacyData() {
    const raw = readKey(LIVE_KEY) ?? readKey(LEGACY_KEY);
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    const data = normalize(parsed, 'live');
    const p = data.userProfile;
    const seed = isSeedBaseline(p.baseline);
    const real = data.workoutHistory.length > 0 || Object.keys(p.questClaims).length > 0 || p.ledger.length > 0 || (!seed && p.baseline.xp > 0);
    if (!real) return null;
    if (seed) {
        const clean = createDefaultState();
        p.baseline = clean.userProfile.baseline;
        p.spentXp = 0;
        p.activity = [];
        p.achievementsSeen = null;
        p.achievements = clean.userProfile.achievements;
        data.skills = clean.skills;
    }
    return data;
}
