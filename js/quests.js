// Quest engine: generation, daily lifecycle, progress and reward processing.
// No DOM. It reads and changes `state.data` only, and never touches storage or the clock on its own:
// the caller passes `now`. That keeps it testable and ready for a server later.
//
// DATE STRATEGY
//   A quest "day" is the player's local calendar date at the moment of the check ("YYYY-MM-DD", from dateKey()).
//   One set exists per date. A set that already exists is never regenerated, so refreshes, reopened tabs and
//   changed time zones cannot create a second set or a second reward. DST needs no special case because the
//   date is read from the local calendar, not computed from 24 hour blocks.
//   If the clock moves back to a date that already has a set (travel west), that set is shown again as it is.
//   Expired quests never come back to life.
import { state } from './state.js';
import { dateKey, addDays } from './utils.js';
import { QUEST_CONFIG } from './config.js';
import { QUEST_TEMPLATES, getTemplate } from './quest-templates.js';
import { classifyExercise } from './exercises.js';
import { getLevel, getWorkoutCount, grantReward } from './progression.js';

export const TIERS = ['beginner', 'intermediate', 'advanced'];
export const SLOTS = ['main', 'side', 'optional'];

// ---- Small deterministic helpers ----

function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const tierDown = tier => TIERS[Math.max(0, TIERS.indexOf(tier) - 1)];
const dayOfWeek = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isRestDay(schedule, key) {
    const entry = (schedule || []).find(d => d.day === DAY_NAMES[dayOfWeek(key)]);
    return !!entry && entry.type === 'rest';
}

// ---- Tier ----
// The tier comes from real training evidence. XP and level alone are never enough for advanced work.
export function determineTier({ level, workoutCount, recentWorkouts, ownedSkills }) {
    const t = QUEST_CONFIG.tiers;
    const a = t.advanced;
    if (level >= a.minLevel && workoutCount >= a.minWorkouts && recentWorkouts >= a.minRecentWorkouts && ownedSkills >= a.minOwnedSkills) return 'advanced';
    const i = t.intermediate;
    if (level >= i.minLevel && workoutCount >= i.minWorkouts) return 'intermediate';
    return 'beginner';
}

// ---- Training load ----

function recordsOn(history, key) { return history.filter(h => h.dateKey === key); }

function repsOf(ex) { return Array.isArray(ex.reps) ? ex.reps.reduce((a, b) => a + (Number(b) || 0), 0) : 0; }

// Reps per movement pattern over yesterday and today, and how many days in a row were trained.
export function recentLoad(history, date) {
    const byPattern = {};
    [addDays(date, -1), date].forEach(key => recordsOn(history, key).forEach(rec => (rec.exercises || []).forEach(ex => {
        if (ex.unit === 'sec') return;
        const p = classifyExercise(ex.name);
        byPattern[p] = (byPattern[p] || 0) + repsOf(ex);
    })));
    const days = new Set(history.map(h => h.dateKey));
    let cursor = days.has(date) ? date : addDays(date, -1);
    let consecutiveDays = 0;
    while (days.has(cursor)) { consecutiveDays++; cursor = addDays(cursor, -1); }
    return { byPattern, consecutiveDays };
}

// ---- Progress ----

export function computeProgress(metric, records) {
    switch (metric.kind) {
        case 'best_workout_sets': return records.reduce((m, r) => Math.max(m, r.stats?.sets || 0), 0);
        case 'active_seconds': return records.reduce((s, r) => s + (r.stats?.durationSec || 0), 0);
        case 'reps':
        case 'seconds': {
            const timed = metric.kind === 'seconds';
            let sum = 0;
            records.forEach(rec => (rec.exercises || []).forEach(ex => {
                if ((ex.unit === 'sec') !== timed) return;
                const match = metric.names ? metric.names.includes(ex.name) : classifyExercise(ex.name) === metric.pattern;
                if (match) sum += repsOf(ex);
            }));
            return sum;
        }
        default: return 0;
    }
}

// Best single-day total for a metric in past history. Used to keep goals realistic.
function bestDay(metric, history, before) {
    const days = new Map();
    history.filter(h => h.dateKey < before).forEach(h => days.set(h.dateKey, [...(days.get(h.dateKey) || []), h]));
    let best = 0;
    days.forEach(records => { best = Math.max(best, computeProgress(metric, records)); });
    return best;
}

const lowestTarget = t => Math.min(...Object.values(t.targets).filter(Number.isFinite));

