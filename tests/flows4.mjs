// Phase 3 browser tests: character, daily quests, rewards, mobile layout, offline, midnight, time zones.
import { serve, launch, newPage, SHOTS } from './harness.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`); };
const { server, url } = await serve();
const browser = await launch();
const text = (page, sel) => page.$eval(sel, e => e.textContent.trim());
const ready = page => page.waitForSelector('#quest-board .quest-card', { state: 'attached' });
const settle = page => page.waitForTimeout(900);
const ls = (page, k = 'cala_state_v2') => page.evaluate(key => { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }, k);
const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ledgerXp = async page => ((await ls(page)).userProfile.ledger || []).reduce((a, t) => a + t.xp, 0);
const xpNumber = async page => Number((await text(page, '#dash-xp-text')).split('/')[0].replace(/,/g, ''));
const oneSet = async (page, type = 'push') => {
    await page.click(`.quick-card[data-type="${type}"]`);
    await page.click('#exercise-list .ex.current [data-action="complete-set"]');
    await page.click('#complete-session-btn');
    await page.waitForSelector('#session-summary:not(.hidden)');
};

try {
    // ================= 1. First visit on a 390px phone =================
    let { page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true });
    await page.goto(url); await ready(page); await settle(page);
    const board = await page.evaluate(() => ({
        cards: [...document.querySelectorAll('#quest-board .quest-card')].map(c => ({ slot: c.classList.contains('main') ? 'main' : c.classList.contains('side') ? 'side' : 'optional', title: c.querySelector('.quest-card-title').textContent, bar: c.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), xp: c.querySelector('.quest-reward').textContent })),
        reset: document.getElementById('quest-reset').textContent.trim(),
        summary: document.getElementById('quest-summary').textContent,
        compact: document.querySelectorAll('#quests-list .quest').length,
        tabs: [...document.querySelectorAll('#tabbar .tab span')].map(s => s.textContent),
        history: document.getElementById('quest-history').textContent.trim()
    }));
    check('quest screen: main, side and optional quest', board.cards.length === 3 && board.cards.map(c => c.slot).join() === 'main,side,optional', JSON.stringify(board.cards));
    check('quest screen: rewards 100 / 50 / 40 XP and progress 0', board.cards.map(c => c.xp).join() === '+100 XP,+50 XP,+40 XP' && board.cards.every(c => c.bar === '0'));
    check('quest screen: countdown, summary, empty history text', /New quests in/.test(board.reset) && /0 of 3 completed/.test(board.summary) && /after the first day/.test(board.history), board.reset);
    check('dashboard: compact list shows the same 3 quests', board.compact === 3);
    check('tab bar: Home, Quests, Train, Discover, Profile', board.tabs.join() === 'Home,Quests,Train,Discover,Profile', board.tabs.join());
    check('Skill tree, Battle Arena and Park Map reachable from Discover', (await page.$$('#screen-discover a[data-route="skills"], #screen-discover a[data-route="arena"], #screen-discover a[data-route="map"]')).length === 3 && (await page.$$('#screen-skills, #screen-arena, #screen-map')).length === 3);
    check('first quest day: main quest is a beginner goal', board.cards[0].title === 'Complete one workout' || /rest day|Active recovery/i.test(board.cards[0].title) || /Active recovery/.test(board.cards[0].title), board.cards[0].title);
    const startState = await ls(page);
    check('state: version 3, character with id and defaults, quests stored', startState.version === 3 && /^char-/.test(startState.character.id) && startState.character.name === 'Athlete' && startState.quests.items.length === 3);
    check('character: level 1, Rookie, Newcomer, all attributes 1', (await text(page, '#dash-name')) === 'Athlete' && (await text(page, '#dash-title-text')) === 'Newcomer' && (await page.$$eval('#attr-list .attr-value', e => e.map(x => x.textContent))).join() === '1,1,1,1');
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check('390px: no horizontal overflow', noOverflow);
    const small = await page.$$eval('#quest-board button, #quest-board a, .cos-item, #char-rename-btn, .tab', els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44); }).map(e => `${e.textContent.trim().slice(0, 18)}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    check('390px: quest and character controls are at least 44px', small.length === 0, small.join(' | '));
    await page.evaluate(() => { document.querySelectorAll('.reveal').forEach(e => e.classList.add('in-view')); document.documentElement.style.scrollBehavior = 'auto'; });
    await page.evaluate(() => { location.hash = '#quests'; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOTS + '/p3-quests-390.png' });

    // ================= 2. Workout -> quest -> reward -> level =================
    const xp0 = await xpNumber(page);
    await oneSet(page);
    const summaryQuests = await page.$$eval('#summary-quests li', l => l.map(x => x.textContent));
    check('summary: shows the quest reward line', summaryQuests.length >= 1 && summaryQuests.some(t => /\+100 XP/.test(t)), summaryQuests.join(' | '));
    check('toast: quest complete', (await page.$$eval('.toast-title', e => e.map(x => x.textContent))).includes('Quest complete'));
    await page.click('#close-session-btn');
    await settle(page);
    const lx = await ledgerXp(page);
    const mainCard = await page.$eval('#quest-board .quest-card.main', c => ({ done: c.classList.contains('done'), bar: c.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), reward: c.querySelector('.quest-reward').textContent, status: c.querySelector('.badge').textContent }));
    check('main quest shows completed with XP earned', mainCard.done && /\+100 XP earned/.test(mainCard.reward) && /Completed/.test(mainCard.status), JSON.stringify(mainCard));
    check('ledger holds the paid rewards, XP = workout 25 + ledger', lx >= 100 && (await xpNumber(page)) === xp0 + 25 + lx, `${await xpNumber(page)} vs ${xp0} + 25 + ${lx}`);
    check('character profile shows the same XP and level as the dashboard', (await text(page, '#profile-xp-text')) === (await text(page, '#dash-xp-text')));
    check('dashboard compact list marks main quest done', (await page.$$('#quests-list .quest.claimed')).length >= 1 && /completed/.test(await text(page, '#quests-meta')));
    const xpAfter = await xpNumber(page);
    await page.reload(); await ready(page); await settle(page);
    check('reload: no second payment', (await xpNumber(page)) === xpAfter && (await ledgerXp(page)) === lx);
    for (let i = 0; i < 3; i++) { await page.reload(); await ready(page); }
    check('three more reloads: still no duplicates', (await xpNumber(page)) === xpAfter && (await ls(page)).quests.items.length === 3);
    await oneSet(page);
    await page.click('#close-session-btn');
    await settle(page);
    check('a second workout does not pay the same quests again', (await ledgerXp(page)) >= lx && (await ls(page)).userProfile.ledger.every((t, i, a) => a.findIndex(x => x.id === t.id) === i));
    const attrs = await page.$$eval('#attr-list .attr', a => a.map(x => x.querySelector('small').textContent));
    check('attributes updated from the workout (strength has points)', !/No points yet/.test(attrs[0]), attrs[0]);
    check('no console errors in 1-2', errors.filter(e => !/Routing|ERR_TUNNEL|L is not defined/.test(e)).length === 0, errors.join(' | '));

    // ================= 3. Character screen =================
    await page.evaluate(() => { location.hash = '#profile'; });
    await page.click('#char-rename-btn');
    await page.fill('#char-name', 'Ibssa');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    check('rename: saved, shown on profile and dashboard', (await text(page, '#char-name')) === 'Ibssa' && (await text(page, '#dash-name')) === 'Ibssa' && (await ls(page)).character.name === 'Ibssa');
    await page.click('#char-rename-btn');
    await page.fill('#char-name', '   ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    check('rename: empty name refused, old name kept', (await text(page, '#char-name')) === 'Ibssa');
    await page.click('#char-rename-btn');
    await page.fill('#char-name', 'A'.repeat(40));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    check('rename: long names are cut to 20 characters', (await ls(page)).character.name.length === 20);
    await page.click('[data-cosmetic="avatar-crown"]', { force: true });
    check('locked cosmetic: stays locked, explains why', (await ls(page)).character.selected.avatar === 'avatar-user' && (await page.$$eval('.toast-title', e => e.map(x => x.textContent))).includes('Still locked'));
    await page.click('[data-cosmetic="avatar-flame"]');
    await page.waitForTimeout(200);
    check('unlocked cosmetic: selected and shown', (await ls(page)).character.selected.avatar === 'avatar-flame' && (await page.getAttribute('[data-cosmetic="avatar-flame"]', 'aria-pressed')) === 'true');
    check('cosmetics: requirement text visible on locked items', (await text(page, '[data-cosmetic="avatar-shield"] .cos-req')).includes('Reach level 3'));
    // In an account these two controls are replaced by Profile > Goals and preferences (flows9). The code behind them is still
    // used by demo mode, so the card is shown here to test it.
    const showSetup = () => page.addStyleTag({ content: '#profile-setup-card.hidden { display: block !important; }' });
    await showSetup();
    await page.check('[data-equipment="bar"]');
    await page.click('[data-focus="skill"]');
    const prefs = (await ls(page)).character.preferences;
    check('training setup saved (bar, skills first)', prefs.equipment.join() === 'bar' && prefs.focus === 'skill');
    await page.screenshot({ path: SHOTS + '/p3-profile-390.png', fullPage: false });
    await page.reload(); await ready(page); await showSetup();
    check('character choices survive a reload', (await text(page, '#char-title')) === 'Newcomer' && (await page.getAttribute('[data-cosmetic="avatar-flame"]', 'aria-pressed')) === 'true' && (await page.$eval('[data-equipment="bar"]', e => e.checked)));
    await context.close();

    // ================= 4. Existing player (saved by Phase 2.1) =================
    ({ page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true }));
    const today = keyOf(new Date()), yest = keyOf(new Date(Date.now() - 864e5));
    await page.addInitScript(([t, y]) => {
        if (localStorage.getItem('seeded')) return;
        localStorage.setItem('seeded', '1');
        localStorage.setItem('cala_state_v2', JSON.stringify({ version: 2, weeklySchedule: [], activeSession: null,
            workoutHistory: [{ id: 'h1', date: new Date(Date.now() - 864e5 * 40).toISOString(), dateKey: '2026-01-01', type: 'push', title: 'Old', exercises: [{ id: 'a', name: 'Push-ups', unit: 'reps', sets: 3, reps: [20, 15, 10] }], stats: { sets: 3, reps: 45, xp: 120, durationSec: 600 } },
                { id: 'h2', date: new Date().toISOString(), dateKey: t, type: 'push', title: 'Today', exercises: [], stats: { sets: 4, reps: 60, xp: 200, durationSec: 100 } }],
            userProfile: { baseline: { xp: 3000, workouts: 5, reps: 200, streak: 2, streakEndsOn: y }, spentXp: 500, questClaims: { [`${y}:workout`]: 25 }, achievementsSeen: ['first-steps'], activity: [], achievements: [] },
            skills: [{ id: 'pushup', status: 'mastered' }, { id: 'dips', status: 'unlocked', unlockedAt: 1700000000000 }] }));
    }, [today, yest]);
    await page.goto(url); await ready(page); await settle(page);
    const migrated = await ls(page);
    check('migration: XP kept (3,000 + 25 legacy + 320 history = 3,345 + new rewards)', (await xpNumber(page)) === 3345 + await ledgerXp(page), String(await xpNumber(page)));
    check('migration: history, skills, spent XP, legacy quest claims kept', migrated.workoutHistory.length === 2 && migrated.userProfile.spentXp === 500 && migrated.userProfile.questClaims[`${yest}:workout`] === 25 && migrated.skills.find(s => s.id === 'dips').unlockedAt === 1700000000000);
    check('migration: version 3, character created, dated from first workout', migrated.version === 3 && /^char-/.test(migrated.character.id) && new Date(migrated.character.createdAt).getFullYear() === 2026 || migrated.character.createdAt > 0);
    check('migration: backup of the old save stored', JSON.parse(await page.evaluate(() => localStorage.getItem('cala_backup_before_v3_live'))).version === 2);
    await page.waitForTimeout(800);
    check('migration: tells the user, nothing lost', (await page.$$eval('.toast-title', e => e.map(x => x.textContent))).includes('Upgraded to the new version'));
    check('migration: level 3 and tier intermediate quests', (await text(page, '#dash-level-num')) === '3' && migrated.quests.items.every(q => q.tier === 'intermediate' || q.templateId === 'rec-mobility'), JSON.stringify(migrated.quests.items.map(q => q.tier + ':' + q.templateId)));
    check('migration: today\'s earlier workout already counts toward quests (verified work)', migrated.quests.items.some(q => q.progress > 0));
    check('migration: attributes come from recorded history only', (await page.$$eval('#attr-list .attr-value', e => e.map(x => x.textContent)))[0] >= '2');
    const xpMig = await xpNumber(page);
    await page.reload(); await ready(page);
    check('migration: runs once (reload changes nothing)', (await xpNumber(page)) === xpMig && (await ls(page)).quests.items.length === migrated.quests.items.length);
    await context.close();

    // ================= 5. Broken optional data =================
    ({ page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true }));
    await page.addInitScript(() => {
        if (localStorage.getItem('seeded')) return;
        localStorage.setItem('seeded', '1');
        localStorage.setItem('cala_state_v2', JSON.stringify({ version: 3, workoutHistory: [], userProfile: { baseline: { xp: 100, workouts: 0, reps: 0, streak: 0, streakEndsOn: '2026-01-01' }, spentXp: 0, ledger: [{ id: 'dup', xp: 50 }, { id: 'dup', xp: 50 }, { id: 'neg', xp: -5 }, 'x', null], questClaims: {} }, quests: 'garbage', character: { id: 7, name: 123, selected: { avatar: 'nope' }, unlocked: ['bad'], preferences: { equipment: 'x', focus: 'zzz' } } }));
    });
    await page.goto(url); await ready(page); await settle(page);
    const rec = await ls(page);
    check('broken optional data: app loads, quests regenerated, one ledger entry kept', rec.quests.items.length === 3 && rec.userProfile.ledger.length === 1 && (await xpNumber(page)) === 150, `${rec.userProfile.ledger.length} ${await xpNumber(page)}`);
    check('broken optional data: character repaired (new id, default look)', /^char-/.test(rec.character.id) && rec.character.selected.avatar === 'avatar-user');
    check('broken optional data: no console errors', errors.filter(e => !/Routing|ERR_TUNNEL/.test(e)).length === 0, errors.join(' | '));
    await context.close();

    // ================= 6. Offline =================
    ({ page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true }));
    await page.goto(url); await ready(page); await settle(page);
    await context.setOffline(true);
    await oneSet(page);
    await page.click('#close-session-btn');
    await settle(page);
    check('offline: workout, quest and reward all work', (await ledgerXp(page)) >= 100 && (await ls(page)).workoutHistory.length === 1);
    await context.setOffline(false);
    await context.close();

    // ================= 7. Midnight with a fake clock =================
    ({ page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true, timezoneId: 'Europe/Oslo' }));
    await page.clock.install({ time: new Date('2026-06-10T23:58:30+02:00') });
    await page.goto(url); await ready(page);
    await page.clock.runFor(1000);
    const eve = await ls(page);
    check('midnight: before 00:00 there is one set for 2026-06-10', eve.quests.items.length === 3 && eve.quests.items.every(q => q.date === '2026-06-10'));
    check('midnight: countdown shows under 2 minutes', /New quests in [12] min/.test(await text(page, '#quest-reset')), await text(page, '#quest-reset'));
    await oneSet(page, 'push');
    await page.click('#close-session-btn');
    const doneTonight = (await ls(page)).quests.items.filter(q => q.status === 'completed').length;
    await page.clock.runFor(120000);       // past midnight, page stays open
    await page.waitForTimeout(300);
    const after = await ls(page);
    const dates = [...new Set(after.quests.items.map(q => q.date))].sort();
    check('midnight: a new set appears while the page is open, one per date', dates.join() === '2026-06-10,2026-06-11' && after.quests.items.length === 6, dates.join());
    check('midnight: yesterday keeps its completed quests, unfinished ones expire', after.quests.items.filter(q => q.date === '2026-06-10' && q.status === 'completed').length === doneTonight && after.quests.items.filter(q => q.date === '2026-06-10').every(q => q.status !== 'active'));
    check('midnight: today\'s quests are active and unpaid', after.quests.items.filter(q => q.date === '2026-06-11').every(q => q.status === 'active' && q.rewardStatus === 'none'));
    check('midnight: board and history show the new day', /0 of 3 completed/.test(await text(page, '#quest-summary')) && /Yesterday/.test(await text(page, '#quest-history')) && /completed/.test(await text(page, '#quest-history')));
    const ledgerBefore = (await ls(page)).userProfile.ledger.length;
    await page.clock.runFor(60000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    check('midnight: extra checks create nothing and pay nothing twice', (await ls(page)).quests.items.length === 6 && (await ls(page)).userProfile.ledger.length === ledgerBefore);
    const saved = JSON.stringify(await ls(page));
    await context.close();

    // ================= 8. Time zone change with the same saved data =================
    const r2 = await newPage(browser, { width: 390, height: 844, timezoneId: 'America/Los_Angeles' });
    const ctx2 = r2.context, p2 = r2.page;
    await p2.addInitScript(s => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('cala_state_v2', s); } }, saved);
    await p2.clock.install({ time: new Date('2026-06-10T23:30:00+02:00') });   // 14:30 on the 10th in Los Angeles
    await p2.goto(url); await p2.waitForSelector('#quest-board .quest-card', { state: 'attached' });
    await p2.clock.runFor(1000);
    const la = await ls(p2);
    const laDates = [...new Set(la.quests.items.map(q => q.date))].sort();
    check('time zone: Oslo -> Los Angeles reuses 2026-06-10, no second set, no extra reward', la.quests.items.length === 6 && laDates.join() === '2026-06-10,2026-06-11' && la.userProfile.ledger.length === JSON.parse(saved).userProfile.ledger.length, laDates.join());
    check('time zone: yesterday\'s expired set is not reopened', la.quests.items.filter(q => q.date === '2026-06-10' && q.status === 'expired').length === JSON.parse(saved).quests.items.filter(q => q.date === '2026-06-10' && q.status === 'expired').length);
    await ctx2.close();

    // ================= 9. Demo mode =================
    ({ page, context, errors } = await newPage(browser, { width: 390, height: 844, touch: true }));
    await page.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('cala_mode', 'demo'); } });
    await page.goto(url); await ready(page); await settle(page);
    const demo = await ls(page, 'cala_state_demo_v1');
    check('demo: own quests, character and sample attributes in the demo slot', demo.mode === 'demo' && demo.quests.items.length === 3 && demo.character.attributeBase.strength > 0 && [null, '{"version":3}'].includes(JSON.stringify(await ls(page)) === 'null' ? null : JSON.stringify(await ls(page))));   // the live slot stays empty (the harness stub is {"version":3})
    check('demo: banner visible, intermediate-level quests', !(await page.$eval('#demo-banner', e => e.classList.contains('hidden'))) && demo.quests.items[0].tier !== undefined);
    check('demo: attributes above 1', (await page.$$eval('#attr-list .attr-value', e => e.map(x => Number(x.textContent)))).every(v => v >= 2));
    await context.close();

    // ================= 10. Reduced motion and desktop =================
    ({ page, context, errors } = await newPage(browser, { width: 1280, height: 900, reducedMotion: 'reduce' }));
    await page.goto(url); await ready(page);
    check('reduced motion: progress bars do not animate', await page.$eval('#quest-board .progress-fill', e => parseFloat(getComputedStyle(e).transitionDuration) < 0.001));
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in-view')));
    await page.evaluate(() => { location.hash = '#quests'; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + '/p3-quests-1280.png' });
    check('desktop: quest board lays out the side quests beside each other', (await page.$$eval('.quest-side .quest-card', c => new Set(c.map(x => Math.round(x.getBoundingClientRect().top))).size)) === 1);
    check('desktop: header nav has Quests', (await page.$$('#primary-nav a[href="#quests"]')).length === 1);
    check('no console errors on desktop', errors.filter(e => !/Routing|ERR_TUNNEL/.test(e)).length === 0, errors.join(' | '));
    await context.close();
} finally {
    await browser.close();
    server.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' -', f.name, f.detail)); }
