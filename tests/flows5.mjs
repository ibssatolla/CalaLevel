// Phase 3.1 QA tests: migration from a save made by the real Phase 2.1 app, demo/live separation,
// character persistence, storage failures, failing external resources, listener growth, expired quests.
// The Phase 2.1 app is read from P21_ROOT (default: ../../phase2.1-backup next to the project). If it is
// missing, section A is reported as not executed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, newPage } from './harness.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + String(detail).slice(0, 300) : ''}`); };
const skipped = [];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P21 = process.env.P21_ROOT || path.resolve(HERE, '../../phase2.1-backup');
const { server, url } = await serve();
const browser = await launch();
const text = (page, sel) => page.$eval(sel, e => e.textContent.trim());
const hidden = (page, sel) => page.$eval(sel, e => e.classList.contains('hidden'));
const ls = (page, k = 'cala_state_v2') => page.evaluate(key => { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }, k);
const xpNumber = async page => Number((await text(page, '#dash-xp-text')).split('/')[0].replace(/,/g, ''));
const jsClick = async (page, sel) => { await page.$eval(sel, e => e.click()); if (/demo"\]/.test(sel)) { await page.waitForSelector('#confirm-modal:not(.hidden)'); await page.$eval('#confirm-ok', e => e.click()); } };
const ready = page => page.waitForSelector('#quest-board .quest-card', { state: 'attached' });
const settle = page => page.waitForTimeout(900);
const oneSet = async (page, type = 'push', finish = true) => {
    await page.click(`.quick-card[data-type="${type}"]`);
    await page.click('#exercise-list .ex.current [data-action="complete-set"]');
    if (finish) { await page.click('#complete-session-btn'); await page.waitForSelector('#session-summary:not(.hidden)'); }
};

try {
    // ================= A. Save made by the real Phase 2.1 app =================
    let snapshot = null, facts = null;
    if (fs.existsSync(path.join(P21, 'index.html'))) {
        const old = await serve(P21);
        const a = await newPage(browser, { width: 390, height: 844, touch: true, account: false });   // the old app knows nothing about accounts
        await a.page.goto(old.url); await a.page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' }); await a.page.waitForTimeout(600);
        // Give the user some progress first (3,000 XP before history started), then use the app normally.
        await a.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cala_state_v2')); s.userProfile.baseline = { ...s.userProfile.baseline, xp: 3000, workouts: 9, reps: 400 }; localStorage.setItem('cala_state_v2', JSON.stringify(s)); });
        await a.page.reload(); await a.page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' }); await a.page.waitForTimeout(500);
        await a.page.click('.quick-card[data-type="push"]');
        await a.page.click('#exercise-list .ex.current [data-action="complete-set"]');
        await a.page.click('#complete-session-btn'); await a.page.waitForSelector('#session-summary:not(.hidden)');
        await a.page.click('#close-session-btn'); await a.page.waitForTimeout(700);
        // Phase 2.1 keeps the other workout cards disabled after a workout ends, so a reload is needed there.
        await a.page.reload(); await a.page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' }); await a.page.waitForTimeout(500);
        const claim = await a.page.$('[data-claim]');
        if (claim) { await claim.click(); await a.page.waitForTimeout(300); }
        // Unlock Dips through the skill tree.
        await a.page.evaluate(() => { location.hash = '#skills'; });
        await a.page.click('.node[data-skill-id="dips"]');
        await a.page.click('#skill-unlock-btn'); await a.page.waitForTimeout(250);
        if (!(await hidden(a.page, '#confirm-modal'))) await a.page.click('#confirm-ok');
        await a.page.waitForTimeout(300);
        // Start a second workout and leave it unfinished with one completed set.
        await a.page.evaluate(() => window.scrollTo(0, 0));
        await a.page.click('.quick-card[data-type="pull"]');
        await a.page.click('#exercise-list .ex.current [data-action="complete-set"]');
        await a.page.keyboard.press('Escape'); await a.page.waitForTimeout(300);
        // Visit demo mode and come back, so both slots exist.
        await a.page.evaluate(() => { location.hash = '#profile'; });
        await jsClick(a.page, '[data-data-action="demo"]'); await a.page.waitForFunction(() => !document.getElementById('demo-banner').classList.contains('hidden'));
        await jsClick(a.page, '#exit-demo-btn'); await a.page.waitForFunction(() => document.getElementById('demo-banner').classList.contains('hidden'));
        await a.page.waitForTimeout(600);
        snapshot = await a.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
        const live = JSON.parse(snapshot.cala_state_v2);
        facts = {
            xp: await xpNumber(a.page), level: await text(a.page, '#dash-level-num'),
            history: live.workoutHistory.length, historyIds: live.workoutHistory.map(h => h.id || h.date).join(),
            skills: JSON.stringify(live.skills.map(s => [s.id, s.status])), spent: live.userProfile.spentXp,
            claims: JSON.stringify(live.userProfile.questClaims), ach: JSON.stringify(live.userProfile.achievements.map(x => [x.key, x.unlocked])),
            active: live.activeSession ? live.activeSession.exercises.flatMap(e => e.sets).filter(s => s.completed || s.done).length : null,
            demoKey: snapshot.cala_state_demo_v1 || null
        };
        await a.context.close(); old.server.close();
        check('2.1 save prepared by the real Phase 2.1 app (version 2, history, active session, demo slot)', live.version === 2 && facts.history === 1 && live.activeSession && facts.demoKey, JSON.stringify({ v: live.version, h: facts.history, act: !!live.activeSession, demo: !!facts.demoKey }));

        const seed = snapshot;
        const b = await newPage(browser, { width: 390, height: 844, touch: true, init: `(() => { try { if (localStorage.getItem('__qa_seeded')) return; const seed = ${JSON.stringify(seed)}; for (const k in seed) localStorage.setItem(k, seed[k]); localStorage.setItem('__qa_seeded', '1'); } catch (e) {} })()` });
        await b.page.goto(url); await ready(b.page); await settle(b.page);
        const after = await ls(b.page);
        const xpAfter = await xpNumber(b.page);
        check('migration (real 2.1 save): XP and level identical', xpAfter === facts.xp && (await text(b.page, '#dash-level-num')) === facts.level, `${facts.xp}/${facts.level} -> ${xpAfter}/${await text(b.page, '#dash-level-num')}`);
        check('migration (real 2.1 save): workouts kept', after.workoutHistory.length === facts.history && after.workoutHistory.map(h => h.id || h.date).join() === facts.historyIds);
        check('migration (real 2.1 save): skills and spent XP kept', JSON.stringify(after.skills.map(s => [s.id, s.status])) === facts.skills && after.userProfile.spentXp === facts.spent);
        check('migration (real 2.1 save): achievements kept', JSON.stringify(after.userProfile.achievements.map(x => [x.key, x.unlocked])) === facts.ach);
        check('migration (real 2.1 save): legacy quest claims kept and still counted in XP', JSON.stringify(after.userProfile.questClaims) === facts.claims);
        check('migration (real 2.1 save): active session kept and visible as a pill', !!after.activeSession && !(await hidden(b.page, '#session-pill')), JSON.stringify(after.activeSession && Object.keys(after.activeSession)));
        const bk = await b.page.evaluate(() => localStorage.getItem('cala_backup_before_v3_live'));
        check('migration (real 2.1 save): backup is the exact old save, written before upgrade', bk === seed.cala_state_v2);
        check('migration (real 2.1 save): version 3, character, quests, empty ledger', after.version === 3 && after.character && after.character.id && after.quests.items.length >= 3 && Array.isArray(after.userProfile.ledger) && after.userProfile.ledger.length === 0);
        check('migration (real 2.1 save): demo slot untouched until demo mode opens', (await b.page.evaluate(() => localStorage.getItem('cala_state_demo_v1'))) === facts.demoKey && (await b.page.evaluate(() => localStorage.getItem('cala_backup_before_v3_demo'))) === null);
        // Resume the old session and finish it.
        await b.page.click('#session-pill');
        await b.page.click('#complete-session-btn'); await b.page.waitForSelector('#session-summary:not(.hidden)');
        await b.page.click('#close-session-btn'); await b.page.waitForTimeout(800);
        const fin = await ls(b.page);
        check('resumed 2.1 session finishes: history +1, XP up, no second active session', fin.workoutHistory.length === facts.history + 1 && fin.activeSession === null && (await xpNumber(b.page)) > facts.xp, `${facts.xp} -> ${await xpNumber(b.page)}`);
        const ids = fin.userProfile.ledger.map(t => t.id);
        check('ledger: every entry unique and paid once', new Set(ids).size === ids.length && ids.every(i => /^quest:/.test(i)));
        const sumXp = fin.workoutHistory.reduce((s, h) => s + ((h.stats && h.stats.xp) || 0), 0) + fin.userProfile.baseline.xp + Object.values(fin.userProfile.questClaims).reduce((x, y) => x + y, 0) + fin.userProfile.ledger.reduce((x, t) => x + t.xp, 0);
        check('XP on screen = baseline + history + legacy claims + ledger', (await xpNumber(b.page)) === sumXp, `${await xpNumber(b.page)} vs ${sumXp}`);
        // Demo mode: upgrade happens in the demo slot only.
        const liveBefore = await b.page.evaluate(() => localStorage.getItem('cala_state_v2'));
        await b.page.evaluate(() => { location.hash = '#profile'; });
        await jsClick(b.page, '[data-data-action="demo"]'); await b.page.waitForFunction(() => !document.getElementById('demo-banner').classList.contains('hidden')); await b.page.waitForTimeout(700);
        const demo = await ls(b.page, 'cala_state_demo_v1');
        check('demo: slot upgraded to version 3 with its own character and quests, backup stored', demo.version === 3 && demo.character && demo.character.id !== fin.character.id && demo.quests.items.length >= 3 && (await b.page.evaluate(() => localStorage.getItem('cala_backup_before_v3_demo'))) === facts.demoKey);
        check('demo: live data not touched while in demo mode', (await b.page.evaluate(() => localStorage.getItem('cala_state_v2'))) === liveBefore);
        await jsClick(b.page, '#exit-demo-btn'); await b.page.waitForTimeout(600);
        check('back from demo: live XP and character unchanged', (await xpNumber(b.page)) === sumXp && (await ls(b.page)).character.id === fin.character.id);
        check('migration (real 2.1 save): no console errors', b.errors.length === 0, b.errors.join(' | '));
        await b.context.close();
    } else {
        skipped.push('Section A (migration from a save made by the real Phase 2.1 app): Phase 2.1 copy not found at ' + P21);
    }

    // ================= B. Character: unlocked items persist =================
    {
        const { page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true });
        await page.goto(url); await ready(page); await settle(page);
        await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cala_state_v2')); s.userProfile.baseline = { ...s.userProfile.baseline, xp: 20000, workouts: 12, reps: 2000 }; localStorage.setItem('cala_state_v2', JSON.stringify(s)); });
        await page.reload(); await ready(page); await settle(page);
        await page.evaluate(() => { location.hash = '#profile'; });
        // In an account these controls are replaced by Profile > Goals and preferences (flows9). Demo mode still uses them, so the card is shown here.
        await page.waitForSelector('#screen-profile:not([hidden])'); await page.waitForTimeout(200); await page.addStyleTag({ content: '#profile-setup-card.hidden { display: block !important; }' });
        const picks = ['avatar-bolt', 'frame-cyan', 'bg-dusk', 'bg-grid'];
        for (const id of picks) { await page.click(`[data-cosmetic="${id}"]`); await page.waitForTimeout(150); }
        await page.click('[data-focus="skill"]'); await page.waitForTimeout(150);
        await page.click('[data-equipment="bar"]'); await page.waitForTimeout(150);
        await page.click('[data-equipment="parallel"]'); await page.waitForTimeout(150);
        await page.click('#char-rename-btn'); await page.keyboard.type('QA Tester'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
        const before = (await ls(page)).character;
        check('character: avatar, frame and background selected', before.selected['avatar'] === 'avatar-bolt' && before.selected['frame'] === 'frame-cyan' && before.selected['background'] === 'bg-grid', JSON.stringify(before.selected));
        check('character: name, focus and equipment saved', before.name === 'QA Tester' && before.preferences.focus === 'skill' && before.preferences.equipment.includes('bar') && before.preferences.equipment.includes('parallel'), JSON.stringify(before.preferences) + before.name);
        await page.reload(); await ready(page); await settle(page);
        await page.evaluate(() => { location.hash = '#profile'; });
        await page.waitForSelector('#screen-profile:not([hidden])'); await page.waitForTimeout(200); await page.addStyleTag({ content: '#profile-setup-card.hidden { display: block !important; }' });
        const sel = await page.$$eval('.cos-item.selected', els => els.map(e => e.dataset.cosmetic));
        check('character: choices visible after refresh', ['avatar-bolt', 'frame-cyan', 'bg-grid'].every(i => sel.includes(i)) && (await text(page, '#char-name')) === 'QA Tester' && (await text(page, '#dash-name')) === 'QA Tester', sel.join());
        check('character: focus chip and equipment boxes restored', (await page.$eval('[data-focus="skill"]', e => e.classList.contains('active'))) && (await page.$eval('[data-equipment="bar"]', e => e.checked)) && (await page.$eval('[data-equipment="parallel"]', e => e.checked)));
        check('character page: no console errors', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // ================= C. Workout integration: pause, resume, attributes, history =================
    {
        const { page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true });
        await page.goto(url); await ready(page); await settle(page);
        const attrBefore = JSON.stringify((await ls(page)).character.attributeBase);
        await page.click('.quick-card[data-type="push"]');
        await page.click('#exercise-list .ex.current [data-action="complete-set"]');
        await page.click('#pause-session-btn'); await page.waitForTimeout(1300);
        const t1 = await text(page, '#session-timer');
        await page.waitForTimeout(1300);
        check('pause: timer stops', t1 === await text(page, '#session-timer') && (await page.$eval('#pause-session-btn', e => e.getAttribute('aria-pressed'))) === 'true', t1);
        await page.click('#pause-session-btn'); await page.waitForTimeout(1300);
        check('resume: timer runs again', t1 !== await text(page, '#session-timer'));
        await page.click('#exercise-list .ex.current [data-action="complete-set"]');
        await page.click('#exercise-list .ex.current [data-action="complete-set"]');
        await page.click('#complete-session-btn'); await page.waitForSelector('#session-summary:not(.hidden)');
        await page.click('#close-session-btn'); await page.waitForTimeout(800);
        check('after a workout ends, every workout type can be started again (no stale disabled cards)', (await page.$$eval('.quick-card', cs => cs.map(c => c.getAttribute('aria-disabled')))).every(v => v === 'false'));
        const st = await ls(page);
        const rec = st.workoutHistory[0];
        check('history: one verified record with sets, reps, duration and XP', st.workoutHistory.length === 1 && rec.stats && rec.stats.xp > 0 && rec.stats.sets >= 3 && rec.stats.reps > 0 && rec.stats.durationSec >= 2, JSON.stringify(rec).slice(0, 300));
        const ledgerXp = st.userProfile.ledger.reduce((a, t) => a + t.xp, 0);
        check('XP = workout XP + quest rewards (once)', (await xpNumber(page)) === rec.stats.xp + ledgerXp && ledgerXp >= 100, `${await xpNumber(page)} vs ${rec.stats.xp}+${ledgerXp}`);
        const prog = st.quests.items.filter(q => q.date === st.quests.lastCheckedKey).map(q => q.status + ':' + q.progress);
        check('quest progress updated from the workout', prog.some(p => p.startsWith('completed')), prog.join());
        await page.evaluate(() => { location.hash = '#profile'; });
        const strength = await page.$eval('#profile .attr-row, #profile [data-attr="strength"]', e => e.textContent).catch(() => '');
        check('attributes: strength has points after push sets', /Strength/.test(await page.$eval('#profile', e => e.textContent)) && !/Reps of push, pull and leg exercises\. No\s+points yet/.test((await page.$eval('#profile', e => e.textContent)).replace(/\s+/g, ' ')), strength.slice(0, 80) + attrBefore);
        check('workout integration: no console errors', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // ================= D. Storage failures =================
    for (const mode of ['setItem', 'getItem']) {
        const { page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true, init: `{ const orig = Storage.prototype.${mode}; Storage.prototype.${mode} = function (k, v) { if (/^cala_state/.test(k) && this === localStorage) throw new DOMException('blocked', '${mode === 'setItem' ? 'QuotaExceededError' : 'SecurityError'}'); return orig.call(this, k, v); }; }` });   // the app's own save slot fails; the sign-in session (another key) still works
        if (mode === 'getItem') {
            // The account is offline here and its saved copy cannot be read: nothing to show, so the app says so (and does not crash).
            await page.goto(url); await page.waitForSelector('#screen-connect-error:not([hidden])'); await settle(page);
            check('storage getItem throws while offline: the app shows the connection screen, not a broken app', (await page.$$eval('.screen', e => e.filter(x => !x.hidden).map(x => x.dataset.screen).join())) === 'connect-error' && (await page.$$('#quest-board .quest-card')).length === 0);
            check('storage getItem throws: no uncaught errors', errors.filter(e => /pageerror/.test(e)).length === 0, errors.join(' | '));
            await context.close(); continue;
        }
        await page.goto(url); await ready(page); await settle(page);
        check(`storage ${mode} throws: app loads, quests and character show`, (await page.$$('#quest-board .quest-card')).length === 3 && (await text(page, '#char-name')).length > 0);
        await oneSet(page);
        check(`storage ${mode} throws: workout finishes and the summary shows`, !(await hidden(page, '#session-summary')));
        check(`storage ${mode} throws: no uncaught errors`, errors.filter(e => /pageerror/.test(e)).length === 0, errors.join(' | '));
        await context.close();
    }

    // ================= E. External resources fail =================
    {
        const { page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true });
        await page.route(/unpkg\.com|fonts\.g|cartocdn|spline/, r => r.abort());
        await page.goto(url); await ready(page); await settle(page);
        await page.evaluate(() => { location.hash = '#map'; }); await page.waitForTimeout(1500);
        const mapText = await page.$eval('#map', e => e.innerText.replace(/\s+/g, ' ').slice(0, 220));
        check('external scripts, fonts and tiles blocked: quests, tabs and map section still render', (await page.$$('#quest-board .quest-card')).length === 3 && mapText.length > 20, mapText);
        await page.evaluate(() => { location.hash = '#profile'; });
        check('external resources blocked: profile and customize still render', (await page.$$('.cos-item')).length >= 15);
        await oneSet(page);
        check('external resources blocked: workout and reward still work', (await ls(page)).userProfile.ledger.length >= 1);
        check('external resources blocked: no uncaught page errors', errors.filter(e => /pageerror/.test(e)).length === 0, errors.join(' | '));
        await context.close();
    }

    // ================= F. Listeners and re-rendering =================
    {
        const init = `(() => { const live = new Map(); window.__ls = { n: () => live.size, list: () => [...live.keys()] }; const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener; const tn = t => t === document ? 'document' : t === window ? 'window' : t === document.body ? 'body' : t === document.documentElement ? 'html' : null; const cap = o => (typeof o === 'object' && o ? !!o.capture : !!o); const ids = new WeakMap(); let seq = 0; const fid = f => { if (!ids.has(f)) ids.set(f, ++seq); return ids.get(f); }; EventTarget.prototype.addEventListener = function (t, f, o) { const n = tn(this); if (n && f) live.set(n + ':' + t + ':' + fid(f) + ':' + cap(o) + ':' + (f.name || 'anon'), 1); return add.call(this, t, f, o); }; EventTarget.prototype.removeEventListener = function (t, f, o) { const n = tn(this); if (n && f) live.delete(n + ':' + t + ':' + fid(f) + ':' + cap(o) + ':' + (f.name || 'anon')); return rem.call(this, t, f, o); }; })()`;
        const { page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true, init });
        await page.goto(url); await ready(page); await settle(page);
        // Warm-up: visit every section once (the map starts lazily the first time it is visible).
        for (const sel of ['#quests', '#training', '#skills', '#map', '#community', '#profile', '#top']) { await page.evaluate(x => { location.hash = x; }, sel); await page.waitForTimeout(700); }
        const base = await page.evaluate(() => window.__ls.n()); const baseList = await page.evaluate(() => window.__ls.list());
        // Idle: no re-rendering of the quest board or dashboard.
        await page.evaluate(() => { window.__mut = 0; const o = new MutationObserver(m => { window.__mut += m.length; }); o.observe(document.getElementById('quest-board'), { subtree: true, childList: true, attributes: true, characterData: true }); o.observe(document.getElementById('dash-xp-text'), { subtree: true, childList: true, characterData: true }); });
        await page.waitForTimeout(3500);
        check('idle: no re-rendering of quest board or XP text in 3.5 s', (await page.evaluate(() => window.__mut)) === 0, await page.evaluate(() => window.__mut));
        for (let i = 0; i < 3; i++) { await oneSet(page, i % 2 ? 'pull' : 'push'); await page.click('#close-session-btn'); await page.waitForTimeout(500); }
        await page.evaluate(() => { location.hash = '#profile'; });
        await page.click('#char-rename-btn'); await page.keyboard.type('X' + Date.now() % 100); await page.keyboard.press('Enter');
        for (const s of ['#quests', '#skills', '#map', '#training', '#top']) { await page.evaluate(x => { location.hash = x; }, s); await page.waitForTimeout(150); }
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        const grown = (await page.evaluate(() => window.__ls.n())) - base; const added = (await page.evaluate(() => window.__ls.list())).filter(k => !baseList.includes(k));
        check('listeners on document/window do not grow with use (3 workouts, rename, navigation)', grown === 0, `base ${base}, grown ${grown}: ${added.join(' ; ')}`);
        check('listener test: no console errors', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // ================= G. Expired quests are never paid =================
    {
        const { page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true, timezoneId: 'Europe/Oslo' });
        await page.clock.install({ time: new Date('2026-06-10T21:50:00Z') });
        await page.goto(url); await ready(page); await page.clock.runFor(1500);
        const day1 = (await ls(page)).quests.lastCheckedKey;
        await page.clock.fastForward('00:20:00'); await page.clock.runFor(2000);
        await page.waitForFunction(() => document.getElementById('quest-board').children.length > 0);
        const s2 = await ls(page);
        const old = s2.quests.items.filter(q => q.date === day1);
        check('after midnight: yesterday\'s unfinished quests are expired, unpaid', old.length === 3 && old.every(q => q.status === 'expired' && q.rewardStatus === 'none'), old.map(q => q.status + '/' + q.rewardStatus).join());
        await oneSet(page);
        await page.clock.runFor(1500);
        const s3 = await ls(page);
        const paid = s3.userProfile.ledger.map(t => t.id);
        check('workout after midnight pays only today\'s quests', paid.length >= 1 && paid.every(id => !id.includes(day1)) && new Set(paid).size === paid.length, paid.join());
        check('yesterday\'s quests stay expired after the workout', s3.quests.items.filter(q => q.date === day1).every(q => q.status === 'expired'));
        check('no claim button exists anywhere (rewards are automatic)', (await page.$$('[data-claim], .claim-btn')).length === 0);
        check('day change: no console errors', errors.length === 0, errors.join(' | '));
        await context.close();
    }
} catch (e) {
    check('test run finished without a crash', false, e.stack);
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
skipped.forEach(s => console.log('NOT EXECUTED: ' + s));
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' - ' + f.name)); }
await browser.close(); server.close();
process.exit(failed.length ? 1 : 0);
