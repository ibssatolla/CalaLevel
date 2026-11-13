// Domain tests for Phase 3. They import the real modules and run in Node, no browser.
// Run under several time zones:  TZ=Europe/Oslo node unit3.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = process.env.CALA_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { state } = await import(`${ROOT}/js/state.js`);
const P = await import(`${ROOT}/js/progression.js`);
const C = await import(`${ROOT}/js/character.js`);
const Q = await import(`${ROOT}/js/quests.js`);
const G = await import(`${ROOT}/js/game.js`);
const E = await import(`${ROOT}/js/events.js`);
const { dateKey, addDays } = await import(`${ROOT}/js/utils.js`);
const { QUEST_CONFIG, RANKS } = await import(`${ROOT}/js/config.js`);
const { QUEST_TEMPLATES } = await import(`${ROOT}/js/quest-templates.js`);

const INITIAL = JSON.stringify(state.data);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };

const noon = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); };
const TODAY = '2026-06-10';
function fresh(mutate) {
    state.data = JSON.parse(INITIAL);
    C.ensureCharacter(state.data, noon(TODAY));
    state.data.character.id = 'char-test';
    state.data.weeklySchedule.forEach(d => { d.type = d.day === 'Wed' || d.day === 'Sun' ? 'rest' : d.type; });
    if (mutate) mutate(state.data);
    E.resetEvents();
    return state.data;
}
let n = 0;
const rec = (key, exercises = [], { sets, durationSec = 300, xp = 0 } = {}) => ({
    id: `r${++n}`, date: noon(key).toISOString(), dateKey: key, type: 'push', title: 'T',
    exercises: exercises.map(e => ({ id: 'x', name: e.name, unit: e.unit || 'reps', sets: e.reps.length, reps: e.reps })),
    stats: { sets: sets ?? exercises.reduce((a, e) => a + e.reps.length, 0), reps: 0, xp, durationSec }
});
const ctxFor = (key, d = state.data) => Q.buildQuestContext(key, d);
const slots = list => Object.fromEntries(list.map(q => [q.slot, q]));
// A Monday in the test week so Wed/Sun rest-day logic is predictable. 2026-06-10 is a Wednesday.
const MON = '2026-06-08', TUE = '2026-06-09', WED = '2026-06-10', THU = '2026-06-11';

// ================= CHARACTER =================
fresh();
let c = state.data.character;
check('new character: id, name, creation time, defaults', /^char-/.test(c.id) && c.name === 'Athlete' && c.createdAt > 0 && c.selected.avatar === 'avatar-user');
check('new character: Level 1, 0 XP, rank Rookie', P.getTotalXp() === 0 && C.getCharacterProfile().level === 1 && C.getCharacterProfile().rank.id === 'rookie');
check('new character: only default cosmetics unlocked', C.getCharacterProfile().cosmetics.every(i => i.requirement.type === 'default'));
check('new character: four attributes at 1, no points', C.getAttributes().length === 4 && C.getAttributes().every(a => a.value === 1 && a.points === 0));

fresh(d => {
    d.userProfile.baseline.xp = 3200; d.userProfile.baseline.workouts = 5;
    d.workoutHistory.push(rec('2026-05-01', [{ name: 'Push-ups', reps: [10] }], { xp: 40 }));
    d.character = null;
});
const xpBefore = P.getTotalXp();
const created = C.ensureCharacter(state.data, noon(TODAY));
check('existing player: character created, XP and history untouched', created && P.getTotalXp() === xpBefore && state.data.workoutHistory.length === 1);
check('existing player: character dated from first workout', new Date(state.data.character.createdAt).toISOString().startsWith('2026-05-01'));
check('ensureCharacter is idempotent', C.ensureCharacter(state.data, noon(TODAY)) === false);

check('rank progression comes from its own table', P.rankForLevel(1).id === 'rookie' && P.rankForLevel(2).id === 'rookie' && P.rankForLevel(3).id === 'trainee' && P.rankForLevel(5).id === 'street-warrior' && P.rankForLevel(99).id === 'legend');
check('rank titles unchanged from earlier versions', P.rankTitleForLevel(5) === 'Street Warrior' && P.rankTitleForLevel(10) === 'Legend');
check('level curve unchanged: 1000, 3000, 6000', P.xpForLevel(2) === 1000 && P.xpForLevel(3) === 3000 && P.levelFromXp(5999) === 3 && P.levelFromXp(6000) === 4);

