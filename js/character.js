// Character domain service: identity, attributes, cosmetics and the character profile.
// Level, XP and rank are NOT stored here. They come from progression.js, the one XP authority.
// Nothing here touches the DOM.
import { state } from './state.js';
import { getTotalXp, levelProgress, rankForLevel, getWorkoutCount, isAchievementUnlocked } from './progression.js';
import { ATTRIBUTES, ATTRIBUTE_CURVE, ENDURANCE_RULES, RANKS } from './config.js';
import { COSMETICS, DEFAULT_SELECTION, COSMETIC_CATEGORIES, getCosmetic, evaluateUnlocks, isDefaultItem } from './cosmetics.js';
import { classifyExercise } from './exercises.js';
import { cleanText } from './utils.js';

export const MAX_NAME_LENGTH = 20;
export const EQUIPMENT = [
    { id: 'bar', label: 'Pull-up bar' },
    { id: 'parallel', label: 'Parallel bars or dip station' }
];
export const FOCUS_OPTIONS = [
    { id: 'balanced', label: 'Balanced' },
    { id: 'strength', label: 'Strength first' },
    { id: 'skill', label: 'Skills first' }
];

const rankIndexOf = id => Math.max(0, RANKS.findIndex(r => r.id === id));

// ---- Creation and migration ----

function newId() {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    const uuid = c && c.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `char-${uuid}`;
}

export const cleanName = value => cleanText(value, MAX_NAME_LENGTH);

export function createCharacter(now = new Date(), name = 'Athlete') {
    return {
        id: newId(),
        name: cleanName(name) || 'Athlete',
        createdAt: now.getTime(),
        selected: { ...DEFAULT_SELECTION },
        unlocked: COSMETICS.filter(isDefaultItem).map(c => c.id),
        preferences: { equipment: [], focus: 'balanced' },
        // Attribute points that existed before workout history. Zero for a new character.
        attributeBase: { strength: 0, endurance: 0, control: 0, mobility: 0 }
    };
}

