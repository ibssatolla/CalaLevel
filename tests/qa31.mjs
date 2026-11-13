// Phase 3.1 QA: viewport audit (overflow, overlap, tap targets, text clipping, icons), modals, console, requests.
// Writes screenshots to tests/shots/qa-<width>-<screen>.png and a JSON report to tests/shots/qa-report.json.
import fs from 'node:fs';
import { serve, launch, newPage, SHOTS } from './harness.mjs';

const { server, url } = await serve();
const browser = await launch();
fs.mkdirSync(SHOTS, { recursive: true });
const VIEWPORTS = [[320, 568, true], [390, 844, true], [375, 812, true], [430, 932, true], [768, 1024, true], [1440, 900, false]];
const SCREENS = ['home', 'quests', 'train', 'library', 'discover', 'skills', 'arena', 'map', 'profile'].map(id => [id, id]);
const report = [];

// Runs inside the page.
const audit = () => {
    const vw = document.documentElement.clientWidth;
    const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('.hidden,[hidden],[aria-hidden="true"]'); };
    const name = e => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') || e.tagName.toLowerCase();
    const out = { vw, scrollW: document.documentElement.scrollWidth, wide: [], small: [], clipped: [], icons: [] };
    for (const e of document.querySelectorAll('body *')) {
        if (!vis(e) || e.closest('.leaflet-container,#confetti,.workout')) continue;
        const r = e.getBoundingClientRect();
        // Elements that stick out to the right of the viewport and are not inside a scroll container.
        if (r.right > vw + 1 && !e.closest('[class*="scroll"],.chips,.filter-row,.lb-scroll')) {
            let p = e.parentElement, scroller = false;
            while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.getBoundingClientRect().right <= vw + 1) { scroller = true; break; } p = p.parentElement; }
            if (!scroller) out.wide.push(name(e) + ' right=' + Math.round(r.right));
        }
        // Text clipped by its own box.
        const cs = getComputedStyle(e);
        if (!e.closest('.visually-hidden') && !e.matches('.visually-hidden') && e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') out.clipped.push(name(e) + ' "' + e.textContent.trim().slice(0, 30) + '"');
    }
    for (const e of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, [role=button], [role=tab]')) {
        if (!vis(e) || e.closest('.leaflet-container,.workout')) continue;
        if (e.matches('input[type=checkbox],input[type=radio]') && e.closest('label') && vis(e.closest('label'))) { const lr = e.closest('label').getBoundingClientRect(); if (lr.height >= 44) continue; }
        const r = e.getBoundingClientRect();
        if (e.matches('.skip-link,.visually-hidden,.sr-only') ) continue;
        if (r.height < 43.5 || r.width < 43.5) out.small.push(name(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (e.textContent.trim() || e.getAttribute('aria-label') || '').slice(0, 24) + '"');
    }
    // Icons: any svg that is empty, or a data-icon placeholder that was not filled.
    for (const s of document.querySelectorAll('svg')) { if (vis(s) && !s.closest('.leaflet-container') && s.childElementCount === 0) out.icons.push(name(s)); }
    for (const e of document.querySelectorAll('[data-icon]')) { if (vis(e) && !e.querySelector('svg')) out.icons.push('unfilled ' + name(e)); }
    // Fixed tab bar must not hide the last content: body bottom padding at least tab bar height.
    const tb = document.getElementById('tabbar');
    out.tabbar = tb && vis(tb) ? { h: Math.round(tb.getBoundingClientRect().height), bodyPad: parseFloat(getComputedStyle(document.body).paddingBottom) } : null;
    return out;
};

const dedupe = a => [...new Set(a)];

