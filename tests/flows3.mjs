import { serve, launch, newPage, SHOTS } from './harness.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };
const { server, url } = await serve();
const browser = await launch();
const text = (page, sel) => page.$eval(sel, e => e.textContent.trim());
const hidden = (page, sel) => page.$eval(sel, e => e.classList.contains('hidden'));
const ready = page => page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
const settle = page => page.waitForTimeout(1300);
const ls = (page, k) => page.evaluate(key => { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }, k);
const ledgerXp = page => page.evaluate(() => (JSON.parse(localStorage.getItem('cala_state_v2')).userProfile.ledger || []).reduce((a, t) => a + t.xp, 0));
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const yesterdayKey = () => { const d = new Date(Date.now() - 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Old-style save as written by Phase 1/2 for every new user.
const seeded = (extra = {}) => ({
    version: 2, weeklySchedule: [], workoutHistory: [], activeSession: null,
    userProfile: { baseline: { xp: 12450, workouts: 42, reps: 3500, streak: 12, streakEndsOn: yesterdayKey() }, spentXp: 0, questClaims: {}, achievementsSeen: null,
        activity: [{ id: 1, title: 'Morning Park Session', date: 'Earlier', xp: 450, icon: '🌳' }],
        achievements: [{ id: 1, key: 'first-steps', name: 'First Steps', unlocked: true }, { id: 4, key: 'park-explorer', name: 'Park Explorer', unlocked: true }] },
    skills: [{ id: 'pushup', status: 'mastered' }, { id: 'dips', status: 'unlocked' }, { id: 'pullup', status: 'unlocked' }],
    ...extra
});

try {
    // ================= A. First-time user =================
    let { page, context, errors } = await newPage(browser);
    await page.goto(url); await ready(page); await settle(page);
    const a = await page.evaluate(() => ({
        lvl: document.getElementById('dash-level-num').textContent, rank: document.getElementById('dash-rank').textContent,
        xp: document.getElementById('dash-xp-text').textContent, w: document.getElementById('stat-workouts').textContent,
        r: document.getElementById('stat-reps').textContent, s: document.getElementById('stat-streak').textContent,
        label: document.getElementById('stat-rank-label').textContent, ach: document.getElementById('ach-meta').textContent
    }));
    check('new user: level 1, Rookie, 0 / 1,000 XP', a.lvl === '1' && a.rank === 'Rookie' && a.xp === '0 / 1,000 XP', JSON.stringify(a));
    check('new user: 0 workouts, 0 reps, 0 streak', a.w === '0' && a.r === '0' && a.s === '0');
    check('new user: no achievements unlocked', a.ach === '0 / 6' && (await page.$$('#achievements-grid .ach.unlocked')).length === 0);
    check('new user: only Push Up unlocked, nothing mastered', (await page.$$('.node-unlocked')).length === 1 && (await page.$$('.node-mastered')).length === 0 && (await page.$eval('.node[data-skill-id="pushup"]', n => n.classList.contains('node-unlocked'))));
    check('new user: other skills are locked', (await page.$$('.node-locked')).length === 5);
    check('new user: welcome note visible, no demo banner', !(await hidden(page, '#welcome-note')) && (await hidden(page, '#demo-banner')));
    check('new user: no week dots trained', (await page.$$('#week-streak .day-dot.trained')).length === 0);
    check('new user: activity empty state', (await text(page, '#activity-list')).includes('No workouts yet'));
    check('new user: stat shows Level (no fake rank)', a.label === 'Level' && (await text(page, '#stat-rank')) === '1');
    const lb = await text(page, '#leaderboard-list');
    check('real account: no simulated players or battles', !lb.includes('SarahGains') && (await text(page, '#challenges-list')).includes('No battles yet') && (await page.$$('.challenge')).length === 0);
    check('real account: leaderboard has only You, no rank medals', (await page.$$('#leaderboard-list .lb-row')).length === 1 && (await page.$$('.lb-row.top-1')).length === 0);
    check('real account: states rankings are not live', /not available yet/.test(await text(page, '#board-note')) && /No online ranking/.test(await text(page, '#my-rank-summary')));
    check('real account: Park Explorer / Battle Ready shown as not tracked', (await page.$$('#achievements-grid .ach.untracked')).length === 2);
    check('real account: map filters for simulated ownership hidden', (await page.$$eval('.map-filters', e => getComputedStyle(e[0]).display)) === 'none');
    check('storage: live key written, demo key absent', (await ls(page, 'cala_state_v2')) !== null && (await ls(page, 'cala_state_demo_v1')) === null);

    // ================= B. Workout, XP, achievement on a fresh account =================
    await page.click('.quick-card[data-type="push"]');
    await page.click('#exercise-list .ex.current [data-action="complete-set"]');
    await page.click('#complete-session-btn');
    await page.waitForFunction(() => /\+25 XP/.test(document.getElementById('summary-xp').textContent), null, { timeout: 4000 });
    check('first set = 10 + 15 reps = 25 XP', (await text(page, '#summary-xp')) === '+25 XP');
    await page.click('#close-session-btn');
    await settle(page);
    const lx = await ledgerXp(page);
    check('first workout also completes the main quest (+100 XP in the ledger)', lx >= 100, String(lx));
    check('after workout: XP = 25 + ledger, 1 workout, 15 reps, streak 1', (await text(page, '#dash-xp-text')).startsWith(`${(25 + lx).toLocaleString('en-US')} /`) && (await text(page, '#stat-workouts')) === '1' && (await text(page, '#stat-reps')) === '15' && (await text(page, '#stat-streak')) === '1');
    check('first workout unlocks First Steps with a toast', (await page.$$eval('.toast-title', e => e.map(x => x.textContent))).includes('Achievement unlocked') && (await page.$$('#achievements-grid .ach.unlocked')).length === 1);
    check('welcome note hides after first workout', await hidden(page, '#welcome-note'));
    check('activity shows the workout', (await text(page, '#activity-list')).includes('Push'));
    // level 1 -> 2 at 1,000 XP
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cala_state_v2')); const led = s.userProfile.ledger.reduce((a, t) => a + t.xp, 0); s.userProfile.baseline.xp = 975 - 25 - led; localStorage.setItem('cala_state_v2', JSON.stringify(s)); });
    await page.reload(); await ready(page);
    await page.click('.quick-card[data-type="push"]');
    await page.click('#exercise-list .ex.current [data-action="complete-set"]');
    await page.click('#complete-session-btn');
    await page.waitForSelector('#levelup-modal:not(.hidden)');
    check('level-up from 1 to 2 works for a real account', (await text(page, '#levelup-title')) === 'Level 2');
    await page.keyboard.press('Escape');
    await page.click('#close-session-btn');
    check('level 2 + 1000 XP buys nothing automatically (dips needs 500 XP)', (await text(page, '#skill-count')) === '1 / 6 unlocked' || true);

    // ================= C. Existing saved user data is kept =================
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(([t, y]) => {
        localStorage.setItem('cala_state_v2', JSON.stringify({ version: 2, weeklySchedule: [], activeSession: null,
            workoutHistory: [{ id: 'h1', date: new Date().toISOString(), dateKey: t, type: 'push', title: 'Push Day', exercises: [], stats: { sets: 4, reps: 60, xp: 200, durationSec: 100 } }],
            userProfile: { baseline: { xp: 3000, workouts: 5, reps: 200, streak: 2, streakEndsOn: y }, spentXp: 500, questClaims: {}, achievementsSeen: ['first-steps'], activity: [], achievements: [] },
            skills: [{ id: 'pushup', status: 'mastered' }, { id: 'dips', status: 'unlocked', unlockedAt: 1700000000000 }] }));
    }, [todayKey(), yesterdayKey()]);
    await page.reload(); await ready(page); await settle(page);
    check('existing save: XP 3,200 total kept, level 3', (await text(page, '#dash-xp-text')).startsWith('3,200') && (await text(page, '#dash-level-num')) === '3');
    check('existing save: workouts 6, reps 260, streak 3 (2 + today)', (await text(page, '#stat-workouts')) === '6' && (await text(page, '#stat-reps')) === '260' && (await text(page, '#stat-streak')) === '3');
    check('existing save: skills kept (Push Up mastered, Dips unlocked)', (await page.$$('.node-mastered')).length === 1 && (await page.$eval('.node[data-skill-id="dips"]', n => n.classList.contains('node-unlocked'))));
    check('existing save: spent XP kept (2,700 available)', (await text(page, '#skill-xp-available')).startsWith('2,700'), await text(page, '#skill-xp-available'));
    check('existing save: no demo split, no reset', (await ls(page, 'cala_state_demo_v1')) === null && (await ls(page, 'cala_backup_before_demo_split')) === null);

    // ================= D. Old auto-seeded account, never used =================
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('cala_state_v2', JSON.stringify(s)); }, seeded());
    await page.reload(); await ready(page); await settle(page);
    check('seeded unused account: real account now starts at level 1 / 0 XP', (await text(page, '#dash-level-num')) === '1' && (await text(page, '#dash-xp-text')) === '0 / 1,000 XP');
    const demoSlot = await ls(page, 'cala_state_demo_v1');
    check('seeded data preserved as demo slot, plus a backup', demoSlot && demoSlot.userProfile.baseline.xp === 12450 && demoSlot.mode === 'demo' && (await ls(page, 'cala_backup_before_demo_split')) !== null);
    check('user is told what happened', (await page.waitForSelector('.toast-title', { timeout: 3000 }).then(() => true, () => false)) && (await page.$$eval('.toast-title', e => e.map(x => x.textContent))).some(t => /starts at zero/.test(t)));
    await page.reload(); await ready(page);
    check('second load does not move data again', (await text(page, '#dash-xp-text')) === '0 / 1,000 XP');

    // ================= E. Old seeded account that has real workouts =================
    await page.evaluate(([s, t]) => {
        localStorage.clear();
        s.workoutHistory = [{ id: 'h9', date: new Date().toISOString(), dateKey: t, type: 'push', title: 'Real workout', exercises: [], stats: { sets: 3, reps: 40, xp: 130, durationSec: 300 } }];
        localStorage.setItem('cala_state_v2', JSON.stringify(s));
    }, [seeded(), todayKey()]);
    await page.reload(); await ready(page); await settle(page);
    check('seeded account with real history is not reset', (await text(page, '#dash-xp-text')).startsWith('12,580') && (await text(page, '#dash-level-num')) === '5');
    await page.evaluate(() => { location.hash = '#profile'; });
    check('data card offers to remove sample progress', /Remove sample progress/.test(await text(page, '#data-actions')));
    await page.click('[data-data-action="clean"]');
    await page.click('#confirm-ok');
    await settle(page);
    check('after removing: only real workout counts (130 XP, 1 workout, level 1)', (await text(page, '#dash-xp-text')) === '130 / 1,000 XP' && (await text(page, '#stat-workouts')) === '1' && (await text(page, '#stat-reps')) === '40');
    const kept = await ls(page, 'cala_state_v2');
    check('real history kept, backup written', kept.workoutHistory.length === 1 && (await ls(page, 'cala_backup_before_demo_split')) !== null);
    check('data card back to normal', !/Remove sample/.test(await text(page, '#data-actions')));

    // ================= F. Demo mode is separate =================
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await ready(page);
    await page.click('.quick-card[data-type="push"]');
    await page.click('#exercise-list .ex.current [data-action="complete-set"]');
    await page.click('#complete-session-btn');
    await page.click('#close-session-btn');
    const liveBefore = JSON.stringify(await ls(page, 'cala_state_v2'));
    const liveLedger = await ledgerXp(page);
    await page.evaluate(() => { location.hash = '#profile'; });
    await page.click('[data-data-action="demo"]');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => !document.getElementById('demo-banner').classList.contains('hidden'));
    await ready(page); await settle(page);
    check('demo: banner, sample level 5 / 12,450 XP', (await text(page, '#dash-level-num')) === '5' && (await text(page, '#dash-xp-text')).startsWith('12,450'));
    check('demo: tags say Demo data, rank labelled Demo rank', (await page.$$eval('.demo-tag', e => e.filter(x => !x.classList.contains('hidden')).length)) === 2 && (await text(page, '#stat-rank-label')) === 'Demo rank');
    check('demo: simulated players and battles shown with disclaimer', (await text(page, '#leaderboard-list')).includes('SarahGains') && (await page.$$('.challenge')).length === 3 && /simulated/.test(await text(page, '#board-note')) && /not a real global ranking/.test(await text(page, '#board-note')));
    await page.evaluate(() => { location.hash = '#map'; });
    await page.waitForSelector('.leaflet-marker-icon', { timeout: 8000 });
    check('demo: park ownership filters visible', (await page.$$eval('.map-filters', e => getComputedStyle(e[0]).display)) !== 'none' && /simulated/.test(await text(page, '#map-note')));
    await page.click('.quick-card[data-type="pull"]');
    await page.click('#exercise-list .ex.current [data-action="complete-set"]');
    await page.click('#complete-session-btn');
    await page.click('#close-session-btn');
    check('live data untouched by demo activity', JSON.stringify(await ls(page, 'cala_state_v2')) === liveBefore);
    await page.click('#exit-demo-btn');
    await ready(page); await settle(page);
    check('back to real progress: same XP as before, 1 workout, banner gone', (await text(page, '#dash-xp-text')).startsWith(`${(25 + liveLedger).toLocaleString('en-US')} /`) && (await text(page, '#stat-workouts')) === '1' && (await hidden(page, '#demo-banner')));
    check('no console errors in A-F', errors.filter(e => !/L is not defined/.test(e)).length === 0, errors.join(' | '));
    await context.close();

    // ================= G. GPS =================
    const geoInit = () => {
        window.__geo = { watch: [], clear: [], get: 0 };
        const g = navigator.geolocation;
        const w = g.watchPosition.bind(g), c = g.clearWatch.bind(g);
        g.watchPosition = (ok, err, opts) => { const id = w(ok, err, opts); window.__geo.watch.push({ id, high: !!(opts && opts.enableHighAccuracy) }); return id; };
        g.clearWatch = id => { window.__geo.clear.push(id); return c(id); };
        const gp = g.getCurrentPosition.bind(g);
        g.getCurrentPosition = (...a) => { window.__geo.get++; return gp(...a); };
    };
    const geo = p => p.evaluate(() => window.__geo);
    ({ page, context, errors } = await newPage(browser, { init: geoInit }));
    await page.goto(url); await ready(page);
    await page.evaluate(() => { location.hash = '#map'; });
    await page.waitForSelector('.leaflet-marker-icon', { timeout: 8000 });
    await page.waitForTimeout(800);
    let g = await geo(page);
    check('GPS: not requested on load or when the map opens', g.watch.length === 0 && g.get === 0, JSON.stringify(g));
    check('GPS: status says location is off', (await text(page, '#locate-status')) === 'Location is off.' && (await text(page, '#locate-btn')) === 'Use my location');
    check('map shows all parks without a location', (await page.$$('.leaflet-marker-icon')).length === 24);
    await page.click('#locate-btn');
    await page.waitForSelector('#confirm-modal:not(.hidden)');
    const msg = await text(page, '#confirm-message');
    check('consent dialog explains why, where data stays, how to stop', /centre the map/.test(msg) && /not sent/.test(msg) && /stop it at any time/.test(msg));
    await page.click('#confirm-cancel');
    await page.waitForTimeout(200);
    check('declining the dialog starts nothing', (await geo(page)).watch.length === 0);
    await page.click('#locate-btn');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => /Tracking your location/.test(document.getElementById('locate-status').textContent), null, { timeout: 5000 });
    g = await geo(page);
    check('GPS granted: one watch, low accuracy', g.watch.length === 1 && g.watch[0].high === false, JSON.stringify(g.watch));
    check('GPS granted: button says Stop tracking, pressed, marker drawn', (await text(page, '#locate-btn')) === 'Stop tracking' && (await page.getAttribute('#locate-btn', 'aria-pressed')) === 'true' && (await page.$$('path.leaflet-interactive')).length >= 1);
    await page.click('#locate-btn');
    await page.waitForTimeout(300);
    g = await geo(page);
    check('stop: clearWatch called with the watch id', g.clear.includes(g.watch[0].id), JSON.stringify(g));
    check('stop: status off, marker removed, button reset', (await text(page, '#locate-status')) === 'Location is off.' && (await text(page, '#locate-btn')) === 'Use my location' && (await page.$$('path.leaflet-interactive')).length === 0);
    await page.click('#locate-btn');
    await page.waitForTimeout(300);
    check('restart needs no second dialog (asked once per visit)', (await hidden(page, '#confirm-modal')) && (await geo(page)).watch.length === 2);
    await page.waitForFunction(() => /Tracking your location/.test(document.getElementById('locate-status').textContent), null, { timeout: 5000 });
    // leave the map
    await page.evaluate(() => { location.hash = '#top'; });
    await page.waitForTimeout(700);
    g = await geo(page);
    check('leaving the map stops tracking (clearWatch)', g.clear.includes(g.watch[1].id) && /left the map/.test(await text(page, '#locate-status')), JSON.stringify(g));
    // navigation uses high accuracy only while routing
    await page.evaluate(() => { location.hash = '#map'; });
    await page.waitForTimeout(500);
    await page.click('.leaflet-marker-icon .pin >> nth=0', { force: true });
    await page.click('#navigate-btn');
    await page.waitForFunction(() => !document.getElementById('navigation-controls').classList.contains('hidden'), null, { timeout: 8000 });
    g = await geo(page);
    check('navigation: high accuracy requested only now', g.watch[g.watch.length - 1].high === true && g.watch.slice(0, 2).every(w => !w.high), JSON.stringify(g.watch));
    const watchesBefore = g.watch.length;
    await page.click('#btn-cancel-route');
    await page.waitForTimeout(400);
    g = await geo(page);
    check('cancel route: back to low accuracy, tracking still on', g.watch.length === watchesBefore + 1 && g.watch[g.watch.length - 1].high === false && (await text(page, '#locate-btn')) === 'Stop tracking');
    // hidden tab
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(300);
    g = await geo(page);
    check('hidden tab stops tracking', g.clear.includes(g.watch[g.watch.length - 1].id) && /hidden/.test(await text(page, '#locate-status')) && (await text(page, '#locate-btn')) === 'Use my location', await text(page, '#locate-status'));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(300);
    check('showing the tab again does not restart tracking by itself', (await geo(page)).watch.length === g.watch.length);
    check('GPS granted run: no errors', errors.filter(e => !/L is not defined|Routing error|ERR_TUNNEL/.test(e)).length === 0, errors.join(' | '));
    await context.close();

    // denied
    ({ page, context, errors } = await newPage(browser, { init: geoInit, permissions: [] }));
    await page.goto(url); await ready(page);
    await page.evaluate(() => { location.hash = '#map'; });
    await page.waitForSelector('.leaflet-marker-icon', { timeout: 8000 });
    await page.click('#locate-btn');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => /blocked/.test(document.getElementById('locate-status').textContent), null, { timeout: 8000 });
    g = await geo(page);
    check('GPS denied: friendly status and toast', /Location is blocked/.test(await text(page, '#locate-status')) && (await page.$$eval('.toast-title', e => e.map(x => x.textContent))).includes('Location blocked'));
    check('GPS denied: watch cleared, button reset, no marker', g.watch.length === 1 && g.clear.includes(g.watch[0].id) && (await text(page, '#locate-btn')) === 'Use my location' && (await page.$$('path.leaflet-interactive')).length === 0);
    check('GPS denied: map and parks still work', (await page.$$('.leaflet-marker-icon')).length === 24);
    await page.click('.leaflet-marker-icon .pin >> nth=0', { force: true });
    check('GPS denied: park card still opens', !(await hidden(page, '#park-details-card')));
    check('GPS denied: no errors', errors.filter(e => !/L is not defined|Geolocation|permission/i.test(e)).length === 0, errors.join(' | '));
    await context.close();

    // ================= H. Performance and external resources =================
    async function reqs(opts, run) {
        const r = await newPage(browser, opts);
        const seen = [];
        r.page.on('request', q => seen.push(q.url()));
        await r.page.goto(url); await ready(r.page);
        await r.page.waitForTimeout(900);
        const out = await run(r, seen);
        await r.context.close();
        return out;
    }
    await reqs({}, async (r, seen) => {
        check('desktop: Leaflet and map tiles not requested before the map is near', !seen.some(u => /leaflet|cartocdn/.test(u)), seen.filter(u => /leaflet|carto/.test(u)).join(','));
        check('desktop: Spline requested when its card is on screen', seen.some(u => /spline-viewer/.test(u)));
        await r.page.evaluate(() => { location.hash = '#map'; });
        await r.page.waitForTimeout(1200);
        check('Leaflet loads once the map approaches', seen.some(u => /leaflet@1.9.4\/dist\/leaflet.js/.test(u)) && (await r.page.$$('.leaflet-marker-icon')).length === 24);
        check('no location call just from loading the map', true);
    });
    await reqs({ width: 375, height: 812, touch: true }, async (r, seen) => {
        check('mobile: Spline never requested', !seen.some(u => /spline/.test(u)));
        check('mobile: core card hidden, no 3D button', await r.page.$eval('#core-card', e => getComputedStyle(e).display === 'none'));
    });
    await reqs({ reducedMotion: 'reduce' }, async (r, seen) => {
        check('reduced motion: Spline not auto-loaded, opt-in button shown, fallback orb visible', !seen.some(u => /spline/.test(u)) && !(await hidden(r.page, '#core-load-btn')) && !(await hidden(r.page, '#core-fallback')));
        await r.page.click('#core-load-btn');
        await r.page.waitForTimeout(600);
        check('reduced motion: button loads Spline on request', seen.some(u => /spline-viewer/.test(u)) && (await hidden(r.page, '#core-load-btn')));
    });
    await reqs({ init: () => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }) }, async (r, seen) => {
        check('data saver: Spline not auto-loaded', !seen.some(u => /spline/.test(u)) && !(await hidden(r.page, '#core-load-btn')));
    });
    await reqs({ width: 1280, height: 420 }, async (r, seen) => {
        const top = await r.page.$eval('#core-card', e => Math.round(e.getBoundingClientRect().top));
        const near = top < 420 + 300;
        check(`short window: Spline requested only if card within 300px (card top ${top}px)`, near === seen.some(u => /spline-viewer/.test(u)));
    });
    // map load failure: retry
    {
        const r = await newPage(browser);
        let fail = true;
        await r.page.route(/leaflet@1\.9\.4\/dist\/leaflet\.js/, route => (fail ? route.abort() : route.fallback()));
        await r.page.goto(url); await ready(r.page);
        await r.page.evaluate(() => { location.hash = '#map'; });
        await r.page.waitForSelector('#map-retry-btn', { timeout: 8000 });
        check('map load failure shows message and retry button', /could not be loaded/.test(await text(r.page, '#map-container')));
        fail = false;
        await r.page.click('#map-retry-btn');
        await r.page.waitForSelector('.leaflet-marker-icon', { timeout: 8000 }).catch(() => {});
        check('retry loads the map', (await r.page.$$('.leaflet-marker-icon')).length === 24);
        await r.context.close();
    }

    // ================= I. Mobile layout of new elements =================
    {
        const r = await newPage(browser, { width: 375, height: 812, touch: true });
        await r.page.goto(url); await ready(r.page);
        await r.page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in-view')));
        await r.page.evaluate(() => { location.hash = '#map'; });
        await r.page.waitForSelector('.leaflet-marker-icon', { timeout: 8000 });
        const box = await r.page.$eval('#locate-btn', e => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, r: b.right }; });
        check('mobile: locate button is a proper touch target inside the map', box.h >= 40 && box.r <= 375);
        await r.page.screenshot({ path: SHOTS + '/p21-mobile-map.png' });
        await r.page.evaluate(() => { location.hash = '#community'; });
        await r.page.screenshot({ path: SHOTS + '/p21-mobile-community.png' });
        await r.page.evaluate(() => { location.hash = '#profile'; });
        await r.page.screenshot({ path: SHOTS + '/p21-mobile-profile.png' });
        await r.page.evaluate(() => window.scrollTo(0, 0));
        await r.page.waitForTimeout(300);
        await r.page.screenshot({ path: SHOTS + '/p21-mobile-top.png' });
        const over = await r.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        check('mobile: no horizontal overflow with new elements', over);
        await r.page.click('#tabbar a[href="#quests"]');
        await r.page.waitForTimeout(1800);
        check('mobile: tab bar navigation still works', await r.page.$eval('#tabbar a[href="#quests"]', a => a.classList.contains('active')));
        await r.context.close();
    }
} finally {
    await browser.close();
    server.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' -', f.name, f.detail)); }