const attr = h => Object.fromEntries(C.computeAttributes(h, {}).map(a => [a.id, a.points]));
check('attributes: push-ups feed strength (a 15+ rep set adds endurance)', JSON.stringify(attr([rec(TODAY, [{ name: 'Push-ups', reps: [20] }], { durationSec: 0 })])) === JSON.stringify({ strength: 20, endurance: 5, control: 0, mobility: 0 }));
check('attributes: plank hold feeds control (seconds / 5)', attr([rec(TODAY, [{ name: 'Plank', unit: 'sec', reps: [60] }], { durationSec: 0 })]).control === 12);
check('attributes: mobility time feeds mobility', attr([rec(TODAY, [{ name: 'Cat-Cow', unit: 'sec', reps: [45, 45] }], { durationSec: 0 })]).mobility === 18);
check('attributes: endurance from time (capped at 60 min) and 15+ rep sets', attr([rec(TODAY, [{ name: 'Squats', reps: [20] }], { durationSec: 7200 })]).endurance === 65);
check('attributes: diminishing steps, no inflation', C.attributeValue(20) === 2 && C.attributeValue(80) === 3 && C.attributeValue(320) === 5 && C.attributeValue(1280) === 9);
check('attributes: unknown names fall back safely', C.computeAttributes([rec(TODAY, [{ name: 'Mystery', reps: [10] }])], {}).every(a => Number.isFinite(a.points)));

fresh(d => { d.userProfile.baseline.xp = 15000; });
let fresh1 = C.syncCosmetics().map(i => i.id);
check('cosmetics unlock from level and rank (level 6)', fresh1.includes('frame-gold') && fresh1.includes('avatar-shield') && fresh1.includes('title-street-warrior') && fresh1.includes('bg-aurora') && !fresh1.includes('avatar-crown'));
check('cosmetics: cannot select a locked item', C.selectCosmetic('avatar-crown') === false && state.data.character.selected.avatar === 'avatar-user');
check('cosmetics: can select an unlocked item', C.selectCosmetic('frame-gold') === true && state.data.character.selected.frame === 'frame-gold');
state.data.userProfile.baseline.xp = 0;
C.syncCosmetics();
check('cosmetics: earned items are never taken away', state.data.character.unlocked.includes('frame-gold'));
check('cosmetics: syncing again finds nothing new', C.syncCosmetics().length === 0);
check('name is cleaned and limited', C.setCharacterName('  <b>Ibssa</b>   Kala  ') && state.data.character.name === 'bIbssa/b Kala');
check('empty name is refused', C.setCharacterName('   ') === false);

// ================= QUESTS: generation =================
fresh();
let day = Q.generateDailyQuests(ctxFor(THU));
let s = slots(day);
check('generation: 1 main, 1 side, 1 optional', day.length === 3 && s.main && s.side && s.optional);
check('generation: rewards 100 / 50 / 40 from config', s.main.rewardXp === 100 && s.side.rewardXp === 50 && s.optional.rewardXp === 40);
check('generation: new player gets beginner goals', day.every(q => q.tier === 'beginner' && q.difficulty === 1) && s.main.target === 1);
check('generation: quest model fields', ['id', 'templateId', 'characterId', 'date', 'slot', 'category', 'title', 'description', 'difficulty', 'target', 'progress', 'rewardXp', 'status', 'completedAt', 'rewardStatus', 'generationVersion'].every(k => k in s.main) && s.main.status === 'active' && s.main.progress === 0 && s.main.completedAt === null);
check('generation: stable ids', s.main.id === `q:char-test:${THU}:main-workout`);
check('generation: deterministic (same input, same output)', JSON.stringify(Q.generateDailyQuests(ctxFor(THU))) === JSON.stringify(day));
check('generation: floor-only player gets no bar or dip quests', Array.from({ length: 60 }, (_, i) => Q.generateDailyQuests(ctxFor(addDays('2026-07-01', i)))).flat().every(q => !/pullup|dips|lsit$/.test(q.templateId)));
check('generation: goals are reasonable (push-ups at most 15 for beginners)', Array.from({ length: 40 }, (_, i) => Q.generateDailyQuests(ctxFor(addDays('2026-08-01', i)))).flat().filter(q => q.templateId === 'side-pushups').every(q => q.target === 15));
check('generation: variety over days', new Set(Array.from({ length: 30 }, (_, i) => Q.generateDailyQuests(ctxFor(addDays('2026-08-01', i)))[1].templateId)).size >= 3);