for (const mode of ['live', 'demo']) {
    for (const [w, h, touch] of VIEWPORTS) {
        const { page, context, errors } = await newPage(browser, { width: w, height: h, touch, init: mode === 'demo' ? () => { try { localStorage.setItem('cala_mode', 'demo'); } catch (e) { } } : undefined });
        const failed = [];
        page.on('requestfailed', r => failed.push(r.url().slice(0, 90) + ' ' + (r.failure() || {}).errorText));
        page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url().slice(0, 90)); });
        await page.goto(url); await page.waitForSelector('#quest-board .quest-card'); await page.waitForTimeout(1200);
        const entry = { mode, viewport: `${w}x${h}`, screens: {} };
        for (const [label, id] of SCREENS) {
            await page.evaluate(i => { location.hash = '#' + i; window.scrollTo({ top: 0, behavior: 'instant' }); }, id);
            await page.waitForTimeout(label === 'map' ? 1500 : 600);
            const a = await page.evaluate(audit);
            const height = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
            entry.screens[label] = { wide: dedupe(a.wide).slice(0, 6), small: dedupe(a.small).slice(0, 12), clipped: dedupe(a.clipped).slice(0, 6), icons: dedupe(a.icons), scrollOverflow: a.scrollW > a.vw, tabbar: a.tabbar, sectionHeight: height };
            if (mode === 'live' || label === 'home') await page.screenshot({ path: `${SHOTS}/qa-${mode}-${w}-${label}.png` });
        }
        await page.evaluate(() => { location.hash = '#home'; });
        await page.waitForTimeout(400);
        // Modals: every modal must fit inside the viewport.
        entry.modals = {};
        const modalTests = {
            'history-modal': async () => { await page.evaluate(() => document.getElementById('history-modal').classList.remove('hidden')); },
            'confirm-modal': async () => { await page.evaluate(() => document.getElementById('confirm-modal').classList.remove('hidden')); },
            'levelup-modal': async () => { await page.evaluate(() => document.getElementById('levelup-modal').classList.remove('hidden')); }
        };
        for (const [id, open] of Object.entries(modalTests)) {
            await open(); await page.waitForTimeout(900);
            entry.modals[id] = await page.evaluate(i => {
                const m = document.getElementById(i); const card = m.querySelector('.modal-card') || m.firstElementChild; const r = card.getBoundingClientRect();
                const innerH = window.innerHeight; const innerW = document.documentElement.clientWidth;
                const scrolls = card.scrollHeight > card.clientHeight + 1;
                return { fitsW: r.left >= -0.5 && r.right <= innerW + 0.5, fitsH: r.bottom <= innerH + 0.5 && r.top >= -0.5, scrollsInside: scrolls, top: Math.round(r.top), bottom: Math.round(r.bottom), innerH };
            }, id);
            if (mode === 'live' && w === 390 && id !== 'confirm-modal') await page.screenshot({ path: `${SHOTS}/qa-${mode}-${w}-modal-${id}.png` });
            await page.evaluate(i => document.getElementById(i).classList.add('hidden'), id);
        }
        // Workout mode fits on the screen.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => { location.hash = '#train'; }); await page.waitForTimeout(300); await page.click('.quick-card[data-type="push"]'); await page.waitForSelector('#active-session-panel:not(.hidden)'); await page.waitForTimeout(500);
        entry.workout = await page.evaluate(() => {
            const p = document.getElementById('active-session-panel'); const f = p.querySelector('.workout-footer'); const t = p.querySelector('.workout-top');
            const fr = f.getBoundingClientRect(), tr = t.getBoundingClientRect();
            return { overflowX: p.scrollWidth > p.clientWidth + 1, footerVisible: fr.bottom <= window.innerHeight + 0.5 && fr.top >= 0, topVisible: tr.top >= -0.5, small: [...p.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(b => (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 20) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)) };
        });
        if (mode === 'live') await page.screenshot({ path: `${SHOTS}/qa-${mode}-${w}-workout.png` });
        entry.errors = dedupe(errors).slice(0, 5);
        entry.failedRequests = dedupe(failed).slice(0, 8);
        report.push(entry);
        await context.close();
    }
}
fs.writeFileSync(`${SHOTS}/qa-report.json`, JSON.stringify(report, null, 1));
// Compact printout.
for (const e of report) {
    const bad = [];
    for (const [s, v] of Object.entries(e.screens)) {
        if (v.scrollOverflow) bad.push(`${s}: horizontal scroll`);
        if (v.wide.length) bad.push(`${s}: wide ${v.wide.join('; ')}`);
        if (v.clipped.length) bad.push(`${s}: clipped ${v.clipped.join('; ')}`);
        if (v.icons.length) bad.push(`${s}: icons ${v.icons.join('; ')}`);
        if (v.small.length) bad.push(`${s}: small ${v.small.length} -> ${v.small.slice(0, 5).join('; ')}`);
        if (v.tabbar && v.tabbar.bodyPad < v.tabbar.h) bad.push(`${s}: body padding ${v.tabbar.bodyPad} < tabbar ${v.tabbar.h}`);
    }
    for (const [m, v] of Object.entries(e.modals)) if (!v.fitsW || !v.fitsH) bad.push(`modal ${m}: ${JSON.stringify(v)}`);
    if (e.workout.overflowX || !e.workout.footerVisible || !e.workout.topVisible || e.workout.small.length) bad.push('workout: ' + JSON.stringify(e.workout));
    if (e.errors.length) bad.push('errors: ' + e.errors.join(' | '));
    if (e.failedRequests.length) bad.push('requests: ' + e.failedRequests.join(' | '));
    console.log(`\n== ${e.mode} ${e.viewport}: ${bad.length ? bad.length + ' findings' : 'clean'}`);
    bad.forEach(b => console.log('  - ' + b.slice(0, 400)));
}
await browser.close(); server.close();