// Makes sure `data` has a valid character. An existing player keeps all XP and history.
// Their character is created now, dated from their first recorded workout when there is one.
// Returns true when a character was created.
export function ensureCharacter(data, now = new Date()) {
    if (data.character && typeof data.character.id === 'string') return false;
    const c = createCharacter(now);
    const first = (data.workoutHistory || []).map(h => Date.parse(h.date)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (first) c.createdAt = Math.min(first, now.getTime());
    if (data.mode === 'demo') c.attributeBase = { strength: 400, endurance: 260, control: 180, mobility: 60 };
    data.character = c;
    return true;
}

// ---- Attributes ----
// Rules (documented in docs/PHASE3.md). Points come only from logged sets and logged session time.
//   effort of a set = reps, or seconds / 5 for timed holds (the same effort the XP rule uses)
//   push, pull, legs   -> 100% strength
//   core, reps         -> 50% strength, 50% control
//   core, timed        -> 100% control
//   skill              -> 100% control (timed) or 70% control, 30% mobility (reps)
//   mobility           -> 100% mobility
//   endurance          -> 1 point per minute of a session (max 60 minutes per session) + 25% of reps in sets of 15+
export const ATTRIBUTE_WEIGHTS = {
    push: () => ({ strength: 1 }),
    pull: () => ({ strength: 1 }),
    legs: () => ({ strength: 1 }),
    full: () => ({ strength: 1 }),
    core: unit => (unit === 'sec' ? { control: 1 } : { strength: 0.5, control: 0.5 }),
    skill: unit => (unit === 'sec' ? { control: 1 } : { control: 0.7, mobility: 0.3 }),
    mobility: () => ({ mobility: 1 })
};

export function attributeValue(points) {
    return 1 + Math.floor(Math.sqrt(Math.max(0, points) / ATTRIBUTE_CURVE.divisor));
}

// Pure. history = workout records, base = points from before history.
export function computeAttributes(history, base = {}) {
    const points = Object.fromEntries(ATTRIBUTES.map(a => [a.id, Number(base[a.id]) || 0]));
    for (const rec of history) {
        for (const ex of rec.exercises || []) {
            const unit = ex.unit === 'sec' ? 'sec' : 'reps';
            const weights = (ATTRIBUTE_WEIGHTS[classifyExercise(ex.name)] || ATTRIBUTE_WEIGHTS.full)(unit);
            const sets = Array.isArray(ex.reps) ? ex.reps : [];
            for (const reps of sets) {
                const effort = unit === 'sec' ? Math.round(reps / 5) : reps;
                for (const [attr, w] of Object.entries(weights)) if (attr in points) points[attr] += effort * w;
                if (unit === 'reps' && reps >= ENDURANCE_RULES.highRepThreshold) points.endurance += reps * ENDURANCE_RULES.highRepFactor;
            }
        }
        const minutes = Math.min(ENDURANCE_RULES.maxMinutesPerSession, Math.max(0, (rec.stats?.durationSec || 0) / 60));
        points.endurance += minutes * ENDURANCE_RULES.pointsPerMinute;
    }
    return ATTRIBUTES.map(a => {
        const pts = Math.round(points[a.id]);
        const value = attributeValue(pts);
        const floor = (value - 1) ** 2 * ATTRIBUTE_CURVE.divisor;
        const next = value ** 2 * ATTRIBUTE_CURVE.divisor;
        return { ...a, points: pts, value, pct: Math.min(100, Math.max(0, ((pts - floor) / (next - floor)) * 100)), toNext: Math.max(0, Math.ceil(next - pts)) };
    });
}

export function getAttributes() {
    const { workoutHistory, character } = state.data;
    return computeAttributes(workoutHistory, character?.attributeBase);
}

// ---- Cosmetics ----

function unlockContext() {
    const level = levelProgress(getTotalXp()).level;
    const achievements = new Set(state.data.userProfile.achievements.filter(isAchievementUnlocked).map(a => a.key));
    return { level, rankIndex: rankIndexOf(rankForLevel(level).id), workouts: getWorkoutCount(), achievements };
}

// Adds newly earned items to the character. Never removes one. Returns the items that are new.
export function syncCosmetics() {
    const c = state.data.character;
    if (!c) return [];
    const earned = evaluateUnlocks(unlockContext(), rankIndexOf);
    const fresh = earned.filter(id => !c.unlocked.includes(id));
    if (fresh.length) c.unlocked = [...c.unlocked, ...fresh];
    return fresh.map(getCosmetic).filter(Boolean);
}

export function getCosmeticStatus() {
    const c = state.data.character;
    const ctx = unlockContext();
    const earned = new Set(evaluateUnlocks(ctx, rankIndexOf));
    return COSMETIC_CATEGORIES.map(cat => ({
        ...cat,
        items: COSMETICS.filter(i => i.category === cat.id).map(i => ({
            ...i,
            unlocked: c.unlocked.includes(i.id) || earned.has(i.id),
            selected: c.selected[cat.id] === i.id
        }))
    }));
}

// Only unlocked items can be selected. Returns false otherwise.
export function selectCosmetic(id) {
    const c = state.data.character;
    const item = getCosmetic(id);
    if (!c || !item) return false;
    syncCosmetics();
    if (!c.unlocked.includes(id)) return false;
    c.selected[item.category] = id;
    return true;
}

// ---- Profile ----

export function setCharacterName(value) {
    const name = cleanName(value);
    if (!name || !state.data.character) return false;
    state.data.character.name = name;
    return true;
}

export function setPreferences({ equipment, focus } = {}) {
    const c = state.data.character;
    if (!c) return false;
    if (Array.isArray(equipment)) c.preferences.equipment = EQUIPMENT.map(e => e.id).filter(id => equipment.includes(id));
    if (FOCUS_OPTIONS.some(f => f.id === focus)) c.preferences.focus = focus;
    return true;
}

// The character as the UI shows it. Level, XP and rank are read from progression, never copied.
export function getCharacterProfile() {
    const c = state.data.character;
    const total = getTotalXp();
    const p = levelProgress(total);
    const rank = rankForLevel(p.level);
    const sel = id => getCosmetic(c.selected[id]) || getCosmetic(DEFAULT_SELECTION[id]);
    const achievements = state.data.userProfile.achievements.filter(isAchievementUnlocked);
    return {
        id: c.id,
        name: c.name,
        createdAt: c.createdAt,
        level: p.level,
        xp: total,
        xpIntoLevel: p.intoLevel,
        xpForNextLevel: p.ceiling - p.floor,
        xpToNext: p.toNext,
        pct: p.pct,
        rank,
        attributes: getAttributes(),
        avatar: sel('avatar'),
        frame: sel('frame'),
        background: sel('background'),
        title: sel('title'),
        badge: sel('badge'),
        titles: COSMETICS.filter(i => i.category === 'title' && c.unlocked.includes(i.id)),
        achievements,
        cosmetics: c.unlocked.map(getCosmetic).filter(Boolean),
        preferences: c.preferences
    };
}