// daily uniqueness
fresh();
const first = Q.ensureDailyQuests(THU);
const again = Q.ensureDailyQuests(THU);
check('daily uniqueness: second call creates nothing', first.length === 3 && again.length === 0 && state.data.quests.items.length === 3);
Q.ensureDailyQuests(addDays(THU, 1));
check('daily uniqueness: next day gets its own set', state.data.quests.items.length === 6 && new Set(state.data.quests.items.map(q => q.id)).size === 6);

// ================= QUESTS: difficulty scaling =================
const tierOf = ({ level, workouts, recent, skills }) => Q.determineTier({ level, workoutCount: workouts, recentWorkouts: recent, ownedSkills: skills });
check('tier: beginner by default', tierOf({ level: 1, workouts: 0, recent: 0, skills: 1 }) === 'beginner');
check('tier: XP alone never makes advanced (level 12, no training)', tierOf({ level: 12, workouts: 0, recent: 0, skills: 6 }) === 'beginner');
check('tier: level 6 with few workouts is not advanced', tierOf({ level: 6, workouts: 10, recent: 2, skills: 4 }) === 'intermediate');
check('tier: intermediate needs workouts and level', tierOf({ level: 3, workouts: 5, recent: 0, skills: 1 }) === 'intermediate' && tierOf({ level: 2, workouts: 50, recent: 9, skills: 5 }) === 'beginner');
check('tier: advanced needs level, history, recent frequency and skills', tierOf({ level: 6, workouts: 30, recent: 8, skills: 3 }) === 'advanced' && tierOf({ level: 6, workouts: 30, recent: 8, skills: 2 }) === 'intermediate');

fresh(d => { d.userProfile.baseline.xp = 20000; });  // lots of XP, no training
check('XP alone: 20,000 XP and no workouts still gets beginner quests', Q.generateDailyQuests(ctxFor(THU)).every(q => q.tier === 'beginner'));

fresh(d => { d.userProfile.baseline.xp = 3500; d.userProfile.baseline.workouts = 8; });
let mid = Q.generateDailyQuests(ctxFor(THU));
check('intermediate: main asks for a workout of 8+ sets', slots(mid).main.target === 8 && slots(mid).main.tier === 'intermediate');
const pushTarget = Q.generateDailyQuests({ ...ctxFor(THU), history: [] });
fresh(d => { d.userProfile.baseline.xp = 3500; d.userProfile.baseline.workouts = 8; d.workoutHistory.push(rec('2026-06-01', [{ name: 'Push-ups', reps: [10] }])); });
const capped = Array.from({ length: 80 }, (_, i) => Q.generateDailyQuests(ctxFor(addDays('2026-07-01', i)))).flat().filter(q => q.templateId === 'side-pushups');
check('goals stay within reach of past performance (best 10 reps -> goal at most 15)', capped.length > 0 && capped.every(q => q.target <= 15), JSON.stringify(capped.map(q => q.target)));

fresh(d => { d.userProfile.baseline.xp = 3500; d.userProfile.baseline.workouts = 8; d.character.preferences.equipment = ['bar']; d.skills.find(k => k.id === 'pullup').status = 'unlocked'; });
const pulls = Array.from({ length: 80 }, (_, i) => Q.generateDailyQuests(ctxFor(addDays('2026-07-01', i)))).flat().filter(q => /pullup/.test(q.templateId));
check('equipment and skill unlock pull-up quests', pulls.length > 0 && pulls.some(q => q.templateId === 'side-pullups'));
fresh(d => { d.userProfile.baseline.xp = 3500; d.userProfile.baseline.workouts = 8; d.character.preferences.equipment = ['bar']; });
check('pull-ups need the Pull Up skill, not just a bar', Array.from({ length: 80 }, (_, i) => Q.generateDailyQuests(ctxFor(addDays('2026-07-01', i)))).flat().every(q => q.templateId !== 'side-pullups'));