function targetFor(template, tier, history, date) {
    let target = template.targets[tier];
    if (!['reps', 'seconds'].includes(template.metric.kind)) return target;
    const floor = lowestTarget(template);
    const best = bestDay(template.metric, history, date);
    // No history of this movement: start at the lowest goal. Otherwise stay within reach of what was done before.
    target = best === 0 ? Math.min(target, floor) : Math.min(target, Math.max(floor, Math.ceil(best * QUEST_CONFIG.capabilityCap)));
    return target;
}

// ---- Generation ----

function eligible(template, tier, ctx, load) {
    if (!Number.isFinite(template.targets[tier])) return false;
    const req = template.requires || {};
    if ((req.equipment || []).some(e => !ctx.preferences.equipment.includes(e))) return false;
    if (req.skill && !ctx.skills.some(s => s.id === req.skill && s.status !== 'locked')) return false;
    if (template.pattern && (load.byPattern[template.pattern] || 0) >= QUEST_CONFIG.highLoadReps[tier]) return false;
    return true;
}

function pickWeighted(list, weightOf, rand) {
    const weights = list.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r < 0) return list[i]; }
    return list[list.length - 1];
}

function makeQuest(template, slot, tier, ctx) {
    const target = targetFor(template, tier, ctx.history, ctx.date);
    return {
        id: `q:${ctx.character.id}:${ctx.date}:${template.id}`,
        templateId: template.id,
        characterId: ctx.character.id,
        date: ctx.date,
        slot,
        category: template.category,
        title: template.title(target, tier),
        description: template.description(target, tier),
        difficulty: TIERS.indexOf(tier) + 1,
        tier,
        metric: { ...template.metric },
        target,
        progress: 0,
        rewardXp: QUEST_CONFIG.rewards[slot],
        status: 'active',
        completedAt: null,
        rewardStatus: 'none',
        rewardTxId: null,
        generationVersion: QUEST_CONFIG.generationVersion
    };
}

// Builds the quest set for ctx.date. Pure: same input, same output.
// ctx = { date, character, preferences, history, level, workoutCount, skills, schedule, yesterdayTemplateIds }
export function generateDailyQuests(ctx) {
    const rand = rng(hashString(`${ctx.character.id}|${ctx.date}|v${QUEST_CONFIG.generationVersion}`));
    const recent = ctx.history.filter(h => h.dateKey >= addDays(ctx.date, -QUEST_CONFIG.tiers.advanced.recentDays) && h.dateKey <= ctx.date).length;
    const ownedSkills = ctx.skills.filter(s => s.status !== 'locked').length;
    const tier = determineTier({ level: ctx.level, workoutCount: ctx.workoutCount, recentWorkouts: recent, ownedSkills });
    const load = recentLoad(ctx.history, ctx.date);
    const rest = isRestDay(ctx.schedule, ctx.date);
    const tired = load.consecutiveDays >= QUEST_CONFIG.restAfterConsecutiveDays;
    const heavyDay = Object.entries(load.byPattern).some(([, reps]) => reps >= QUEST_CONFIG.highLoadReps[tier]);
    const lighterTier = tired ? tierDown(tier) : tier;
    const used = new Set();
    const out = [];
    const take = (template, slot, useTier) => { used.add(template.id); out.push(makeQuest(template, slot, useTier, ctx)); };
    const fresh = list => { const f = list.filter(t => !used.has(t.id)); const notYesterday = f.filter(t => !ctx.yesterdayTemplateIds.includes(t.id)); return notYesterday.length ? notYesterday : f; };
    const forSlot = slot => QUEST_TEMPLATES.filter(t => t.slot === slot);

    // Main: a workout on training days, gentle mobility on scheduled rest days.
    const mainTemplate = rest ? getTemplate('main-recovery') : getTemplate('main-workout');
    take(mainTemplate, 'main', lighterTier);

    // Side: strength or skill. Rest days only offer skill work. A trained-out pattern is skipped.
    const sideCount = rest ? Math.min(1, QUEST_CONFIG.structure.side) : QUEST_CONFIG.structure.side;
    const focus = ctx.preferences.focus;
    const catWeight = c => (rest ? (c === 'skill' ? 1 : 0) : focus === 'strength' ? (c === 'strength' ? 3 : 1) : focus === 'skill' ? (c === 'skill' ? 3 : 1) : 1);
    for (let i = 0; i < sideCount; i++) {
        let pool = fresh(forSlot('side').filter(t => eligible(t, lighterTier, ctx, load) && catWeight(t.category) > 0));
        if (!pool.length) pool = fresh(forSlot('optional').filter(t => t.recovery));
        if (!pool.length) break;
        const t = pickWeighted(pool, p => catWeight(p.category) || 1, rand);
        take(t, 'side', t.recovery ? tier : lighterTier);
    }

    // Optional: recovery after hard days, consistency otherwise. Never required.
    const needsRecovery = !rest && (tired || heavyDay);
    const optionalPool = fresh(forSlot('optional').filter(t => eligible(t, tier, ctx, { byPattern: {} })));
    if (optionalPool.length) {
        const prefer = optionalPool.filter(t => (needsRecovery ? t.recovery : !t.recovery) || false);
        const choices = prefer.length ? prefer : optionalPool;
        take(choices[Math.floor(rand() * choices.length)], 'optional', tier);
    }
    return out;
}

