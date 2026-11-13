// SQL tests: migrations, RLS, grants, XP integrity, onboarding functions, import and account deletion.
// They run the real migrations on a real local PostgreSQL 16. Supabase itself is replaced only by stub-auth.sql
// (roles, auth.users, auth.uid). This does NOT prove anything about a live Supabase project.
import { freshDatabase, applyMigrations, asUser, connect } from './db.mjs';
import { levelFromXp, xpForLevel } from '../../js/progression.js';

let pass = 0, fail = 0;
async function test(name, fn) {
    try { await fn(); pass++; console.log('PASS ', name); }
    catch (e) { fail++; console.log('FAIL ', name, '\n      ', e.message); }
}
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const eq = (a, b, m = '') => { if (canon(a) !== canon(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m = 'condition is false') => { if (!v) throw new Error(m); };
async function rejects(promise, re) {
    try { await promise; } catch (e) { if (re.test(e.message)) return; throw new Error(`wrong error: ${e.message} (wanted ${re})`); }
    throw new Error(`did not fail (wanted ${re})`);
}

const db = await freshDatabase('cala_sql');
await applyMigrations(db);

const TERMS = '2026-11-13';
const meta = { accepted_terms: TERMS, accepted_privacy: TERMS };
async function makeUser(email, { verified = true, metadata = meta } = {}) {
    const r = await db.query(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3) returning id`,
        [email, verified ? new Date() : null, JSON.stringify(metadata)]);
    return r.rows[0].id;
}
// A user session: every call is its own committed transaction with the API role and JWT claims set.
const as = uid => ({
    q: async (sql, p = []) => (await asUser(db, uid, d => d.query(sql, p), { keep: true })).rows,
    one: async (sql, p = []) => (await asUser(db, uid, d => d.query(sql, p), { keep: true })).rows[0],
    anon: async (sql, p = []) => (await asUser(db, null, d => d.query(sql, p), { role: 'anon', keep: true })).rows
});
const fnv = async (u, call, p = []) => (await u.one(`select ${call} as r`, p)).r;
// Truly parallel: every call gets its own database connection.
const par = (uid, sql, params = []) => async () => {
    const c = await connect('cala_sql');
    try { return (await asUser(c, uid, d => d.query(sql, params), { keep: true })).rows[0]; } finally { await c.end(); }
};
async function onboarded(email) {
    const id = await makeUser(email); const u = as(id);
    await fnv(u, `public.save_character('Tmp', 'avatar-user', '{}')`); await fnv(u, `public.save_goals('general','{}')`);
    await fnv(u, `public.save_preferences('beginner','home','{none}',3,'20-30')`); await fnv(u, 'public.complete_onboarding()');
    return { id, u };
}

const A = await makeUser('a@example.com'), B = await makeUser('b@example.com');
const U = await makeUser('unverified@example.com', { verified: false });
const ua = as(A), ub = as(B), uu = as(U);
const ex = JSON.stringify([{ id: 'pushup', name: 'Push-ups', unit: 'reps', sets: 3, reps: [10, 10, 10] }, { id: 'plank', name: 'Plank', unit: 'sec', sets: 1, reps: [30] }]);

await test('migrations apply on an empty database', async () => {
    const t = (await db.query(`select count(*)::int n from information_schema.tables where table_schema = 'public'`)).rows[0].n;
    ok(t >= 14, `tables: ${t}`);
});

await test('signup trigger creates the profile and records accepted policies with database time', async () => {
    const p = (await db.query(`select onboarding_step, onboarding_completed, email from public.profiles where id = $1`, [A])).rows[0];
    eq(p, { onboarding_step: 'character', onboarding_completed: false, email: 'a@example.com' });
    const acc = (await db.query(`select policy_type, version, accepted_at > now() - interval '1 minute' fresh from public.policy_acceptances where user_id = $1 order by 1`, [A])).rows;
    eq(acc.map(r => [r.policy_type, r.version, r.fresh]), [['privacy', TERMS, true], ['terms', TERMS, true]]);
});

await test('unknown policy version in signup metadata is ignored', async () => {
    const id = await makeUser('v@example.com', { metadata: { accepted_terms: '1999-01-01', accepted_privacy: TERMS } });
    const acc = (await db.query(`select policy_type from public.policy_acceptances where user_id = $1`, [id])).rows;
    eq(acc.map(r => r.policy_type), ['privacy']);
});

await test('every public table has RLS on, and the API roles hold no write privilege on any table', async () => {
    const off = (await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
    eq(off, [], 'tables without RLS');
    const w = (await db.query(`select grantee, table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`)).rows;
    eq(w, [], 'write grants');
    const anonUser = (await db.query(`select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT' order by 1`)).rows.map(r => r.table_name);
    eq(anonUser, ['policy_versions', 'quest_reward_caps', 'unlock_catalog'], 'anon can read only reference tables');
});

await test('anon cannot read personal data or call any function', async () => {
    await rejects(as(null).anon('select * from public.profiles'), /permission denied/);
    await rejects(as(null).anon('select * from public.workouts'), /permission denied/);
    await rejects(as(null).anon('select public.get_progress()'), /permission denied/);
    const callable = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')`)).rows;
    eq(callable, [], 'functions anon can execute');
    const internal = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.proname like '\\_%' and has_function_privilege('authenticated', p.oid, 'execute')`)).rows;
    eq(internal, [], 'internal helpers callable by users');
});

await test('unverified user: functions refuse and tables show nothing', async () => {
    await rejects(fnv(uu, 'public.get_progress()'), /email_not_verified/);
    await rejects(fnv(uu, `public.save_character('X', 'avatar-user', '{}')`), /email_not_verified/);
    eq(await uu.q('select * from public.profiles'), [], 'profile rows visible to unverified user');
});

await test('onboarding must happen in order', async () => {
    await rejects(fnv(ua, `public.save_goals('strength', '{}')`), /character_required/);
    await rejects(fnv(ua, 'public.complete_onboarding()'), /character_required/);
});

await test('character: validation, starts at level 1 with zero XP, one per user, retry-safe', async () => {
    for (const bad of ['', '   ', 'x'.repeat(21), '<b>hi</b>']) await rejects(fnv(ua, `public.save_character($1, 'avatar-user', '{}')`, [bad]), /invalid_name/);
    await rejects(fnv(ua, `public.save_character('Kara', 'avatar-crown', '{}')`), /invalid_cosmetics/);
    await rejects(fnv(ua, `public.save_character('Kara', 'avatar-user', '{"frame":"frame-gold"}')`), /invalid_cosmetics/);
    await rejects(fnv(ua, `public.save_character('Kara', 'avatar-user', '{"level":9}')`), /invalid_cosmetics/);
    const c = await fnv(ua, `public.save_character('Kara', 'avatar-flame', '{"frame":"frame-plain","background":"bg-default"}')`);
    eq([c.name, c.level, c.total_xp], ['Kara', 1, 0]);
    await fnv(ua, `public.save_character('Kara', 'avatar-flame', '{"frame":"frame-plain","background":"bg-default"}')`); // retry
    await fnv(ua, `public.save_character('Kara R', 'avatar-bolt', '{}')`);                                                  // edit
    const rows = await ua.q('select character_name, level, current_xp, total_xp from public.characters');
    eq(rows, [{ character_name: 'Kara R', level: 1, current_xp: 0, total_xp: 0 }]);
    eq((await ua.one('select onboarding_step from public.profiles')).onboarding_step, 'goals');
    await rejects(ua.q(`insert into public.characters (user_id, character_name) values ($1, 'Dup')`, [A]), /permission denied/);
    await rejects(db.query(`insert into public.characters (user_id, character_name) values ($1, 'Dup')`, [A]), /duplicate key|characters_user_id_key/);
});

await test('goals and preferences: validation and step order', async () => {
    await rejects(fnv(ua, `public.save_preferences('beginner', 'home', '{none}', 3, '20-30')`), /goals_required/);
    await rejects(fnv(ua, `public.save_goals('bulk', '{}')`), /invalid_goal/);
    await rejects(fnv(ua, `public.save_goals('strength', '{a,b}')`), /invalid_goal/);
    await rejects(fnv(ua, `public.save_goals('strength', '{mobility,endurance,skills,general}')`), /invalid_goal/);
    const g = await fnv(ua, `public.save_goals('strength', '{mobility,strength,mobility}')`);
    eq(g, { primary_goal: 'strength', secondary_goals: ['mobility'] }, 'primary removed from secondary, duplicates removed');
    eq((await ua.one('select onboarding_step from public.profiles')).onboarding_step, 'preferences');
    await rejects(fnv(ua, 'public.complete_onboarding()'), /preferences_required/);
    for (const bad of [`('pro', 'home', '{none}', 3, '20-30')`, `('beginner', 'moon', '{none}', 3, '20-30')`, `('beginner', 'home', '{}', 3, '20-30')`,
        `('beginner', 'home', '{none,gym}', 3, '20-30')`, `('beginner', 'home', '{laser}', 3, '20-30')`, `('beginner', 'home', '{none}', 1, '20-30')`,
        `('beginner', 'home', '{none}', 7, '20-30')`, `('beginner', 'home', '{none}', 3, '5')`]) {
        await rejects(fnv(ua, `public.save_preferences${bad}`), /invalid_preferences/);
    }
    await fnv(ua, `public.save_preferences('beginner', 'outdoor', '{pullup-bar,parallel-bars}', 4, '30-45')`);
    eq((await ua.one('select onboarding_step from public.profiles')).onboarding_step, 'summary');
});

await test('no workouts, quests or XP before onboarding is complete', async () => {
    await rejects(fnv(ua, `public.record_workout('w0', 'push', 't', $1::jsonb, 600, now(), true, '{}')`, [ex]), /onboarding_incomplete/);
    await rejects(fnv(ua, `public.sync_quests('[]')`), /onboarding_incomplete/);
});

await test('policies must be accepted before onboarding completes; accepting later works', async () => {
    const C = await makeUser('c@example.com', { metadata: {} });
    const uc = as(C);
    await fnv(uc, `public.save_character('Cee', 'avatar-user', '{}')`);
    await fnv(uc, `public.save_goals('general', '{}')`);
    await fnv(uc, `public.save_preferences('beginner', 'home', '{none}', 2, '15-20')`);
    await rejects(fnv(uc, 'public.complete_onboarding()'), /policies_not_accepted/);
    await rejects(fnv(uc, `public.accept_policies('2020-01-01', '${TERMS}')`), /unknown_policy_version/);
    await fnv(uc, `public.accept_policies('${TERMS}', '${TERMS}')`);
    eq((await fnv(uc, 'public.complete_onboarding()')).completed, true);
});

await test('complete_onboarding sets the flags together and is safe to repeat', async () => {
    eq(await fnv(ua, 'public.complete_onboarding()'), { completed: true, already: false });
    eq(await fnv(ua, 'public.complete_onboarding()'), { completed: true, already: true });
    eq(await ua.one('select onboarding_step, onboarding_completed from public.profiles'), { onboarding_step: 'done', onboarding_completed: true });
    await rejects(db.query(`update public.profiles set onboarding_completed = false where id = $1`, [A]), /profiles_done_consistent/);
});

await test('RLS: a user sees only their own rows', async () => {
    await fnv(ub, `public.save_character('Bea', 'avatar-user', '{}')`);
    eq((await ua.q('select character_name from public.characters')).map(r => r.character_name), ['Kara R']);
    eq((await ub.q('select character_name from public.characters')).map(r => r.character_name), ['Bea']);
    eq((await ua.q('select id from public.profiles')).map(r => r.id), [A]);
    eq((await ua.q('select * from public.characters where user_id = $1', [B])), [], 'A reads B by id');
    eq((await ua.q('select * from public.user_preferences where user_id = $1', [B])), []);
});

await test('users cannot write any table directly, including their own XP, level and profile flags', async () => {
    const attempts = [
        [`update public.characters set total_xp = 999999 where user_id = $1`, A],
        [`update public.characters set level = 50 where user_id = $1`, A],
        [`update public.characters set character_name = 'Hacked' where user_id = $1`, B],
        [`update public.profiles set onboarding_completed = true where id = $1`, B],
        [`update public.profiles set username = 'root' where id = $1`, B],
        [`insert into public.xp_transactions (user_id, source_type, source_id, xp_amount) values ($1, 'quest', 'fake', 100000)`, A],
        [`insert into public.workouts (user_id, client_id, workout_type, duration, exercises, xp, completed_at) values ($1, 'f', 'push', 1, '[]', 99999, now())`, A],
        [`insert into public.achievements (user_id, achievement_id) values ($1, 'first-steps')`, A],
        [`insert into public.cosmetics (user_id, cosmetic_id) values ($1, 'avatar-crown')`, A],
        [`insert into public.app_state (user_id, data) values ($1, '{}')`, A],
        [`insert into public.policy_acceptances (user_id, policy_type, version) values ($1, 'terms', '${TERMS}')`, A],
        [`delete from public.characters where user_id = $1`, A],
        [`delete from public.profiles where id = $1`, A]
    ];
    for (const [sql, uid] of attempts) await rejects(ua.q(sql, [uid]), /permission denied/);
    eq((await ua.one('select total_xp, level from public.characters')), { total_xp: 0, level: 1 });
});

await test('workout XP is computed on the server and the client number is ignored', async () => {
    // (10+10)*3 = 60 for the reps sets, 10 + round(30/5) = 16 for the plank, +25 complete = 101
    const r = await fnv(ua, `public.record_workout('w1', 'push', 'Push day', $1::jsonb, 900, now(), true, '{"xp": 99999}')`, [ex]);
    eq([r.created, r.xp], [true, 101]);
    eq((await ua.one('select total_xp, level, current_xp from public.characters')), { total_xp: 101, level: 1, current_xp: 101 });
    const noBonus = await fnv(ua, `public.record_workout('w2', 'legs', 'Legs', $1::jsonb, 600, now(), false, '{}')`, [ex]);
    eq(noBonus.xp, 76);
});

await test('the same workout can not pay twice (retry, double submit, parallel requests)', async () => {
    const again = await fnv(ua, `public.record_workout('w1', 'push', 'Push day', $1::jsonb, 900, now(), true, '{}')`, [ex]);
    eq([again.created, again.xp], [false, 101]);
    const outcomes = await Promise.all([1, 2, 3, 4, 5, 6].map(() => par(A, `select public.record_workout('w3', 'pull', 'Pull', $1::jsonb, 600, now(), false, '{}') r`, [ex])()));
    eq(outcomes.filter(o => o.r.created).length, 1, 'exactly one request created it');
    eq((await db.query(`select count(*)::int n from public.xp_transactions where user_id = $1 and source_id = 'w3'`, [A])).rows[0].n, 1);
    eq((await ua.one('select total_xp from public.characters')).total_xp, 101 + 76 + 76);
});

await test('invalid workouts are rejected', async () => {
    const bad = [
        [`'[]'`, 600], [`'[{"unit":"reps","reps":[-1]}]'`, 600], [`'[{"unit":"jumps","reps":[5]}]'`, 600],
        [`'[{"unit":"reps","reps":[5000]}]'`, 600], [`'[{"unit":"reps","reps":["x"]}]'`, 600], [`'[{"unit":"reps","reps":[]}]'`, 600],
        [`'{"a":1}'`, 600], [`'[{"unit":"reps","reps":[5]}]'`, -5], [`'[{"unit":"reps","reps":[5]}]'`, 99999]
    ];
    let i = 0;
    for (const [e, d] of bad) await rejects(fnv(ua, `public.record_workout('bad${i++}', 'push', 't', ${e}::jsonb, ${d}, now(), false, '{}')`), /invalid_workout/);
    const many = JSON.stringify([{ unit: 'reps', reps: new Array(201).fill(1) }]);
    await rejects(fnv(ua, `public.record_workout('many', 'push', 't', $1::jsonb, 600, now(), false, '{}')`, [many]), /invalid_workout/);
    await rejects(fnv(ua, `public.record_workout('future', 'push', 't', $1::jsonb, 600, now() + interval '2 days', false, '{}')`, [ex]), /invalid_workout/);
    await rejects(fnv(ua, `public.record_workout('Bad Type!', 'Push Day', 't', $1::jsonb, 600, now(), false, '{}')`, [ex]), /workout_type|check/);
});

await test('daily workout XP is capped', async () => {
    const big = JSON.stringify([{ unit: 'reps', reps: new Array(20).fill(90) }]); // 20 * 100 = 2000
    await fnv(ua, `public.record_workout('big1', 'full', 'Big', $1::jsonb, 3000, now(), false, '{}')`, [big]);
    await rejects(fnv(ua, `public.record_workout('big2', 'full', 'Big', $1::jsonb, 3000, now(), false, '{}')`, [big]), /daily_xp_cap/);
});

await test('XP triggers keep character level, current XP and total XP equal to the ledger', async () => {
    const T = await makeUser('t@example.com'); const ut = as(T);
    await fnv(ut, `public.save_character('Tee', 'avatar-user', '{}')`);
    let running = 0;
    for (const add of [1, 999, 1, 1998, 1, 2999, 3000, 10000, 40000]) {
        running += add;
        await db.query(`insert into public.xp_transactions (user_id, source_type, source_id, xp_amount) values ($1, 'workout', $2, $3)`, [T, `t${running}`, add]);
        const c = (await ut.one('select total_xp, level, current_xp from public.characters'));
        eq([c.total_xp, c.level, c.current_xp], [running, levelFromXp(running), running - xpForLevel(levelFromXp(running))], `at ${running} XP`);
    }
});

await test('even the table owner cannot edit XP columns or the ledger by hand', async () => {
    await rejects(db.query(`update public.characters set total_xp = 5 where user_id = $1`, [A]), /xp_is_read_only/);
    await rejects(db.query(`update public.characters set level = 3 where user_id = $1`, [A]), /xp_is_read_only/);
    await rejects(db.query(`update public.xp_transactions set xp_amount = 1`), /ledger_is_append_only/);
});

await test('SQL level curve equals the JavaScript curve for 20000 sampled XP values', async () => {
    const r = await db.query(`select x, public.level_for_xp(x) l from generate_series(0, 400000, 20) x`);
    for (const row of r.rows) if (row.l !== levelFromXp(row.x)) throw new Error(`mismatch at ${row.x}: sql ${row.l} js ${levelFromXp(row.x)}`);
    for (const b of [999, 1000, 2999, 3000, 5999, 6000, 9999, 10000]) {
        const l = (await db.query('select public.level_for_xp($1) l', [b])).rows[0].l;
        eq(l, levelFromXp(b), `boundary ${b}`);
    }
});

// ---- quests ----
const today = (await db.query(`select (now() at time zone 'UTC')::date d`)).rows[0].d.toISOString().slice(0, 10);
const quest = (id, o = {}) => ({ id, templateId: 'tpl-push', date: today, slot: 'main', category: 'push', title: 'Do pushups', description: 'd',
    difficulty: 1, metric: { kind: 'reps', pattern: 'push' }, target: 20, progress: 20, rewardXp: 100, status: 'completed', completedAt: Date.now(), rewardStatus: 'eligible', ...o });
const sq = async (u, list) => (await u.one('select public.sync_quests($1::jsonb) r', [JSON.stringify(list)])).r;

await test('quest: no reward for a completed quest without a workout on that day', async () => {
    const D = await makeUser('d@example.com'); const ud = as(D);
    await fnv(ud, `public.save_character('Dee', 'avatar-user', '{}')`); await fnv(ud, `public.save_goals('general','{}')`);
    await fnv(ud, `public.save_preferences('beginner','home','{none}',3,'20-30')`); await fnv(ud, 'public.complete_onboarding()');
    const r = await sq(ud, [quest('q-no-evidence')]);
    eq([r[0].status, r[0].xp_granted], ['active', 0]);
    eq((await ud.one('select total_xp from public.characters')).total_xp, 0);
});

await test('quest reward is paid once and the reward is capped by slot', async () => {
    await fnv(ua, `public.record_workout('qw', 'push', 'Quest day', $1::jsonb, 600, now(), false, '{}')`, [ex]).catch(() => {});
    const before = (await ua.one('select total_xp from public.characters')).total_xp;
    const r1 = await sq(ua, [quest('q1', { rewardXp: 9999 })]);
    eq([r1[0].status, r1[0].reward_status, r1[0].xp_granted], ['completed', 'granted', 100], 'capped at the main cap');
    const r2 = await sq(ua, [quest('q1', { rewardXp: 9999 })]);
    eq(r2[0].xp_granted, 0, 'second sync pays nothing');
    await Promise.all([1, 2, 3, 4].map(() => par(A, 'select public.sync_quests($1::jsonb) r', [JSON.stringify([quest('q1')])])()));
    eq((await db.query(`select count(*)::int n from public.xp_transactions where user_id = $1 and source_type = 'quest' and source_id = 'q1'`, [A])).rows[0].n, 1);
    eq((await ua.one('select total_xp from public.characters')).total_xp, before + 100);
    const side = await sq(ua, [quest('q-side', { slot: 'side', rewardXp: 500 })]);
    eq(side[0].xp_granted, 50);
    const opt = await sq(ua, [quest('q-opt', { slot: 'optional', rewardXp: 500 })]);
    eq(opt[0].xp_granted, 40);
});

await test('quest definitions are fixed after the first save and status only moves forward', async () => {
    await sq(ua, [quest('q1', { title: 'Changed', target: 1, rewardXp: 1, status: 'active', progress: 0 })]);
    const row = await ua.one(`select title, target, reward_xp, status from public.quests where client_id = 'q1'`);
    eq([row.title, Number(row.target), row.reward_xp, row.status], ['Do pushups', 20, 100, 'completed']);
    const p = await ua.one(`select progress from public.quest_progress where quest_id = (select id from public.quests where client_id = 'q1')`);
    eq(Number(p.progress), 20, 'progress does not go down');
});

await test('quest limits: five per day, valid dates, valid slots', async () => {
    const { u } = await onboarded('limits@example.com');
    const list = [1, 2, 3, 4, 5, 6].map(i => quest(`many${i}`, { slot: 'side', status: 'active', progress: 0, rewardStatus: 'none' }));
    const r = await sq(u, list.slice(0, 5)); ok(r.every(x => !x.skipped), 'first five are stored');
    const extra = await sq(u, [list[5]]);
    eq(extra[0].skipped, 'too_many_quests');
    await rejects(sq(u, [quest('old', { date: '2020-01-01' })]), /invalid_quests/);
    await rejects(sq(u, [quest('slot', { slot: 'boss' })]), /invalid_quests/);
    await rejects(sq(u, [quest('x', { date: 'not-a-date' })]), /invalid_quests/);
    await rejects(sq(u, new Array(21).fill(0).map((_, i) => quest(`b${i}`))), /invalid_quests/);
});

await test('unlocks: unknown ids ignored, repeats safe, cosmetics need an unlock before they can be equipped', async () => {
    const r = await fnv(ua, `public.sync_unlocks('{first-steps,made-up}', '{avatar-crown,nope}')`);
    eq(r, { achievements_added: 1, cosmetics_added: 1 });
    eq(await fnv(ua, `public.sync_unlocks('{first-steps}', '{avatar-crown}')`), { achievements_added: 0, cosmetics_added: 0 });
    await fnv(ua, `public.save_character('Kara R', 'avatar-crown', '{}')`);
    eq((await ua.one('select avatar_id from public.characters')).avatar_id, 'avatar-crown');
    await rejects(fnv(ub, `public.save_character('Bea', 'avatar-crown', '{}')`), /invalid_cosmetics/);
});

await test('app state keeps only known keys', async () => {
    await fnv(ua, `public.save_app_state('{"spentXp": 500, "xp": 99999, "level": 80, "weeklySchedule": []}')`);
    eq((await ua.one('select data from public.app_state')).data, { spentXp: 500, weeklySchedule: [] });
});

await test('username: format, unique ignoring case', async () => {
    await rejects(fnv(ua, `public.set_username('a b')`), /invalid_username/);
    await fnv(ua, `public.set_username('Kara_R')`);
    await rejects(fnv(ub, `public.set_username('kara_r')`), /username_taken/);
});

await test('get_progress returns the snapshot with ledger-consistent totals', async () => {
    const p = await fnv(ua, 'public.get_progress()');
    const ledger = (await db.query(`select sum(xp_amount)::int s from public.xp_transactions where user_id = $1`, [A])).rows[0].s;
    eq([p.total_xp, p.character.total_xp, p.profile.onboarding_completed], [ledger, ledger, true]);
    ok(p.workouts.length >= 3 && p.quests.length >= 1 && p.achievements.includes('first-steps'));
    eq(p.policies_accepted, true);
    eq(p.preferences.primary_goal, 'strength');
});

// ---- import of old local data ----
const legacy = (o = {}) => ({
    total_xp: 12450 + 300,
    character: { name: 'Old Timer', avatar: 'avatar-bolt', options: { frame: 'frame-cyan', title: 'title-first-steps' }, equipment: ['bar'], focus: 'skill' },
    workouts: [
        { id: 'old-1', date: '2026-10-01T10:00:00Z', type: 'push', title: 'Old push', durationSec: 1200, exercises: [{ id: 'p', name: 'P', unit: 'reps', sets: 2, reps: [10, 10] }], xp: 150, details: { dateKey: '2026-10-01' } },
        { id: 'old-2', date: '2026-10-02T10:00:00Z', type: 'pull', title: 'Old pull', durationSec: 900, exercises: [], xp: 150, details: {} }
    ],
    quests: [{ id: 'oq1', date: '2026-10-02', slot: 'main', templateId: 't', category: 'push', title: 'Old quest', description: '', difficulty: 1, metric: { kind: 'reps' }, target: 10, progress: 10, rewardXp: 100, status: 'completed', completedAt: 1790000000000, rewardStatus: 'granted' },
        { id: 'bad', slot: 'nope' }],
    achievements: ['first-steps'], cosmetics: ['frame-cyan', 'title-first-steps'],
    app_state: { spentXp: 500, baseline: { workouts: 42, reps: 3500, streak: 12 }, evil: 1 },
    ...o
});

await test('import: preserves character, workouts, XP, unlocks; one ledger row; not double counted', async () => {
    const E = await makeUser('e@example.com'); const ue = as(E);
    const r = await fnv(ue, 'public.import_local_progress($1::jsonb)', [JSON.stringify(legacy())]);
    eq([r.imported, r.workouts, r.total_xp], [true, 2, 12750]);
    const p = await fnv(ue, 'public.get_progress()');
    eq([p.profile.onboarding_completed, p.character.name, p.character.avatar_id, p.character.total_xp, p.character.level], [true, 'Old Timer', 'avatar-bolt', 12750, levelFromXp(12750)]);
    eq(p.workouts.map(w => [w.client_id, w.xp, w.imported]), [['old-1', 150, true], ['old-2', 150, true]]);
    eq(p.quests.length, 1, 'the malformed quest is skipped');
    eq(p.quests[0].reward_status, 'granted');
    eq(p.achievements, ['first-steps']);
    eq(p.preferences.available_equipment, ['pullup-bar']); eq(p.preferences.primary_goal, 'skills');
    eq(p.app_state, { spentXp: 500, baseline: { workouts: 42, reps: 3500, streak: 12 }});
    const tx = (await db.query(`select source_type, xp_amount from public.xp_transactions where user_id = $1`, [E])).rows;
    eq(tx, [{ source_type: 'legacy_import', xp_amount: 12750 }]);
});

await test('import: second call does nothing; new workouts add on top', async () => {
    const E = (await db.query(`select id from auth.users where email = 'e@example.com'`)).rows[0].id; const ue = as(E);
    eq((await fnv(ue, 'public.import_local_progress($1::jsonb)', [JSON.stringify(legacy({ total_xp: 1 }))])).reason, 'already_imported');
    eq((await ue.one('select total_xp from public.characters')).total_xp, 12750);
    const r = await fnv(ue, `public.record_workout('new1', 'push', 'New', $1::jsonb, 600, now(), true, '{}')`, [ex]);
    eq((await ue.one('select total_xp from public.characters')).total_xp, 12750 + r.xp);
});

await test('import: refuses an account that already has progress, bad totals, and leaves nothing behind on failure', async () => {
    await rejects(fnv(ua, 'public.import_local_progress($1::jsonb)', [JSON.stringify(legacy())]), /account_not_empty/);
    const F = await makeUser('f@example.com'); const uf = as(F);
    await rejects(fnv(uf, 'public.import_local_progress($1::jsonb)', [JSON.stringify(legacy({ total_xp: 100 }))]), /invalid_import/);       // workouts claim 300
    await rejects(fnv(uf, 'public.import_local_progress($1::jsonb)', [JSON.stringify(legacy({ total_xp: -5 }))]), /invalid_import/);
    await rejects(fnv(uf, 'public.import_local_progress($1::jsonb)', [JSON.stringify(legacy({ total_xp: 99999999 }))]), /invalid_import/);
    eq((await db.query(`select count(*)::int n from public.characters where user_id = $1`, [F])).rows[0].n, 0, 'no half-imported character');
    eq((await db.query(`select count(*)::int n from public.workouts where user_id = $1`, [F])).rows[0].n, 0);
    eq((await db.query(`select onboarding_completed from public.profiles where id = $1`, [F])).rows[0].onboarding_completed, false);
});

await test('account deletion removes every row of the user and nothing of anyone else', async () => {
    const tables = (await db.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name in ('user_id', 'id')
        and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
        group by table_name having bool_or(column_name = 'user_id') or table_name = 'profiles'`)).rows.map(r => r.table_name);
    ok(tables.length >= 11, `found ${tables.length} user tables`);
    const count = async uid => { let n = 0; for (const t of tables) n += (await db.query(`select count(*)::int n from public.${t} where ${t === 'profiles' ? 'id' : 'user_id'} = $1`, [uid])).rows[0].n; return n; };
    const beforeA = await count(A), beforeB = await count(B);
    ok(beforeA > 15 && beforeB > 0, `A has ${beforeA} rows`);
    eq(await fnv(ua, 'public.delete_my_account()'), { deleted: true });
    eq(await count(A), 0, 'rows left for A');
    eq((await db.query(`select count(*)::int n from auth.users where id = $1`, [A])).rows[0].n, 0);
    eq(await count(B), beforeB, 'B untouched');
    await rejects(fnv(as(null), 'public.delete_my_account()'), /permission denied|not_authenticated/);
});

await db.end();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