// ================= QUESTS: recovery and safety =================
fresh();
const restDay = slots(Q.generateDailyQuests(ctxFor(WED)));
check('rest day: main quest is light mobility, not a workout', restDay.main.templateId === 'main-recovery' && restDay.main.category === 'mobility');
check('rest day: side quest is skill work, no strength', Array.from({ length: 20 }, (_, i) => Q.generateDailyQuests(ctxFor(addDays('2026-06-17', i * 7)))).every(l => slots(l).side.category !== 'strength'));
check('rest day: no recovery duplicate among the three', new Set(Object.values(restDay).map(q => q.templateId)).size === 3 && restDay.optional.category !== 'mobility');

fresh(d => { d.workoutHistory.push(rec(addDays(THU, -3), [{ name: 'Squats', reps: [10] }]), rec(addDays(THU, -2), [{ name: 'Squats', reps: [10] }]), rec(addDays(THU, -1), [{ name: 'Squats', reps: [10] }])); });
const tired = slots(Q.generateDailyQuests(ctxFor(THU)));
check('three training days in a row: optional quest becomes recovery', tired.optional.templateId === 'rec-mobility');

fresh(d => { d.userProfile.baseline.xp = 3500; d.userProfile.baseline.workouts = 8; d.workoutHistory.push(rec(addDays(THU, -1), [{ name: 'Push-ups', reps: [50, 40] }, { name: 'Dips', reps: [10] }])); });
const afterHeavyPush = Array.from({ length: 40 }, (_, i) => { state.data.character.id = `char-v${i}`; return Q.generateDailyQuests(ctxFor(THU)); }).flat();
check('heavy push day: no push quest the next day', afterHeavyPush.every(q => q.templateId !== 'side-pushups' && q.templateId !== 'side-dips'));
check('heavy day: optional quest is recovery', afterHeavyPush.filter(q => q.slot === 'optional').every(q => q.templateId === 'rec-mobility'));
check('rest days do not count as failures: no penalty field anywhere', !JSON.stringify(Q.generateDailyQuests(ctxFor(THU))).match(/penalty|fail|streak/i));

// ================= QUESTS: completion, rewards, expiry =================
fresh();
Q.ensureDailyQuests(THU);
const mainId = `q:char-test:${THU}:main-workout`;
let ch = Q.syncQuests(THU, state.data, noon(THU).getTime());
check('no workout: nothing completes', ch.completed.length === 0 && Q.getQuestsForDate(THU).every(q => q.status === 'active'));
state.data.workoutHistory.push(rec(THU, [{ name: 'Push-ups', reps: [15] }], { sets: 1, xp: 25 }));
ch = Q.syncQuests(THU, state.data, noon(THU).getTime());
const mainQ = state.data.quests.items.find(q => q.id === mainId);
check('workout completes the main quest and marks the reward eligible', mainQ.status === 'completed' && mainQ.rewardStatus === 'eligible' && mainQ.progress === mainQ.target && mainQ.completedAt > 0);
const xp0 = P.getTotalXp();
let paid = Q.processRewards();
const sideQ = Q.getQuestsForDate(THU).find(q => q.slot === 'side');
check('rewards are paid once through the ledger', paid.some(p => p.quest.id === mainId) && P.getTotalXp() === xp0 + paid.reduce((a, p) => a + p.tx.xp, 0) && state.data.userProfile.ledger.some(t => t.id === `quest:${mainId}`) && mainQ.rewardStatus === 'granted');
const xp1 = P.getTotalXp();
check('processing again pays nothing more', Q.processRewards().length === 0 && P.getTotalXp() === xp1);
Q.syncQuests(THU, state.data, noon(THU).getTime());
check('syncing again changes nothing and pays nothing', Q.processRewards().length === 0 && P.getTotalXp() === xp1);
check('grantReward refuses the same id', P.grantReward({ id: `quest:${mainId}`, xp: 100 }) === null && P.getTotalXp() === xp1);
check('grantReward refuses bad input', P.grantReward({ id: '', xp: 10 }) === null && P.grantReward({ id: 'a', xp: -5 }) === null && P.grantReward({ id: 'b', xp: NaN }) === null);
mainQ.rewardStatus = 'eligible'; // simulate a crash between ledger write and status write
check('crash safety: eligible but already in ledger is not paid twice', Q.processRewards().length === 0 && P.getTotalXp() === xp1 && mainQ.rewardStatus === 'granted');