// ---- Context from state ----

export function buildQuestContext(date, data = state.data) {
    const yesterdayKey = addDays(date, -1);
    return {
        date,
        character: data.character,
        preferences: data.character.preferences,
        history: data.workoutHistory,
        level: getLevel(),
        workoutCount: getWorkoutCount(),
        skills: data.skills,
        schedule: data.weeklySchedule,
        yesterdayTemplateIds: data.quests.items.filter(q => q.date === yesterdayKey).map(q => q.templateId)
    };
}

// ---- Lifecycle ----

export function getQuestsForDate(date, data = state.data) {
    const order = { main: 0, side: 1, optional: 2 };
    return data.quests.items.filter(q => q.date === date).sort((a, b) => order[a.slot] - order[b.slot]);
}

// Creates today's set when there is none. Never replaces an existing set. Returns the new quests.
export function ensureDailyQuests(date, data = state.data) {
    if (data.quests.items.some(q => q.date === date)) return [];
    const created = generateDailyQuests(buildQuestContext(date, data));
    data.quests.items.push(...created);
    return created;
}

// Re-reads progress from the verified workout history and moves quests between states.
// Quests of earlier days are settled once: finished if the logged work reached the goal, otherwise expired.
export function syncQuests(today, data = state.data, now = Date.now()) {
    const changes = { progressed: [], completed: [], expired: [] };
    for (const q of data.quests.items) {
        if (q.status !== 'active') continue;
        const records = recordsOn(data.workoutHistory, q.date);
        const value = Math.min(q.target, computeProgress(q.metric, records));
        if (value >= q.target) {
            const last = records.map(r => Date.parse(r.date)).filter(Number.isFinite).sort((a, b) => b - a)[0];
            q.progress = q.target;
            q.status = 'completed';
            q.completedAt = q.date < today && last ? last : now;
            q.rewardStatus = 'eligible';
            changes.completed.push(q);
        } else if (q.date < today) {
            q.progress = value;
            q.status = 'expired';
            changes.expired.push(q);
        } else if (value !== q.progress) {
            q.progress = value;
            changes.progressed.push(q);
        }
    }
    data.quests.lastCheckedKey = today;
    return changes;
}

// Pays every eligible reward through the ledger. The ledger id makes this safe to run any number of times.
export function processRewards(data = state.data) {
    const granted = [];
    for (const q of data.quests.items) {
        if (q.status !== 'completed' || q.rewardStatus !== 'eligible') continue; // expired quests are never paid
        const tx = grantReward({ id: `quest:${q.id}`, xp: q.rewardXp, source: 'quest', sourceId: q.id, date: q.date, at: q.completedAt || Date.now() });
        q.rewardStatus = 'granted';
        q.rewardTxId = `quest:${q.id}`;
        if (tx) granted.push({ quest: q, tx });
    }
    return granted;
}

// ---- Views ----

export function msUntilReset(now = new Date()) {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return next.getTime() - now.getTime();
}

// Last N days before today with their finished/total counts. Rest days are not failures, so no streak or penalty is derived.
export function getQuestHistory(today = dateKey(), days = 7, data = state.data) {
    const out = [];
    for (let i = 1; i <= days; i++) {
        const key = addDays(today, -i);
        const set = getQuestsForDate(key, data);
        if (set.length) out.push({ date: key, total: set.length, completed: set.filter(q => q.status === 'completed').length });
    }
    return out;
}
