// Phase 3.2 navigation tests. CalaLevel is a set of screens, not one long page.
// Main screens: home, quests, train, discover, profile. Secondary: skills, arena, map (under Discover), library (under Train).
import { serve, launch, newPage } from './harness.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + String(detail).slice(0, 300) : ''}`); };
const skipped = [];
const { server, url } = await serve();
const browser = await launch();
const MAIN = ['home', 'quests', 'train', 'discover', 'profile'];
const ALL = ['home', 'quests', 'train', 'discover', 'profile', 'skills', 'arena', 'map', 'library'];
const visible = page => page.$$eval('.screen', s => s.filter(x => !x.hidden).map(x => x.dataset.screen).join());
const hash = page => page.evaluate(() => location.hash);
const tab = (page, t) => page.click(`#tabbar a[data-tab="${t}"]`);
const settle = (page, ms = 350) => page.waitForTimeout(ms);
const scrollY = page => page.evaluate(() => Math.round(window.scrollY));
const boot = async (opts = {}, path = '') => {
    const r = await newPage(browser, { width: 390, height: 844, touch: true, ...opts });
    await r.page.goto(url + path); await r.page.waitForSelector('#quest-board .quest-card', { state: 'attached' }); await r.page.waitForTimeout(700);
    return r;
};