// expiry and midnight
fresh();
Q.ensureDailyQuests(WED);
Q.syncQuests(THU, state.data, noon(THU).getTime());
check('midnight: unmet quests of yesterday expire', Q.getQuestsForDate(WED).every(q => q.status === 'expired'));
check('midnight: expired quests are never rewarded', Q.processRewards().length === 0 && P.getTotalXp() === 0);
state.data.workoutHistory.push(rec(THU, [{ name: 'Plank', unit: 'sec', reps: [600] }], { sets: 1 }));
Q.syncQuests(addDays(THU, 1), state.data, noon(THU).getTime());
check('expired quests stay expired even if work is logged later', Q.getQuestsForDate(WED).every(q => q.status === 'expired'));
check('midnight: history of past quests is kept', Q.getQuestsForDate(WED).length === 3 && state.data.quests.lastCheckedKey === addDays(THU, 1));

fresh();
Q.ensureDailyQuests(WED);
state.data.workoutHistory.push(rec(WED, [{ name: 'Plank', unit: 'sec', reps: [60] }], { sets: 1, durationSec: 400 }));
Q.syncQuests(THU, state.data, noon(THU).getTime());
const lateDone = Q.getQuestsForDate(WED).filter(q => q.status === 'completed');
check('work logged before midnight still counts when the app is opened next day', lateDone.length >= 1 && lateDone.every(q => q.completedAt < noon(THU).getTime()));
const lateXp = Q.processRewards().reduce((a, p) => a + p.tx.xp, 0);
check('late settlement pays exactly once', lateXp > 0 && Q.processRewards().length === 0);

// ================= Game cycle, events, integration =================
fresh();
const seen = [];
Object.values(E.EVT).forEach(t => E.on(t, p => seen.push([t, p])));
let cyc = G.runDailyCycle(noon(THU));
check('cycle: creates today\'s quests', cyc.created.length === 3 && state.data.quests.lastCheckedKey === THU);
const xpA = P.getTotalXp();
G.runDailyCycle(noon(THU)); G.runDailyCycle(noon(THU));
check('refresh does not duplicate quests or rewards', state.data.quests.items.length === 3 && P.getTotalXp() === xpA);

fresh(d => { d.userProfile.baseline.xp = 880; });   // 120 below level 2
const ev = [];
Object.values(E.EVT).forEach(t => E.on(t, () => ev.push(t)));
G.runDailyCycle(noon(THU));
const before = P.getProgressSnapshot();
state.data.workoutHistory.push(rec(THU, [{ name: 'Push-ups', reps: [15] }], { sets: 1, xp: 25 }));
G.runDailyCycle(noon(THU), before);
check('integration: workout completes quest, pays reward, raises level once', ev.filter(t => t === 'QUEST_COMPLETED').length >= 1 && ev.filter(t => t === 'REWARD_GRANTED').length >= 1 && ev.filter(t => t === 'LEVEL_UP').length === 1 && C.getCharacterProfile().level === 2, ev.join(','));
check('integration: character profile follows progression (XP from one source)', C.getCharacterProfile().xp === P.getTotalXp() && C.getCharacterProfile().rank.id === P.rankForLevel(2).id);
const nLevel = ev.filter(t => t === 'LEVEL_UP').length;
G.runDailyCycle(noon(THU));
check('integration: running again raises no second level-up', ev.filter(t => t === 'LEVEL_UP').length === nLevel);

fresh(d => { d.userProfile.baseline.xp = 2990; });
const ev2 = [];
E.on('RANK_UNLOCKED', p => ev2.push(p.rank.id));
G.runDailyCycle(noon(THU));
const b2 = P.getProgressSnapshot();
state.data.workoutHistory.push(rec(THU, [{ name: 'Push-ups', reps: [15] }], { sets: 1, xp: 25 }));
G.runDailyCycle(noon(THU), b2);
check('integration: crossing into Trainee unlocks the rank once', ev2.length === 1 && ev2[0] === 'trainee', ev2.join(','));

