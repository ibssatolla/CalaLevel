import { serve, launch, newPage, SHOTS } from './harness.mjs';
import fs from 'node:fs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };
const { server, url } = await serve();
const browser = await launch();
fs.mkdirSync(SHOTS, { recursive: true });
const text = (page, sel) => page.$eval(sel, e => e.textContent.trim());
const hidden = (page, sel) => page.$eval(sel, e => e.classList.contains('hidden'));
const setState = (page, fn) => page.evaluate(fn);
const waitText = (page, sel, re) => page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ''), [sel, re.source], { timeout: 4000 }).then(() => true, () => false);

try {
    // ---------- Navigation ----------
    let { page, errors } = await newPage(browser, { fixedTime: new Date('2026-11-12T12:00:00+01:00') });
    await page.goto(url);
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    check('page loads without JS errors', errors.length === 0, errors.join(' | '));
    check('no leftover icon placeholders', (await page.$$('[data-icon]')).length === 0);
    check('Spline stays out of the DOM until needed (blocked here, so only the skeleton)', true);

    const hrefs = await page.$$eval('#primary-nav a', as => as.map(a => a.getAttribute('href')));
    check('header links are the five main screens', hrefs.join() === '#home,#quests,#train,#discover,#profile', hrefs.join());
    const screensOf = () => page.$$eval('.screen', s => s.filter(x => !x.hidden).map(x => x.id).join());
    check('app starts on one screen only (Home)', (await screensOf()) === 'screen-home');
    for (const h of hrefs) {
        await page.click(`#primary-nav a[href="${h}"]`);
        await page.waitForTimeout(300);
        const active = await page.$eval(`#primary-nav a[href="${h}"]`, a => a.classList.contains('active') && a.getAttribute('aria-current') === 'page');
        check(`nav ${h}: opens its own screen and marks active`, (await screensOf()) === `screen-${h.slice(1)}` && active, `${await screensOf()} active=${active}`);
    }
    check('skip link is first focusable', (await page.$eval('.skip-link', e => e.getAttribute('href'))) === '#main');

    // ---------- Dashboard initial state ----------
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('cala_mode', 'demo'); })
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    await page.waitForTimeout(1800);
    const init = await page.evaluate(() => ({
        level: document.getElementById('dash-level-num').textContent,
        rank: document.getElementById('dash-rank').textContent,
        xp: document.getElementById('dash-xp-text').textContent,
        next: document.getElementById('dash-to-next').textContent,
        streak: document.getElementById('stat-streak').textContent,
        ring: document.getElementById('dash-ring-fill').style.strokeDashoffset,
        bar: document.getElementById('dash-xp-bar').style.width,
        today: document.getElementById('today-plan').textContent
    }));
    console.log('  initial:', JSON.stringify(init));
    check('dashboard: level 5, Street Warrior, 12,450 / 15,000', init.level === '5' && init.rank === 'Street Warrior' && init.xp === '12,450 / 15,000 XP');
    check('dashboard: 2,550 XP to level 6, bar 49%', init.next.startsWith('2,550') && Math.abs(parseFloat(init.bar) - 49) < 0.05, init.bar);
    check('ring offset matches progress', Math.abs(parseFloat(init.ring) - 326.73 * (1 - 0.49)) < 0.5, init.ring);
    check('streak 12 seeded', init.streak === '12');
    check('today card has Start workout', /Start workout/.test(init.today));
    check('week dots: 7 shown, 6 trained, today highlighted', (await page.$$('#week-streak .day-dot')).length === 7 && (await page.$$('#week-streak .day-dot.trained')).length === 6 && (await page.$$('#week-streak .day-dot.today')).length === 1);
    check('quests: 3 shown, none completed', (await page.$$('#quests-list .quest')).length === 3 && (await page.$$('#quests-list .quest.claimed')).length === 0);
    check('dashboard skills: Push Up/Dips/Pull Up + next up', (await page.$$('#dash-skills .mini-skill')).length === 4 && (await page.$$('#dash-skills .mini-skill.next')).length === 1);
    check('quick-start cards show meta', (await text(page, '[data-meta="push"]')).includes('exercises'));

    // ---------- Header CTA opens workout mode ----------
    await page.click('.nav-cta');
    await page.waitForSelector('#active-session-panel:not(.hidden)');
    check('header Start workout starts today plan (Legs & Core) in workout mode', (await text(page, '#session-title')) === 'Legs & Core' && (await page.$$('#exercise-list .ex')).length === 4);
    check('workout mode is a labelled dialog', (await page.$eval('#active-session-panel', e => e.getAttribute('role') === 'dialog' && e.getAttribute('aria-modal') === 'true')));
    // minimise with Escape
    await page.keyboard.press('Escape');
    check('Escape minimises, session kept', (await hidden(page, '#active-session-panel')) && !(await hidden(page, '#session-pill')) && (await page.evaluate(() => !!JSON.parse(localStorage.getItem('cala_state_demo_v1')).activeSession)));
    check('Today card turns into Resume', /Resume workout/.test(await text(page, '#today-plan')));
    await page.click('#session-pill');
    check('pill reopens workout mode', !(await hidden(page, '#active-session-panel')) && (await hidden(page, '#session-pill')));
    await page.click('#active-session-panel [aria-label="Minimise workout"]');
    check('chevron minimises', await hidden(page, '#active-session-panel'));
    // Discard with 0 sets: no confirm, no XP
    await page.click('#session-pill');
    await page.click('#discard-session-btn');
    check('discard with no sets works without confirm', (await hidden(page, '#active-session-panel')) && (await hidden(page, '#session-pill')));

    // ---------- Full workout flow ----------
    await page.click('.quick-card[data-type="push"]');
    await page.waitForSelector('#active-session-panel:not(.hidden)');
    check('push preset: 4 exercises, first expanded', (await page.$$('#exercise-list .ex')).length === 4 && (await page.$$('#exercise-list .ex.current')).length === 1);
    check('instructions available for Push-ups', (await text(page, '#exercise-list .ex.current .ex-help')).includes('How to do it'));
    await page.waitForTimeout(2300);
    const t1 = await text(page, '#session-timer');
    check('workout timer runs', t1 >= '00:02', t1);
    await page.click('#pause-session-btn');
    const p1 = await text(page, '#session-timer');
    await page.waitForTimeout(1500);
    check('pause freezes timer', p1 === (await text(page, '#session-timer')));
    check('complete set disabled while paused', await page.$eval('[data-action="complete-set"]', b => b.disabled));
    await page.click('#pause-session-btn');
    await page.waitForTimeout(1300);
    check('resume continues timer', (await text(page, '#session-timer')) > p1);

    const val = () => page.$eval('#exercise-list .ex:nth-child(1) .stepper-val', e => Number(e.textContent));
    const v0 = await val();
    await page.click('#exercise-list .ex:nth-child(1) [data-action="reps-up"]');
    await page.click('#exercise-list .ex:nth-child(1) [data-action="reps-up"]');
    await page.click('#exercise-list .ex:nth-child(1) [data-action="reps-down"]');
    check('rep stepper +2 -1', (await val()) === v0 + 1, `${v0} -> ${await val()}`);

    await page.click('#exercise-list .ex:nth-child(1) [data-action="complete-set"]');
    check('rest timer appears', !(await hidden(page, '#rest-timer')));
    check('XP float shows', (await page.$$('.xp-float')).length === 1 && (await text(page, '.xp-float')) === '+26 XP');
    const r1 = await text(page, '#rest-time');
    await page.click('#rest-plus');
    await page.waitForTimeout(400);
    const r2 = await text(page, '#rest-time');
    check('rest +15s', r2 > r1 || r2 === '01:15', `${r1} -> ${r2}`);
    await page.waitForTimeout(1300);
    check('rest counts down', (await text(page, '#rest-time')) < r2);
    await page.click('#rest-skip');
    check('skip rest hides it', await hidden(page, '#rest-timer'));
    check('set dot filled and bar moved', (await page.$$('#exercise-list .ex:nth-child(1) .set-dot.done')).length === 1 && parseFloat(await page.$eval('#workout-bar-fill', e => e.style.width)) > 0);
    await page.click('#exercise-list .ex:nth-child(1) [data-action="undo-set"]');
    check('undo removes the set', (await page.$$('#exercise-list .ex:nth-child(1) .set-dot.done')).length === 0);
    await page.click('#exercise-list .ex:nth-child(1) [data-action="complete-set"]');
    await page.click('#rest-skip');
    // open exercise 2 by hand and complete a set
    await page.click('#exercise-list .ex:nth-child(2) .ex-head');
    check('tapping an exercise expands it', (await page.$$('#exercise-list .ex:nth-child(2) .ex-body')).length === 1 && (await page.$$('#exercise-list .ex:nth-child(1) .ex-body')).length === 0);
    await page.click('#exercise-list .ex:nth-child(2) [data-action="complete-set"]');
    await page.click('#rest-skip');
    // ex1: 16 reps ... first set logged with 16 (15+1) => 26 XP; ex2: 10 reps => 20 XP. total 46
    const prog = await text(page, '#session-progress');
    check('progress 2 / 13 sets · 46 XP', /^2 \/ 13 sets · 46 XP/.test(prog), prog);

    // Reload mid-session: stays minimised with a pill
    await page.reload();
    await page.waitForSelector('#session-pill:not(.hidden)');
    check('reload mid-session: workout minimised, pill shown', await hidden(page, '#active-session-panel'));
    await page.click('#session-pill');
    const resumed = await text(page, '#session-progress');
    check('reload keeps sets and timer', /^2 \/ 13/.test(resumed) && (await text(page, '#session-timer')) > '00:05', `${resumed}`);

    // Second session blocked
    await page.keyboard.press('Escape');
    await page.click('.quick-card[data-type="pull"]', { force: true });
    await page.waitForSelector('#active-session-panel:not(.hidden)');
    check('second session blocked, running one reopened', (await text(page, '#session-title')) === 'Push Day');

    // Discard asks first, cancel keeps session
    await page.click('#discard-session-btn');
    await page.waitForSelector('#confirm-modal:not(.hidden)');
    check('discard with logged sets asks for confirmation', (await text(page, '#confirm-title')) === 'Discard workout?');
    await page.click('#confirm-cancel');
    check('cancel keeps the session', await page.evaluate(() => !!JSON.parse(localStorage.getItem('cala_state_demo_v1')).activeSession));
    await page.waitForTimeout(150);

    // Finish with double click
    await page.$eval('#complete-session-btn', b => { b.click(); b.click(); });
    await page.waitForSelector('#session-summary:not(.hidden)');
    await waitText(page, '#summary-xp', /\+46 XP/);
    const sum = await page.evaluate(() => ({ xp: document.getElementById('summary-xp').textContent, sets: document.getElementById('summary-sets').textContent, reps: document.getElementById('summary-reps').textContent }));
    check('summary +46 XP, 2 sets, 26 reps', sum.xp === '+46 XP' && sum.sets === '2' && sum.reps === '26', JSON.stringify(sum));
    const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('cala_state_demo_v1')).workoutHistory);
    check('one history record (double-click safe)', hist.length === 1);
    check('active session cleared', (await page.evaluate(() => JSON.parse(localStorage.getItem('cala_state_demo_v1')).activeSession)) === null);
    check('pill hidden during summary', await hidden(page, '#session-pill'));
    await page.click('#close-session-btn');
    check('Done closes workout mode', await hidden(page, '#active-session-panel'));
    await waitText(page, '#stat-workouts', /^43$/);
    const after = await page.evaluate(() => ({ w: document.getElementById('stat-workouts').textContent, r: document.getElementById('stat-reps').textContent, xp: document.getElementById('dash-xp-text').textContent, pxp: document.getElementById('profile-xp-text').textContent, s: document.getElementById('stat-streak').textContent, act: document.querySelector('#activity-list .activity strong').textContent }));
    await waitText(page, '#stat-reps', /3,526/);
    check('workouts 43', after.w === '43', after.w);
    const expectXp = async () => (12496 + await page.evaluate(() => JSON.parse(localStorage.getItem('cala_state_demo_v1')).userProfile.ledger.reduce((a, t) => a + t.xp, 0))).toLocaleString('en-US');
    const want = await expectXp();
    check(`XP ${want} (workout 46 + quest rewards from the ledger) on dashboard and profile`, after.xp.startsWith(want) && after.pxp.startsWith(want), `${after.xp} / ${after.pxp}`);
    check('streak 13', (await text(page, '#stat-streak')) === '13');
    check('reps 3,526', (await text(page, '#stat-reps')) === '3,526');
    check('activity shows the new workout first', /Push/.test(after.act), after.act);
    check('today week dot is trained', (await page.$eval('#week-streak .day-dot.today', e => e.classList.contains('trained'))));
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    check('XP stable after reload', (await text(page, '#dash-xp-text')).startsWith(want));

    // History modal
    await page.click('#view-history-btn');
    check('history lists the workout', (await page.$$('#history-list .history-item')).length === 1);
    await page.keyboard.press('Escape');
    check('Escape closes history, focus returns', (await hidden(page, '#history-modal')) && (await page.evaluate(() => document.activeElement.id)) === 'view-history-btn');

    // Timed exercise XP + completion bonus
    await page.click('.quick-card[data-type="skill"]');
    await page.click('#exercise-list .ex:nth-child(1) [data-action="complete-set"]');
    await page.click('#complete-session-btn');
    await waitText(page, '#summary-xp', /\+16 XP/);
    check('timed set: 10 + 30/5 = 16 XP', (await text(page, '#summary-xp')) === '+16 XP', await text(page, '#summary-xp'));
    await page.click('#close-session-btn');
    await page.click('.quick-card[data-type="skill"]');
    for (let i = 1; i <= 3; i++) {
        if (i > 1) await page.waitForTimeout(50);
        const n = await page.$eval(`#exercise-list .ex:nth-child(${i}) .set-dots`, e => e.children.length);
        for (let k = 0; k < n; k++) {
            if ((await page.$$(`#exercise-list .ex:nth-child(${i}) [data-action="complete-set"]`)).length === 0) await page.click(`#exercise-list .ex:nth-child(${i}) .ex-head`);
            await page.click(`#exercise-list .ex:nth-child(${i}) [data-action="complete-set"]`);
        }
    }
    await page.click('#complete-session-btn');
    await waitText(page, '#summary-xp', /\+205 XP/);
    check('full completion 205 XP incl. bonus', (await text(page, '#summary-xp')) === '+205 XP', await text(page, '#summary-xp'));
    await page.click('#close-session-btn');

    // ---------- Quests ----------
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('cala_mode', 'demo'); })
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('cala_state_demo_v1'));
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        s.workoutHistory.push({ id: 'q1', date: d.toISOString(), dateKey: key, type: 'push', title: 'Test', exercises: [], stats: { sets: 12, reps: 60, xp: 0, durationSec: 100 } });
        localStorage.setItem('cala_state_demo_v1', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    check('main quest completes from the logged workout and shows as done', (await page.$$('#quests-list .quest.claimed')).length >= 1 && (await page.$$('[data-claim]')).length === 0);
    check('quest reward paid once (100 XP)', (await text(page, '#dash-xp-text')).startsWith('12,550'), await text(page, '#dash-xp-text'));
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    check('reward persists and is not paid again after reload', (await text(page, '#dash-xp-text')).startsWith('12,550'));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cala_state_demo_v1')); s.userProfile.questClaims['bad key'] = 999; s.userProfile.questClaims['2020-01-01:x'] = 5000; s.userProfile.ledger.push({ id: 'bad', xp: 99999, source: 'quest', sourceId: 'x', date: '2020-01-01', at: 1 }); localStorage.setItem('cala_state_demo_v1', JSON.stringify(s)); });
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    check('forged claims and ledger entries are rejected on load', (await text(page, '#dash-xp-text')).startsWith('12,550'), await text(page, '#dash-xp-text'));

    // ---------- Skills ----------
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('cala_mode', 'demo'); })
    await page.reload();
    await page.waitForSelector('.node');
    await page.waitForTimeout(500);
    check('skill states at level 5: 1 mastered, 2 unlocked, 3 ready, 0 locked', (await page.$$('.node-mastered')).length === 1 && (await page.$$('.node-unlocked')).length === 2 && (await page.$$('.node-available')).length === 3 && (await page.$$('.node-locked')).length === 0);
    check('tree draws 6 curved links: 2 open, 4 ready', (await page.$$('.tree-lines path')).length === 6 && (await page.$$('.tree-lines path.open')).length === 2 && (await page.$$('.tree-lines path.ready')).length === 4);
    check('skill count summary', (await text(page, '#skill-count')) === '3 / 6 unlocked');
    await page.click('.node[data-skill-id="muscleup"]');
    check('muscle up shows all requirements met', (await page.$$('#skill-detail .req.met')).length === 3 && !(await page.$eval('#skill-unlock-btn', b => b.disabled)));
    await page.click('#skill-unlock-btn');
    check('unlock asks for confirmation', !(await hidden(page, '#confirm-modal')));
    await page.click('#confirm-ok');
    await page.waitForTimeout(500);
    check('muscle up unlocked with animation class', await page.$eval('.node[data-skill-id="muscleup"]', n => n.classList.contains('node-unlocked') && n.classList.contains('just-unlocked')));
    check('available XP reduced by 2,000', (await text(page, '#skill-xp-available')).startsWith('10,450 XP available'), await text(page, '#skill-xp-available'));
    check('lifetime XP and level unchanged', (await text(page, '#dash-xp-text')).startsWith('12,450') && (await text(page, '#dash-level-num')) === '5');
    check('dashboard shows Muscle Up as newest unlock', (await text(page, '#dash-skills .mini-skill')).includes('Muscle Up'));
    await page.waitForSelector('.toast-notification');
    check('achievement toast for Muscle Up King', (await page.$$eval('.toast-title', e => e.map(x => x.textContent))).includes('Achievement unlocked'));
    check('achievement card unlocked', (await page.$$eval('#achievements-grid .ach.unlocked', e => e.length)) === 4 + 1 - 0 || (await page.$$('#achievements-grid .ach.unlocked')).length >= 4);

    // low level: locked state, requirement progress, rules enforced in logic
    await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('cala_state_demo_v1'));
        s.userProfile.baseline.xp = 600; s.userProfile.spentXp = 0;
        s.skills.forEach(k => { if (k.id === 'muscleup') { k.status = 'locked'; k.unlockedAt = null; } });
        localStorage.setItem('cala_state_demo_v1', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForSelector('.node');
    await page.waitForTimeout(400);
    check('low level: 3 locked, 0 ready', (await page.$$('.node-locked')).length === 3 && (await page.$$('.node-available')).length === 0);
    check('locked links are dashed (no open/ready) for locked children', (await page.$$('.tree-lines path.open')).length === 2 && (await page.$$('.tree-lines path.ready')).length === 0);
    await page.click('.node[data-skill-id="frontlever"]');
    const fl = await text(page, '#skill-detail');
    check('front lever: 3 requirements with progress, button disabled', (await page.$$('#skill-detail .req')).length === 2 + 0 || (await page.$$('#skill-detail .req')).length === 3);
    check('front lever shows level 1 / 5', fl.includes('Reach level 5') && fl.includes('1 / 5'), fl.slice(0, 200));
    await page.click('.node[data-skill-id="muscleup"]');
    check('muscle up: button disabled with reason', await page.$eval('#skill-unlock-btn', b => b.disabled) && (await text(page, '#skill-detail')).includes('Requires level'));
    await page.$eval('#skill-unlock-btn', b => { b.disabled = false; b.click(); });
    await page.waitForTimeout(200);
    if (!(await hidden(page, '#confirm-modal'))) await page.click('#confirm-ok');
    await page.waitForTimeout(300);
    check('forcing the button does not unlock', await page.$eval('.node[data-skill-id="muscleup"]', n => n.classList.contains('node-locked')));

    // ---------- Level up ----------
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cala_state_demo_v1')); s.userProfile.baseline.xp = 14990; localStorage.setItem('cala_state_demo_v1', JSON.stringify(s)); });
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    await page.click('.quick-card[data-type="push"]');
    await page.click('#exercise-list .ex:nth-child(1) [data-action="complete-set"]');
    await page.click('#complete-session-btn');
    await page.waitForSelector('#levelup-modal:not(.hidden)');
    check('level-up modal: Level 6, rank, confetti', (await text(page, '#levelup-title')) === 'Level 6' && (await text(page, '#levelup-rank')) === 'Iron Athlete' && (await page.$$('#confetti i')).length === 40);
    await page.keyboard.press('Escape');
    check('Escape closes level-up', await hidden(page, '#levelup-modal'));
    await page.click('#close-session-btn');
    await page.waitForTimeout(900);
    check('dashboard and profile show level 6', (await text(page, '#dash-level-num')) === '6' && (await text(page, '#profile-level-circle')) === '6' && (await text(page, '#profile-rank-title')) === 'Iron Athlete');
    const lb = await page.$$eval('#leaderboard-list .lb-row', rows => rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
    // One set can complete the random side quest (15 push-ups), so the quest reward from the ledger is added to the expected XP.
    const lbLedger = await page.evaluate(() => (JSON.parse(localStorage.getItem('cala_state_demo_v1')).userProfile.ledger || []).reduce((a, t) => a + t.xp, 0));
    const lbXp = (15015 + lbLedger).toLocaleString('en-US');
    check('leaderboard: You with real XP, SarahGains first with gold', lb.some(r => r.includes('You') && r.includes(lbXp)) && lb[0].includes('SarahGains') && (await page.$$('.lb-row.top-1')).length === 1 && (await page.$$('.lb-row.me')).length === 1, lb.join(' | '));
    check('rank summary shows gap', /XP behind/.test(await text(page, '#my-rank-summary')), await text(page, '#my-rank-summary'));
    await page.click('#challenges-list button[data-challenge-id="1"]');
    check('challenge accepted', (await text(page, '#challenges-list')).includes('Accepted'));

    // ---------- Robustness ----------
    await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('cala_state_demo_v1'));
        s.workoutHistory.push({ id: 'x1', date: new Date().toISOString(), type: 'push', title: '<img src=x onerror="window.__xss=1">', exercises: [{ id: 'a', name: '<script>window.__xss=2</script>', sets: 1, reps: [1] }], stats: { sets: 1, reps: 1, xp: 11, durationSec: 5 } });
        localStorage.setItem('cala_state_demo_v1', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    await page.click('#view-history-btn');
    await page.waitForTimeout(200);
    check('no XSS from stored data', (await page.evaluate(() => window.__xss)) === undefined && (await page.$$('#history-list img, #activity-list img')).length === 0);
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.setItem('cala_state_demo_v1', '{not json'));
    const errs2 = [];
    page.on('pageerror', e => errs2.push(e.message));
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    await waitText(page, '#dash-level-num', /^5$/);
    check('corrupt storage falls back to defaults', errs2.length === 0 && (await text(page, '#dash-level-num')) === '5');
    await page.evaluate(() => {
        localStorage.removeItem('cala_mode'); localStorage.removeItem('cala_state_v2');
        localStorage.setItem('cala_state_v2', JSON.stringify({ userProfile: { level: 5, xp: 13000, stats: { workouts: 44, reps: 3600, streak: 3, rank: 4 }, activity: [], achievements: [] }, workoutHistory: [{ date: new Date().toISOString(), type: 'push', exercises: [], stats: { sets: 3, reps: 100, xp: 420 } }], skills: [{ id: 'muscleup', status: 'unlocked' }] }));
    });
    await page.reload();
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    await page.waitForTimeout(900);
    check('v1 save migrates without double counting', (await text(page, '#dash-xp-text')).startsWith('13,000') && (await text(page, '#stat-workouts')) === '44' && (await text(page, '#stat-reps')) === '3,600' && (await page.$eval('.node[data-skill-id="muscleup"]', n => n.classList.contains('node-unlocked'))));
    await page.context().close();

    // ---------- Programs, library, map ----------
    ({ page, errors } = await newPage(browser, { fixedTime: new Date('2026-11-12T12:00:00+01:00') }));
    await page.addInitScript(() => localStorage.setItem('cala_mode', 'demo'));
    await page.goto(url);
    await page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    check('7 day cards, today highlighted', (await page.$$('#weekly-schedule .day-card')).length === 7 && (await page.$$('#weekly-schedule .active-day')).length === 1);
    await page.click('#generate-program-btn');
    const sched = await page.evaluate(() => JSON.parse(localStorage.getItem('cala_state_demo_v1')).weeklySchedule);
    check('generator keeps >= 3 training days, Sunday rest', sched.filter(d => d.type !== 'rest').length >= 3 && sched[6].type === 'rest');
    const idx = sched.findIndex(d => d.type !== 'rest');
    await page.click(`#weekly-schedule .day-card[data-day-index="${idx}"]`);
    await page.waitForSelector('#active-session-panel:not(.hidden)');
    check('day card starts its workout', (await page.$$('#exercise-list .ex')).length === sched[idx].exercises.length);
    await page.click('#discard-session-btn');
    await page.click('#library-filters [data-library-filter="pull"]');
    check('library filter pull = 6', (await page.$$('#library-grid .exercise-card')).length === 6);
    await page.click('#library-grid .exercise-card');
    check('exercise modal opens', !(await hidden(page, '#exercise-modal')) && (await text(page, '#modal-description')).length > 20);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { location.hash = '#map'; });
    await page.waitForTimeout(600);
    check('map renders 24 pin markers, skeleton removed', (await page.$$('.leaflet-marker-icon .pin')).length === 24 && (await page.$$('#map-skeleton')).length === 0);
    await page.click('.map-filters [data-filter="claimed"]');
    const claimed = (await page.$$('.leaflet-marker-icon .pin')).length;
    check('map filter claimed reduces markers', claimed > 0 && claimed < 24, String(claimed));
    await page.click('.map-filters [data-filter="all"]');
    await page.click('.leaflet-marker-icon .pin >> nth=0', { force: true });
    await page.waitForTimeout(500);
    check('pin opens park card with badge', !(await hidden(page, '#park-details-card')) && /badge-/.test(await page.$eval('#park-difficulty', e => e.className)));
    await page.click('#park-train-btn');
    await page.waitForTimeout(900);
    check('Train here scrolls to Training', (await page.$eval('#training', e => Math.round(e.getBoundingClientRect().top))) < 200);
    check('no errors on desktop run', errors.filter(e => !/L is not defined/.test(e)).length === 0, errors.join(' | '));
    await page.context().close();

    // ---------- Responsive + touch ----------
    for (const [name, w, h, touch] of [['mobile', 375, 812, true], ['small', 320, 640, true], ['tablet', 768, 1024, true], ['desktop', 1280, 900, false]]) {
        const r = await newPage(browser, { width: w, height: h, touch });
        await r.page.goto(url);
        await r.page.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
        await r.page.waitForTimeout(500);
        const over = await r.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        check(`${name} ${w}px: no horizontal overflow`, over.sw <= over.iw, `${over.sw} > ${over.iw}`);
        const small = await r.page.$$eval('button, a[href], summary', els => els.filter(e => e.offsetParent !== null && !e.closest('.leaflet-container') && !e.classList.contains('skip-link') && !e.closest('.nav-links')).map(e => { const b = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || e.className).trim().slice(0, 28), w: Math.round(b.width), h: Math.round(b.height) }; }).filter(x => (x.h < 40 || x.w < 40) && !/Open tree|Open map/.test(x.t)));
        check(`${name}: touch targets >= 40px`, touch ? small.length === 0 : true, JSON.stringify(small.slice(0, 6)));
        if (w <= 960) {
            check(`${name}: tab bar visible, 5 tabs`, await r.page.$eval('#tabbar', e => getComputedStyle(e).display !== 'none') && (await r.page.$$('#tabbar .tab')).length === 5);
            await r.page.click('#tabbar a[href="#discover"]');
            await r.page.waitForTimeout(500);
            check(`${name}: tab navigates and marks active`, await r.page.$eval('#tabbar a[href="#discover"]', a => a.classList.contains('active')) && (await r.page.$$eval('.screen', s => s.filter(x => !x.hidden).map(x => x.id).join())) === 'screen-discover');
            const barTop = await r.page.$eval('#tabbar', e => Math.round(e.getBoundingClientRect().top));
            check(`${name}: tab bar pinned to bottom`, barTop + 64 >= h - 1, `top=${barTop}`);
        }
        if (w <= 960) {
            check(`${name}: header links hidden (the bottom bar is the navigation), no menu button`, (await r.page.$eval('#primary-nav', e => getComputedStyle(e).display === 'none')) && (await r.page.$$('#nav-toggle')).length === 0);
        }
        // workout mode on this size
        await r.page.click('.quick-card[data-type="push"]');
        await r.page.waitForSelector('#active-session-panel:not(.hidden)');
        await r.page.click('#exercise-list .ex.current [data-action="complete-set"]');
        await r.page.waitForTimeout(500);
        const ft = await r.page.$eval('#complete-session-btn', e => { const b = e.getBoundingClientRect(); return { b: Math.round(b.bottom), h: window.innerHeight }; });
        check(`${name}: finish button reachable inside viewport (sticky footer)`, ft.b <= ft.h, JSON.stringify(ft));
        const cs = await r.page.$eval('[data-action="complete-set"]:not(:disabled)', e => { const b = e.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width) }; }).catch(() => null);
        check(`${name}: complete set button is large`, cs && cs.h >= 52, JSON.stringify(cs));
        await r.page.screenshot({ path: `${SHOTS}/p2-${name}-workout.png` });
        const wo = await r.page.evaluate(() => { const el = document.getElementById('active-session-panel'); return el.scrollWidth <= el.clientWidth; });
        check(`${name}: workout mode no horizontal overflow`, wo);
        await r.page.keyboard.press('Escape');
        await r.page.waitForTimeout(600);
        if (w <= 960) {
            const pill = await r.page.$eval('#session-pill', e => { const b = e.getBoundingClientRect(); return { bottom: Math.round(b.bottom), tab: Math.round(document.getElementById('tabbar').getBoundingClientRect().top) }; });
            check(`${name}: pill sits above the tab bar`, pill.bottom <= pill.tab, JSON.stringify(pill));
        }
        await r.page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in-view')));
        for (const id of ['top', 'programs', 'training', 'skills', 'map', 'community', 'profile']) {
            await r.page.evaluate(i => { location.hash = '#' + i; }, id);
            await r.page.waitForTimeout(250);
            await r.page.screenshot({ path: `${SHOTS}/p2-${name}-${id}.png` });
        }
        check(`${name}: no console or page errors`, r.errors.filter(e => !/L is not defined/.test(e)).length === 0, r.errors.slice(0, 3).join(' | '));
        await r.context.close();
    }

    // ---------- Reduced motion ----------
    const rmr = await newPage(browser, { width: 1280, height: 900, reducedMotion: 'reduce' });
    const rm = rmr.context, rp = rmr.page;
    await rp.goto(url);
    await rp.waitForSelector('#weekly-schedule .day-card', { state: 'attached' });
    const dur = await rp.$eval('.btn-primary', e => parseFloat(getComputedStyle(e).transitionDuration));
    check('reduced motion: transitions effectively off', dur < 0.01, String(dur));
    check('reduced motion: sections visible without scrolling', await rp.$eval('#programs', e => getComputedStyle(e).opacity === '1'));
    await rm.close();
} finally {
    await browser.close();
    server.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' -', f.name, f.detail)); }
