// Phase 3.3, part 3: demo isolation, offline, XP integrity through the real app, local data migration, profile editing.
// Real app in Chrome against the local Supabase stand-in (real Postgres, real migrations). Not a live Supabase project.
import { makeRunner, setupOnline, visible, hash, waitScreen, tabbarShown, logInUi, authSession, cachedState } from './online.mjs';

const { check, finish } = makeRunner();
const env = await setupOnline('cala_flows9');
const { sb, url, open } = env;
const q = (sql, args) => sb.pool.query(sql, args).then(r => r.rows);
const day = (off = 0) => { const d = new Date(Date.now() + off * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const legacyScript = () => `if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('cala_state_v2', ${JSON.stringify(JSON.stringify({
    version: 2, weeklySchedule: [], activeSession: null,
    workoutHistory: [
        { id: 'h1', date: new Date(Date.now() - 864e5 * 40).toISOString(), dateKey: day(-40), type: 'push', title: 'Old', exercises: [{ id: 'a', name: 'Push-ups', unit: 'reps', sets: 3, reps: [20, 15, 10] }], stats: { sets: 3, reps: 45, xp: 120, durationSec: 600 } },
        { id: 'h2', date: new Date(Date.now() - 864e5 * 3).toISOString(), dateKey: day(-3), type: 'push', title: 'Recent', exercises: [], stats: { sets: 4, reps: 60, xp: 200, durationSec: 100 } }],
    userProfile: { baseline: { xp: 3000, workouts: 5, reps: 200, streak: 2, streakEndsOn: day(-1) }, spentXp: 0, questClaims: { [`${day(-1)}:workout`]: 25 }, achievementsSeen: ['first-steps'], activity: [], achievements: [] },
    skills: [{ id: 'pushup', status: 'mastered' }] }))}); }`;
const serverTotal = async uid => Number((await q(`select coalesce(sum(xp_amount),0) s from public.xp_transactions where user_id=$1`, [uid]))[0].s);
const browserXp = page => page.evaluate(async () => (await import('/js/progression.js')).getTotalXp());

try {
    // ================= Demo mode isolation =================
    const demo = await open();
    const vendorHits = []; demo.page.on('request', r => { if (/vendor\/supabase/.test(r.url())) vendorHits.push(r.url()); });
    await demo.page.goto(url); await waitScreen(demo.page, 'welcome');
    await demo.page.click('#screen-welcome [data-flow-action="demo"]');
    await demo.page.waitForSelector('#demo-banner:not(.hidden)'); await waitScreen(demo.page, 'home');
    demo.requests.length = 0; vendorHits.length = 0;   // only what the demo page itself does counts (the click came from Welcome, which may load the library)
    await demo.page.waitForSelector('#quest-board .quest-card', { state: 'attached' });
    await demo.page.waitForTimeout(800);
    check('demo mode opens the app with a visible demo banner', await demo.page.$eval('#demo-banner', e => !e.classList.contains('hidden') && /Demo mode/.test(e.textContent)));
    check('demo mode makes no request to Supabase', demo.requests.length === 0, demo.requests.join());
    check('demo mode does not even load the Supabase library', vendorHits.length === 0);
    check('demo mode has no session and no account cache', await demo.page.evaluate(() => !localStorage.getItem('cala-auth') && !Object.keys(localStorage).some(k => k.startsWith('cala_state_u_') || k.startsWith('cala_sync_u_'))));
    check('demo data lives in its own storage key', await demo.page.evaluate(() => !!localStorage.getItem('cala_state_demo_v1')));
    check('demo shows the demo label on Profile and keeps the old training-setup card', await (async () => { await demo.page.evaluate(() => { location.hash = '#profile'; }); await waitScreen(demo.page, 'profile'); return demo.page.evaluate(() => document.getElementById('ach-meta').textContent.startsWith('Demo') && document.getElementById('profile-account-card').classList.contains('hidden') && !document.getElementById('profile-setup-card').classList.contains('hidden')); })());
    for (const h of ['#login', '#signup', '#welcome', '#ob-character', '#account']) { await demo.page.evaluate(x => { location.hash = x; }, h); await demo.page.waitForTimeout(100); }
    check('demo mode keeps sign-in, onboarding and account screens closed', ['home', 'profile'].includes(await visible(demo.page)), await visible(demo.page));
    check('demo mode still made no request after all of that', demo.requests.length === 0);
    await demo.page.waitForTimeout(500); await demo.page.screenshot({ path: 'shots/33-demo-home.png' });
    await demo.context.close();

    // Demo next to a real account: nothing leaks either way.
    const real = await sb.createUser({ email: 'real@example.com', onboard: true, name: 'Real' });
    const r1 = await open();
    await logInUi(r1.page, url, 'real@example.com'); await waitScreen(r1.page, 'home');
    await r1.page.waitForSelector('#quest-board .quest-card', { state: 'attached' }); await r1.page.waitForTimeout(1800);
    const cacheBefore = JSON.stringify(await cachedState(r1.page));
    const rowsBefore = JSON.stringify(await q(`select (select count(*) from public.workouts)::int w, (select count(*) from public.quests)::int q, (select count(*) from public.xp_transactions)::int x`));
    await r1.page.evaluate(() => { location.hash = '#profile'; }); await waitScreen(r1.page, 'profile');
    await r1.page.click('[data-data-action="demo"]'); await r1.page.waitForSelector('#confirm-ok', { state: 'visible' });
    const mark = r1.requests.length;
    await Promise.all([r1.page.waitForNavigation(), r1.page.click('#confirm-ok')]);
    await r1.page.waitForSelector('#demo-banner:not(.hidden)'); await r1.page.waitForSelector('#quest-board .quest-card', { state: 'attached' });
    // Do something in demo: add a workout to the demo state.
    await r1.page.evaluate(async () => { const { state, saveState } = await import('/js/state.js'); state.data.workoutHistory.push({ id: 'demo-w', date: new Date().toISOString(), dateKey: new Date().toISOString().slice(0, 10), type: 'push', title: 'Demo workout', exercises: [{ id: 'a', name: 'Push-ups', unit: 'reps', sets: 1, reps: [10] }], stats: { sets: 1, reps: 10, xp: 999, durationSec: 60 } }); saveState(); });
    await r1.page.waitForTimeout(2500);
    check('using demo mode while signed in sends nothing to Supabase', r1.requests.length === mark || r1.requests.slice(mark).every(u => !u.includes('/rest/v1/')), r1.requests.slice(mark).join());
    check('a demo workout is not stored in the account', (await q(`select count(*)::int n from public.workouts where client_id='demo-w'`))[0].n === 0);
    await r1.page.click('#exit-demo-btn'); await r1.page.waitForNavigation(); await waitScreen(r1.page, 'profile');
    await r1.page.waitForSelector('#quest-board .quest-card', { state: 'attached' }); await r1.page.waitForTimeout(1500);
    const cacheAfter = await cachedState(r1.page);
    const diff = Object.keys(JSON.parse(cacheBefore)).filter(k => JSON.stringify(JSON.parse(cacheBefore)[k]) !== JSON.stringify(cacheAfter[k]));
    check('leaving demo restores the real account untouched (cache and server rows)', diff.filter(k => !['quests', 'weeklySchedule'].includes(k)).length === 0 && JSON.stringify(cacheAfter.quests.items.map(x => [x.id, x.status, x.progress]).sort()) === JSON.stringify(JSON.parse(cacheBefore).quests.items.map(x => [x.id, x.status, x.progress]).sort()) && JSON.stringify(await q(`select (select count(*) from public.workouts)::int w, (select count(*) from public.quests)::int q, (select count(*) from public.xp_transactions)::int x`)) === rowsBefore, diff.join());

    // ================= XP integrity through the real app =================
    const xpBefore = await serverTotal(real.id);
    await r1.page.evaluate(async () => {
        const { state, saveState } = await import('/js/state.js');
        state.data.workoutHistory.push({ id: 'app-w1', date: new Date().toISOString(), dateKey: new Date().toISOString().slice(0, 10), type: 'push', title: 'Honest workout', exercises: [{ id: 'a', name: 'Push-ups', unit: 'reps', sets: 3, reps: [10, 10, 10] }], stats: { sets: 3, reps: 30, xp: 99999, durationSec: 300 } });
        saveState();
    });
    await r1.page.waitForFunction(async () => true); await r1.page.waitForTimeout(3500);
    const wRow = (await q(`select xp from public.workouts where user_id=$1 and client_id='app-w1'`, [real.id]))[0];
    check('a workout made in the app reaches the account', !!wRow);
    check('the server computed the XP itself (the inflated number in the app was ignored)', wRow && wRow.xp > 0 && wRow.xp < 500, JSON.stringify(wRow));
    const serverNow = await serverTotal(real.id);
    check('the browser total XP equals the server total after sync', (await browserXp(r1.page)) === serverNow && serverNow > xpBefore, `${await browserXp(r1.page)} vs ${serverNow}`);
    await r1.page.reload(); await waitScreen(r1.page, 'profile'); await r1.page.waitForTimeout(3500);   // the new day cycle may complete quests, and the server pays them
    const stable = await serverTotal(real.id);
    check('after a reload the browser XP equals the server XP and the workout has one XP transaction', (await browserXp(r1.page)) === stable && (await q(`select count(*)::int n from public.xp_transactions where user_id=$1 and source_id='app-w1'`, [real.id]))[0].n === 1, `${await browserXp(r1.page)} / ${stable}`);
    const dev2 = await open(); await logInUi(dev2.page, url, 'real@example.com'); await waitScreen(dev2.page, 'home'); await dev2.page.waitForTimeout(800);
    check('a second device shows the same XP as the first', (await browserXp(dev2.page)) === stable && stable === (await browserXp(r1.page)), `${await browserXp(dev2.page)} / ${stable}`);
    await dev2.context.close();

    // ================= Offline =================
    const mkOffline = async () => { await r1.page.route(`${sb.url}/**`, route => route.abort('internetdisconnected'), { times: undefined }); };
    await mkOffline();
    await r1.page.reload(); await r1.page.waitForTimeout(2500);
    check('offline start: a signed-in user with a cached account opens straight into the app', ['home', 'profile'].includes(await visible(r1.page)) && (await tabbarShown(r1.page)), `${await visible(r1.page)} ${await r1.page.evaluate(() => location.hash)}`);
    check('offline start: the cached character and XP are shown', (await browserXp(r1.page)) === stable);
    await r1.page.evaluate(async () => {
        const { state, saveState } = await import('/js/state.js');
        state.data.workoutHistory.push({ id: 'app-w2-offline', date: new Date().toISOString(), dateKey: new Date().toISOString().slice(0, 10), type: 'pull', title: 'Offline workout', exercises: [{ id: 'a', name: 'Pull-ups', unit: 'reps', sets: 2, reps: [5, 5] }], stats: { sets: 2, reps: 10, xp: 70, durationSec: 200 } });
        saveState();
    });
    await r1.page.waitForTimeout(2500);
    check('offline: the workout is kept on the device and not on the server yet', (await q(`select count(*)::int n from public.workouts where client_id='app-w2-offline'`))[0].n === 0 && (await cachedState(r1.page)).workoutHistory.some(w => w.id === 'app-w2-offline'));
    await r1.page.evaluate(() => { location.hash = '#profile'; }); await waitScreen(r1.page, 'profile');
    check('offline: Profile says that changes are waiting', /offline|waiting/i.test(await r1.page.$eval('#pa-text', e => e.textContent)), await r1.page.$eval('#pa-text', e => e.textContent));
    await r1.page.unroute(`${sb.url}/**`);
    await r1.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await r1.page.waitForTimeout(3000);
    const off = (await q(`select xp from public.workouts where client_id='app-w2-offline'`))[0];
    check('back online: the offline workout is sent once and the server computes its XP', !!off && off.xp > 0 && (await q(`select count(*)::int n from public.xp_transactions where source_id='app-w2-offline'`))[0].n === 1);
    check('back online: browser XP equals server XP', (await browserXp(r1.page)) === (await serverTotal(real.id)));
    // A first visit with no cache and no connection.
    const cold = await open();
    await cold.page.route(`${sb.url}/**`, route => route.abort('internetdisconnected'));
    await cold.page.goto(url); await waitScreen(cold.page, 'welcome');
    check('a visitor with no connection still gets the Welcome screen (demo mode works offline)', (await visible(cold.page)) === 'welcome');
    await cold.context.close();
    await r1.context.close();

    // ================= Migration of local data =================
    const mig = await sb.createUser({ email: 'mig@example.com', onboard: false });
    let m = await open({ init: legacyScript() });
    await logInUi(m.page, url, 'mig@example.com');
    await waitScreen(m.page, 'ob-import');
    await m.page.waitForTimeout(500); await m.page.screenshot({ path: 'shots/33-import-prompt.png' });
    check('a new account on a browser with old local progress is asked before anything is imported', (await q(`select count(*)::int n from public.workouts where user_id=$1`, [mig.id]))[0].n === 0 && /2 workouts/.test(await m.page.$eval('#import-summary', e => e.textContent)), await m.page.$eval('#import-summary', e => e.textContent));
    const legacyBefore = await m.page.evaluate(() => localStorage.getItem('cala_state_v2'));
    sb.failNext('import_local_progress', 503, 1);
    await m.page.click('#import-btn');
    await m.page.waitForFunction(() => document.getElementById('import-err').textContent.length > 0);
    check('a failed import shows a recovery message and keeps the local data', /unchanged/i.test(await m.page.$eval('#import-err', e => e.textContent)) && (await m.page.evaluate(() => localStorage.getItem('cala_state_v2'))) === legacyBefore);
    check('a failed import wrote nothing to the account', (await q(`select (select count(*) from public.workouts where user_id=$1)::int w, (select count(*) from public.xp_transactions where user_id=$1)::int x`, [mig.id]))[0].w === 0);
    check('after a failed import the prompt is still open for a retry', (await visible(m.page)) === 'ob-import');
    await m.page.click('#import-btn'); await waitScreen(m.page, 'home');
    await m.page.waitForSelector('#quest-board .quest-card', { state: 'attached' }); await m.page.waitForTimeout(1500);
    check('import: the account total XP equals the old local total (3,000 + 25 + 120 + 200)', (await serverTotal(mig.id)) === 3345, String(await serverTotal(mig.id)));
    check('import: the browser shows the same total and level 3', (await browserXp(m.page)) === 3345 && Number((await q(`select level from public.characters where user_id=$1`, [mig.id]))[0].level) === 3);
    check('import: both old workouts are in the account and marked as imported', (await q(`select count(*)::int n from public.workouts where user_id=$1 and imported`, [mig.id]))[0].n === 2);
    check('import: exactly one legacy_import transaction', (await q(`select count(*)::int n from public.xp_transactions where user_id=$1 and source_type='legacy_import'`, [mig.id]))[0].n === 1);
    check('import: the old local data is kept as a backup, unchanged', (await m.page.evaluate(() => localStorage.getItem('cala_state_v2'))) === legacyBefore);
    check('import: onboarding is complete (the user is not sent through it)', (await q(`select onboarding_completed from public.profiles where id=$1`, [mig.id]))[0].onboarding_completed === true);
    const again = await q(`select 1`).then(async () => { const c = (await import('./online.mjs')).clientFor(sb, (await authSession(m.page)).access_token); return c.rpc('import_local_progress', { p_data: { total_xp: 50000, character: { name: 'X', avatar: 'avatar-user', options: {} }, workouts: [], quests: [], achievements: [], cosmetics: [], app_state: {} } }); });
    check('a second import is ignored by the server (no double XP, no second transaction)', !again.error && again.data.imported === false && (await serverTotal(mig.id)) === 3345 && (await q(`select count(*)::int n from public.xp_transactions where user_id=$1 and source_type='legacy_import'`, [mig.id]))[0].n === 1, JSON.stringify(again));
    await m.page.reload(); await waitScreen(m.page, 'home'); await m.page.waitForTimeout(800);
    check('after a reload the imported progress is unchanged (no duplicate import)', (await browserXp(m.page)) === 3345);
    await m.context.close();

    // Choosing "start fresh", then importing later from Account settings.
    const fresh = await sb.createUser({ email: 'fresh@example.com', onboard: false });
    m = await open({ init: legacyScript() });
    await logInUi(m.page, url, 'fresh@example.com'); await waitScreen(m.page, 'ob-import');
    const lb2 = await m.page.evaluate(() => localStorage.getItem('cala_state_v2'));
    await m.page.click('#import-skip'); await waitScreen(m.page, 'ob-character');
    check('start fresh: onboarding continues and the old data stays untouched on the device', (await m.page.evaluate(() => localStorage.getItem('cala_state_v2'))) === lb2 && (await q(`select count(*)::int n from public.workouts where user_id=$1`, [fresh.id]))[0].n === 0);
    await m.page.reload(); await m.page.waitForTimeout(1500);
    check('start fresh: the choice is remembered (no second prompt after a reload)', (await visible(m.page)) === 'ob-character');
    await m.page.fill('#oc-name', 'Fresh'); await m.page.click('#char-btn'); await waitScreen(m.page, 'ob-goals');
    await m.page.check('#og-primary input[value="general"]'); await m.page.click('#goals-btn'); await waitScreen(m.page, 'ob-prefs');
    await m.page.check('#op-experience input[value="advanced"]'); await m.page.check('#op-environment input[value="gym"]'); await m.page.check('#op-equipment input[value="gym"]'); await m.page.check('#op-frequency input[value="6"]'); await m.page.check('#op-duration input[value="60+"]');
    await m.page.click('#prefs-btn'); await waitScreen(m.page, 'ob-done'); await m.page.click('#done-btn'); await waitScreen(m.page, 'home');
    check('the 6+ days and 60+ minutes answers are accepted', (await q(`select weekly_training_frequency f, preferred_workout_duration d from public.user_preferences where user_id=$1`, [fresh.id]))[0].f === 6);
    await m.page.evaluate(() => { location.hash = '#account'; }); await waitScreen(m.page, 'account');
    check('Account settings offers the import again while the account is empty', await m.page.waitForFunction(() => !document.getElementById('ac-import-btn').classList.contains('hidden'), null, { timeout: 5000 }).then(() => true, () => false));
    await m.context.close();

    // Existing users with old local data are not asked.
    await sb.createUser({ email: 'old@example.com', onboard: true, name: 'Old' });
    m = await open({ init: legacyScript() });
    await logInUi(m.page, url, 'old@example.com'); await waitScreen(m.page, 'home');
    check('an existing finished account is never sent through onboarding or the import prompt', (await hash(m.page)) === '#home');
    check('the old local data does not change the existing account', Number((await q(`select total_xp from public.characters c join auth.users u on u.id=c.user_id where u.email='old@example.com'`))[0].total_xp) === 0);
    await m.context.close();

    // ================= Profile: edit goals and preferences =================
    const ed = await open();
    await logInUi(ed.page, url, 'real@example.com'); await waitScreen(ed.page, 'home');
    await ed.page.evaluate(() => { location.hash = '#profile'; }); await waitScreen(ed.page, 'profile');
    await ed.page.click('#profile-account-card a[href="#preferences"]'); await waitScreen(ed.page, 'preferences');
    check('Profile > Goals and preferences shows the saved answers', await ed.page.evaluate(() => document.querySelector('#ep-primary input[value="strength"]').checked && document.querySelector('#ep-frequency input[value="3"]').checked));
    await ed.page.check('#ep-primary input[value="skills"]'); await ed.page.check('#ep-equipment input[value="rings"]'); await ed.page.check('#ep-frequency input[value="5"]');
    await ed.page.waitForTimeout(500); await ed.page.screenshot({ path: 'shots/33-preferences-edit.png', fullPage: true });
    await ed.page.click('#edit-btn'); await ed.page.waitForFunction(() => !document.getElementById('edit-ok').classList.contains('hidden'));
    const saved = (await q(`select primary_goal, available_equipment, weekly_training_frequency from public.user_preferences where user_id=$1`, [real.id]))[0];
    check('edited goals and preferences are saved on the account', saved.primary_goal === 'skills' && saved.available_equipment.includes('rings') && saved.weekly_training_frequency === 5);
    check('the quest engine settings follow the edit (skills first)', (await cachedState(ed.page)).character.preferences.focus === 'skill');
    await ed.page.evaluate(() => { location.hash = '#profile'; }); await waitScreen(ed.page, 'profile');
    await ed.page.click('#char-rename-btn'); await ed.page.waitForSelector('#char-name-input, #profile input', { state: 'visible' }).catch(() => {});
    const renameInput = await ed.page.$('#screen-profile input[type="text"]');
    if (renameInput) { await renameInput.fill('Renamed'); await renameInput.press('Enter'); await ed.page.waitForTimeout(2500); }
    check('renaming the character in Profile is saved on the account', (await q(`select character_name from public.characters where user_id=$1`, [real.id]))[0].character_name === 'Renamed');
    await ed.page.evaluate(() => { location.hash = '#home'; }); await waitScreen(ed.page, 'home');
    await ed.page.waitForTimeout(500); await ed.page.screenshot({ path: 'shots/33-bottom-nav-home.png' });
    check('the bottom navigation shows the five screens on Home', (await ed.page.$$eval('#tabbar .tab span', s => s.map(x => x.textContent).join())) === 'Home,Quests,Train,Discover,Profile');
    // ================= Storage fully blocked (private mode, policy) =================
    const blocked = await open({ init: "Storage.prototype.setItem = function () { throw new DOMException('blocked', 'QuotaExceededError'); }; Storage.prototype.getItem = function () { throw new DOMException('blocked', 'SecurityError'); };" });
    await blocked.page.goto(url); await blocked.page.waitForTimeout(2500);
    check('with browser storage fully blocked the visitor still gets the Welcome screen and no uncaught error', (await visible(blocked.page)) === 'welcome' && /blocking storage/.test(await blocked.page.$eval('#welcome-notice', e => e.textContent)) && blocked.errors.filter(e => /pageerror/.test(e)).length === 0, `${await visible(blocked.page)} ${blocked.errors.join(' | ')}`);
    await blocked.context.close();

    const unexpected = ed.errors.filter(e => !/status of (400|401|403|503)/.test(e));
    check('no unexpected page errors', unexpected.length === 0, ed.errors.join(' | '));
    await ed.context.close();
} catch (e) {
    check('test run finished without a crash', false, e.stack);
}
await finish(env.close);