fresh();
E.on('QUEST_COMPLETED', () => { throw new Error('listener bug'); });
const origErr = console.error; console.error = () => {};
G.runDailyCycle(noon(THU));
state.data.workoutHistory.push(rec(THU, [{ name: 'Push-ups', reps: [15] }], { sets: 1, xp: 25 }));
G.runDailyCycle(noon(THU));
console.error = origErr;
check('a failing UI listener cannot lose a reward', state.data.userProfile.ledger.length >= 1 && P.getTotalXp() > 25);

// ================= Time: midnight, DST, time zones =================
fresh();
const keys = [];
for (let i = 0; i < 40; i++) {
    const k = addDays('2026-03-20', i);
    keys.push(k);
    Q.ensureDailyQuests(k);
}
const perDay = new Map();
state.data.quests.items.forEach(q => perDay.set(q.date, (perDay.get(q.date) || 0) + 1));
check('DST (spring): one set per date, none skipped or doubled', keys.every(k => perDay.get(k) === 3));
const keys2 = [];
for (let i = 0; i < 40; i++) keys2.push(addDays('2026-10-15', i));
keys2.forEach(k => Q.ensureDailyQuests(k));
const perDay2 = new Map();
state.data.quests.items.forEach(q => perDay2.set(q.date, (perDay2.get(q.date) || 0) + 1));
check('DST (autumn): one set per date, none skipped or doubled', keys2.every(k => perDay2.get(k) === 3));
let seq = true;
for (let i = 1; i < keys.length; i++) { const [y, m, d] = keys[i].split('-').map(Number); const [y0, m0, d0] = keys[i - 1].split('-').map(Number); if (new Date(y, m - 1, d).getTime() - new Date(y0, m0 - 1, d0).getTime() < 82800000) seq = false; }
check('date keys advance one calendar day at a time', seq && keys[0] === '2026-03-20');
const midday = new Date(2026, 2, 29, 12, 0, 0);
const nextMid = new Date(2026, 2, 30, 0, 0, 0);
check('time until reset uses the next local midnight', Q.msUntilReset(midday) === nextMid - midday && Q.msUntilReset(new Date(2026, 5, 10, 23, 59, 30)) === 30000);
check('just after midnight is a new day', dateKey(new Date(2026, 5, 11, 0, 0, 1)) === '2026-06-11' && dateKey(new Date(2026, 5, 10, 23, 59, 59)) === '2026-06-10');

// time zone change on a fixed instant
fresh();
const originalTz = process.env.TZ;
process.env.TZ = 'Europe/Oslo';
const instant = new Date('2026-11-12T23:30:00Z');       // 00:30 on the 13th in Oslo, the 12th in Los Angeles
const osloKey = dateKey(instant);
G.runDailyCycle(instant);
const inOslo = state.data.quests.items.length;
process.env.TZ = 'America/Los_Angeles';
const laKey = dateKey(instant);
G.runDailyCycle(instant);
const xpTz = P.getTotalXp();
process.env.TZ = 'Pacific/Auckland';
G.runDailyCycle(instant);
check('time zone change: keys differ across zones', osloKey === '2026-11-13' && laKey === '2026-11-12');
check('time zone change: one set per date key, no duplicate quest ids', inOslo === 3 && new Set(state.data.quests.items.map(q => q.id)).size === state.data.quests.items.length && state.data.quests.items.length <= 9);
process.env.TZ = 'Europe/Oslo';
const before2 = state.data.quests.items.length;
G.runDailyCycle(instant);
check('time zone change: returning to a known date reuses its set', state.data.quests.items.length === before2 && P.getTotalXp() === xpTz);
if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;

// ================= Persistence safety =================
fresh();
G.runDailyCycle(noon(THU));
const snapshot = JSON.stringify(state.data);
check('state is plain JSON and survives a round trip', JSON.stringify(JSON.parse(snapshot)) === snapshot);
check('quests work without optional data (no character preferences)', (() => { delete state.data.character.preferences.focus; try { Q.generateDailyQuests(ctxFor(addDays(THU, 1))); return true; } catch { return false; } })());

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed (TZ=${process.env.TZ || 'system'})`);
process.exit(passed === results.length ? 0 : 1);