try {
    // ================= 1. Structure: one screen at a time, fixed bottom bar =================
    let { page, context, errors } = await boot();
    check('starts on Home and shows exactly one screen', (await visible(page)) === 'home' && (await hash(page)) === '#home');
    check('screens that are not open take no space (Profile cannot be reached by scrolling Home)', await page.evaluate(() => document.getElementById('profile').getBoundingClientRect().height === 0 && document.getElementById('quests').getBoundingClientRect().height === 0));
    check('bottom bar: Home, Quests, Train, Discover, Profile', (await page.$$eval('#tabbar .tab span', s => s.map(x => x.textContent).join())) === 'Home,Quests,Train,Discover,Profile');
    check('bottom bar is position: fixed', await page.$eval('#tabbar', e => getComputedStyle(e).position === 'fixed'));
    const barBottom = () => page.$eval('#tabbar', e => Math.round(e.getBoundingClientRect().bottom));
    check('bottom bar sits on the bottom edge at the top of the page', (await barBottom(page)) === 844);
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' })); await settle(page, 150);
    check('bottom bar stays on the bottom edge after scrolling Home', (await barBottom(page)) === 844 && (await scrollY(page)) > 400);

    // ================= 2. Each tab opens its own screen =================
    const docHeightHome = await page.evaluate(() => document.documentElement.scrollHeight);
    for (const t of MAIN.slice(1)) {
        await tab(page, t); await settle(page);
        const info = await page.evaluate(() => ({
            active: [...document.querySelectorAll('#tabbar .tab.active')].map(a => a.dataset.tab).join(),
            cur: [...document.querySelectorAll('#tabbar .tab[aria-current="page"]')].map(a => a.dataset.tab).join(),
            title: document.title, focus: document.activeElement && document.activeElement.tagName, ann: document.getElementById('screen-announcer').textContent
        }));
        check(`tab ${t}: only its screen is open, URL and tab state follow`, (await visible(page)) === t && (await hash(page)) === `#${t}` && info.active === t && info.cur === t, JSON.stringify(info));
        check(`tab ${t}: starts at the top, title and announcement set, focus on the heading`, (await scrollY(page)) === 0 && info.title.startsWith(t === 'discover' ? 'Discover' : t === 'train' ? 'Train' : t === 'quests' ? 'Quests' : 'Profile') && info.ann.length > 0 && /^H[12]$/.test(info.focus), JSON.stringify(info));
    }
    const heights = {};
    for (const t of MAIN) { await tab(page, t); await settle(page, 200); heights[t] = await page.evaluate(() => document.documentElement.scrollHeight); }
    check('page height is that of one screen, not all of them stacked', heights.profile < heights.home + heights.profile - 800 && Object.values(heights).every(h => h < 9000), JSON.stringify(heights));
    check('Profile is one tap from Home (no scrolling through the dashboard)', await (async () => { await tab(page, 'home'); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await tab(page, 'profile'); await settle(page); return (await visible(page)) === 'profile' && (await page.$eval('#char-name', e => { const r = e.getBoundingClientRect(); return r.top > 0 && r.top < 600; })); })());

    // ================= 3. Scroll position is kept per screen =================
    await tab(page, 'home'); await settle(page);
    await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' })); await settle(page, 150);
    await tab(page, 'quests'); await settle(page);
    check('new screen starts at its own top', (await scrollY(page)) === 0);
    await page.evaluate(() => window.scrollTo({ top: 220, behavior: 'instant' })); await settle(page, 150);
    await tab(page, 'home'); await settle(page);
    const homeBack = await scrollY(page);
    await tab(page, 'quests'); await settle(page);
    const questsBack = await scrollY(page);
    check('Home keeps its scroll position (700) when you come back', Math.abs(homeBack - 700) <= 2, homeBack);
    check('Quests keeps its own scroll position (220)', Math.abs(questsBack - 220) <= 2, questsBack);

    // ================= 4. Secondary screens and back navigation =================
    await tab(page, 'discover'); await settle(page);
    await page.click('#screen-discover a[data-route="skills"]'); await settle(page, 450);
    const sec = await page.evaluate(() => ({ back: !document.getElementById('nav-back').classList.contains('hidden'), title: document.getElementById('nav-title').textContent, logo: getComputedStyle(document.querySelector('.logo')).display, tab: document.querySelector('#tabbar .tab.active').dataset.tab, label: document.getElementById('nav-back').getAttribute('aria-label') }));
    check('Skill tree opens as a secondary screen: back button, title, Discover stays active', (await visible(page)) === 'skills' && sec.back && sec.title === 'Skill tree' && sec.tab === 'discover' && sec.logo === 'none' && /Back to Discover/.test(sec.label), JSON.stringify(sec));
    check('bottom bar stays visible and fixed on a secondary screen', (await barBottom(page)) === 844 && await page.$eval('#tabbar', e => getComputedStyle(e).display !== 'none'));
    check('back button is a real 44 px tap target', await page.$eval('#nav-back', e => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }));
    await page.click('#nav-back'); await settle(page, 450);
    check('back button returns to Discover and hides itself', (await visible(page)) === 'discover' && (await page.$eval('#nav-back', e => e.classList.contains('hidden'))));
    await page.click('#screen-discover a[data-route="map"]'); await settle(page, 450);
    await page.goBack(); await settle(page, 450);
    check('browser back (phone back gesture) does the same', (await visible(page)) === 'discover' && (await hash(page)) === '#discover');
    await page.goForward(); await settle(page, 450);
    check('browser forward reopens the Park map', (await visible(page)) === 'map');
    await page.goBack(); await settle(page, 300);

    await tab(page, 'home'); await settle(page);
    await page.click('#screen-home a[href="#skills"]'); await settle(page, 450);
    check('link from Home to the Skill tree opens it', (await visible(page)) === 'skills' && (await page.$eval('#tabbar .tab.active', a => a.dataset.tab)) === 'discover');
    await page.click('#nav-back'); await settle(page, 450);
    check('back from there returns to Home (where the user came from)', (await visible(page)) === 'home');

    // Each tab keeps its place.
    await tab(page, 'discover'); await settle(page, 300); await page.click('#screen-discover a[data-route="arena"]'); await settle(page, 450);
    await tab(page, 'home'); await settle(page, 300);
    await tab(page, 'discover'); await settle(page, 450);
    check('leaving Discover on Battle Arena and coming back shows Battle Arena', (await visible(page)) === 'arena');
    await tab(page, 'discover'); await settle(page, 450);
    check('tapping the active tab on a secondary screen goes to the tab\'s main screen', (await visible(page)) === 'discover');
    await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' })); await settle(page, 150);
    await tab(page, 'discover'); await page.waitForTimeout(700);
    check('tapping the active tab on its main screen scrolls to the top', (await scrollY(page)) === 0);

    // Exercise library: secondary screen under Train, filter choice survives leaving the screen.
    await tab(page, 'train'); await settle(page, 300);
    await page.click('#screen-train a[data-route="library"]'); await settle(page, 450);
    check('Exercise library opens under Train with a back button', (await visible(page)) === 'library' && (await page.$eval('#nav-title', e => e.textContent)) === 'Exercise library' && (await page.$eval('#tabbar .tab.active', a => a.dataset.tab)) === 'train');
    await page.click('#library-filters [data-library-filter="push"]'); await settle(page, 200);
    const nPush = await page.$$eval('#library-grid > *', e => e.length);
    await tab(page, 'home'); await settle(page, 250); await tab(page, 'train'); await settle(page, 400);
    check('library filter is kept after leaving and returning', (await visible(page)) === 'library' && (await page.$eval('#library-filters .chip.active', e => e.dataset.libraryFilter)) === 'push' && (await page.$$eval('#library-grid > *', e => e.length)) === nPush);
    await page.click('#nav-back'); await settle(page, 400);

    // ================= 5. Deep links, reload, old links =================
    const deep = async (path, expect, label) => { const r = await boot({}, path); const v = await visible(r.page); check(label, v === expect, `${path} -> ${v}`); return r; };
    await context.close();
    let r2 = await deep('#skills', 'skills', 'reload on a secondary screen keeps it (#skills)');
    await r2.page.click('#nav-back'); await settle(r2.page, 400);
    check('back button on a deep-linked secondary screen goes to its parent', (await visible(r2.page)) === 'discover');
    await r2.context.close();
    for (const [path, expect] of [['#profile', 'profile'], ['#community', 'arena'], ['#top', 'home'], ['#training', 'train'], ['#features', 'discover'], ['#nonsense', 'home']]) { const r = await deep(path, expect, `link ${path || '/'} opens ${expect}`); await r.context.close(); }
    const rp = await boot({}, '#programs');
    check('old #programs link opens Train and brings the weekly plan into view', (await visible(rp.page)) === 'train' && await rp.page.evaluate(() => { const r = document.getElementById('programs').getBoundingClientRect(); return r.top < 500 && r.bottom > 0; }));
    await rp.context.close();

    // ================= 6. Every screen: bottom content clear of the bar, no sideways scroll =================
    for (const [w, h] of [[390, 844], [320, 568]]) {
        const r = await boot({ width: w, height: h });
        const bad = [];
        for (const id of ALL) {
            await r.page.evaluate(i => { location.hash = '#' + i; }, id); await settle(r.page, 300);
            await r.page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await settle(r.page, 150);
            const m = await r.page.evaluate(() => {
                const screen = document.querySelector('.screen:not([hidden])');
                const last = [...screen.querySelectorAll('section *')].filter(e => e.getBoundingClientRect().height > 0 && !e.closest('.leaflet-container')).pop();
                const bar = document.getElementById('tabbar').getBoundingClientRect();
                return { gap: Math.round(bar.top - last.getBoundingClientRect().bottom), over: document.documentElement.scrollWidth > document.documentElement.clientWidth };
            });
            if (m.gap < 0 || m.over) bad.push(`${id}: gap ${m.gap}${m.over ? ' sideways' : ''}`);
        }
        check(`${w}px: last content of all ${ALL.length} screens ends above the bottom bar, no sideways scroll`, bad.length === 0, bad.join('; '));
        await r.context.close();
    }

    // ================= 7. Safe areas =================
    {
        const r = await boot();
        let ok = true;
        try {
            const cdp = await r.context.newCDPSession(r.page);
            await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
            await settle(r.page, 300);
            const m = await r.page.evaluate(() => ({
                barH: Math.round(document.getElementById('tabbar').getBoundingClientRect().height), barBottom: Math.round(document.getElementById('tabbar').getBoundingClientRect().bottom), ih: innerHeight,
                headPad: parseFloat(getComputedStyle(document.getElementById('site-header')).paddingTop), bodyPad: parseFloat(getComputedStyle(document.body).paddingBottom),
                tabLabelBottom: Math.round(document.querySelector('#tabbar .tab span').getBoundingClientRect().bottom)
            }));
            check('safe area (bottom 34 px): bar grows by the inset, labels stay above the home indicator', m.barH === 64 + 34 && m.barBottom === m.ih && m.tabLabelBottom <= m.ih - 34 && m.bodyPad >= m.barH, JSON.stringify(m));
            check('safe area (top 47 px): header content starts below the notch', m.headPad === 47, JSON.stringify(m));
            await r.page.evaluate(() => { location.hash = '#profile'; }); await settle(r.page, 300);
            await r.page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await settle(r.page, 150);
            const gap = await r.page.evaluate(() => { const last = [...document.querySelectorAll('#screen-profile section *')].filter(e => e.getBoundingClientRect().height > 0).pop(); return Math.round(document.getElementById('tabbar').getBoundingClientRect().top - last.getBoundingClientRect().bottom); });
            check('safe area: last content of Profile still clears the taller bar', gap >= 0, gap);
        } catch (e) { ok = false; skipped.push('Safe-area emulation (CDP Emulation.setSafeAreaInsetsOverride) is not available in this Chrome: ' + e.message.slice(0, 120)); }
        await r.context.close();
    }

    // ================= 8. Transitions =================
    {
        const r = await boot();
        await tab(r.page, 'quests');
        const fade = await r.page.evaluate(() => document.getElementById('screen-quests').className);
        check('tab change uses the fade transition', /enter-fade/.test(fade), fade);
        await settle(r.page, 500);
        check('transition class is removed when it ends', !/enter-/.test(await r.page.$eval('#screen-quests', e => e.className)));
        await tab(r.page, 'discover'); await settle(r.page, 400);
        await r.page.click('#screen-discover a[data-route="skills"]');
        const push = await r.page.evaluate(() => document.getElementById('screen-skills').className);
        await settle(r.page, 500);
        await r.page.click('#nav-back');
        const pop = await r.page.evaluate(() => document.getElementById('screen-discover').className);
        check('opening a secondary screen slides in, going back slides the other way', /enter-push/.test(push) && /enter-pop/.test(pop), `${push} | ${pop}`);
        await r.context.close();
        const rm = await newPage(browser, { width: 390, height: 844, touch: true, reducedMotion: 'reduce' });
        await rm.page.goto(url); await rm.page.waitForSelector('#quest-board .quest-card', { state: 'attached' });
        await tab(rm.page, 'profile'); await settle(rm.page, 200);
        check('reduced motion: screens still switch and the transition is effectively off', (await visible(rm.page)) === 'profile' && (await rm.page.$eval('#screen-profile', e => parseFloat(getComputedStyle(e).animationDuration))) < 0.01);
        await rm.context.close();
    }

    // ================= 9. Workout, quests and state across screens =================
    {
        const r = await boot();
        await tab(r.page, 'profile'); await settle(r.page, 300);
        await r.page.click('[data-action="start-training"]'); await settle(r.page, 400);
        const opened = !(await r.page.$eval('#active-session-panel', e => e.classList.contains('hidden'))) || (await visible(r.page)) === 'train';
        check('Start workout from Profile starts or opens the workout', opened);
        if (await r.page.$eval('#active-session-panel', e => e.classList.contains('hidden'))) await r.page.click('.quick-card[data-type="push"]');
        await r.page.waitForSelector('#active-session-panel:not(.hidden)');
        await r.page.click('#exercise-list .ex.current [data-action="complete-set"]');
        await r.page.keyboard.press('Escape'); await settle(r.page, 500);
        const pillAll = [];
        for (const id of MAIN) {
            await tab(r.page, id); await settle(r.page, 250);
            const p = await r.page.$eval('#session-pill', e => { const b = e.getBoundingClientRect(); return { shown: !e.classList.contains('hidden'), above: b.bottom <= document.getElementById('tabbar').getBoundingClientRect().top }; });
            if (!p.shown || !p.above) pillAll.push(id);
        }
        check('running workout: the resume pill is visible above the bar on every main screen', pillAll.length === 0, pillAll.join());
        await r.page.click('#session-pill');
        await r.page.waitForSelector('#active-session-panel:not(.hidden)');
        await r.page.click('#complete-session-btn'); await r.page.waitForSelector('#session-summary:not(.hidden)');
        await r.page.click('#close-session-btn'); await settle(r.page, 700);
        await tab(r.page, 'quests'); await settle(r.page, 300);
        check('finished workout: Quests screen shows the completed main quest', (await r.page.$$('#quest-board .quest-card.main.completed, #quest-board .quest-card.main.done')).length >= 1 || /completed/i.test(await r.page.$eval('#quest-summary', e => e.textContent)));
        await tab(r.page, 'profile'); await settle(r.page, 300);
        check('Profile shows the same XP as Home', (await r.page.$eval('#profile-xp-text', e => e.textContent.trim().split(' ')[0])) === (await r.page.$eval('#dash-xp-text', e => e.textContent.trim().split(' ')[0])));
        check('no console errors in the workout and navigation flow', r.errors.length === 0, r.errors.join(' | '));
        await r.context.close();
    }

    // ================= 10. Map starts when its screen opens, survives leaving =================
    {
        const r = await boot();
        check('map does not start before its screen is opened', (await r.page.$$('.leaflet-container')).length === 0);
        await tab(r.page, 'discover'); await settle(r.page, 300);
        await r.page.click('#screen-discover a[data-route="map"]');
        await r.page.waitForSelector('.leaflet-container', { timeout: 8000 }).catch(() => {});
        await settle(r.page, 800);
        const size = () => r.page.$eval('.leaflet-container', e => { const b = e.getBoundingClientRect(); return b.width > 100 && b.height > 100; }).catch(() => false);
        check('map opens with a real size on its screen', await size());
        await tab(r.page, 'home'); await settle(r.page, 300);
        await tab(r.page, 'discover'); await settle(r.page, 500);
        check('map screen is restored with the same size after leaving', (await visible(r.page)) === 'map' && await size());
        check('no console errors with the map', r.errors.filter(e => !/Routing error|L is not defined/.test(e)).length === 0, r.errors.join(' | '));
        await r.context.close();
    }

    // ================= 11. Stress: rapid taps, random jumps =================
    {
        const r = await boot();
        const seq = [];
        let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 40; i++) { const id = ALL[Math.floor(rnd() * ALL.length)]; seq.push(id); await r.page.evaluate(h => { location.hash = '#' + h; }, id); if (i % 3 === 0) await r.page.waitForTimeout(40); }
        for (let i = 0; i < 20; i++) await r.page.evaluate(t => document.querySelector(`#tabbar a[data-tab="${t}"]`).click(), MAIN[i % 5]);
        await settle(r.page, 600);
        const v = (await visible(r.page)).split(',');
        check('after 60 rapid navigations exactly one screen is open and the bar matches it', v.length === 1 && (await r.page.$eval('#tabbar .tab.active', a => a.dataset.tab)) === (await r.page.$eval('.screen:not([hidden])', e => e.dataset.tab)) && (await hash(r.page)) === `#${v[0]}`, v.join());
        check('rapid navigation: no console errors', r.errors.length === 0, r.errors.join(' | '));
        await r.context.close();
    }

    // ================= 12. Desktop =================
    {
        const r = await newPage(browser, { width: 1440, height: 900 });
        await r.page.goto(url); await r.page.waitForSelector('#quest-board .quest-card', { state: 'attached' }); await r.page.waitForTimeout(600);
        check('desktop: header shows the five links, bottom bar hidden', (await r.page.$$eval('#primary-nav a', a => a.map(x => x.textContent).join())) === 'Home,Quests,Train,Discover,Profile' && (await r.page.$eval('#tabbar', e => getComputedStyle(e).display === 'none')));
        await r.page.click('#primary-nav a[data-tab="discover"]'); await r.page.waitForTimeout(300);
        await r.page.click('#screen-discover a[data-route="arena"]'); await r.page.waitForTimeout(450);
        check('desktop: secondary screen shows back button, title and keeps the logo', (await visible(r.page)) === 'arena' && !(await r.page.$eval('#nav-back', e => e.classList.contains('hidden'))) && (await r.page.$eval('.logo', e => getComputedStyle(e).display !== 'none')) && (await r.page.$eval('#primary-nav a[data-tab="discover"]', a => a.classList.contains('active'))));
        await r.page.click('#nav-back'); await r.page.waitForTimeout(400);
        check('desktop: back returns to Discover', (await visible(r.page)) === 'discover');
        await r.context.close();
    }

    // ================= 13. Keyboard =================
    {
        const r = await boot();
        await r.page.focus('#tabbar a[data-tab="quests"]'); await r.page.keyboard.press('Enter'); await settle(r.page, 300);
        check('keyboard: Enter on a bottom-bar link opens the screen', (await visible(r.page)) === 'quests');
        await r.page.focus('.skip-link'); await r.page.keyboard.press('Enter'); await settle(r.page, 150);
        check('keyboard: skip link moves focus into the current screen', await r.page.evaluate(() => /^H[12]$/.test(document.activeElement.tagName) && document.activeElement.closest('.screen:not([hidden])') !== null));
        await r.context.close();
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
