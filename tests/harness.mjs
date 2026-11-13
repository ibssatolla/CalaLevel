import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// playwright-core comes from the project (npm install) or from PLAYWRIGHT_DIR.
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, '/') : import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = process.env.APP_ROOT || path.resolve(HERE, '..');
export const SHOTS = path.join(HERE, 'shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

export function serve(root = ROOT) {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const file = path.join(root, p);
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

// Optional local copies of the map libraries (npm install leaflet leaflet-routing-machine). Without them the real CDN is used.
const LIBS = process.env.LIBS_DIR || path.join(HERE, 'node_modules');
const L = path.join(LIBS, 'leaflet/dist/') ;
const LRM = path.join(LIBS, 'leaflet-routing-machine/dist/');
const haveLocal = fs.existsSync(L) && fs.existsSync(LRM);

// Older suites (phases 1 to 3.2) test the app itself, not the account system. They run as a signed-in user whose
// account was already loaded once: a saved session, a gate cache and a per-user cache, with every Supabase request
// aborted. That is the real offline path of the app. `cala_state_v2` (the key those suites write to) is mapped to the
// user's own cache slot, so their fixtures still work. Pass account: false to run without it (the online suites do).
export const OFFLINE_USER = '11111111-1111-4111-8111-111111111111';
const offlineAccountScript = `(() => {
    const UID = '${OFFLINE_USER}';
    const SLOT = 'cala_state_u_' + UID;
    const proto = Storage.prototype;
    const g = proto.getItem, s = proto.setItem, r = proto.removeItem;
    const map = k => (k === 'cala_state_v2' ? SLOT : k);
    proto.getItem = function (k) { return g.call(this, this === localStorage ? map(k) : k); };
    proto.setItem = function (k, v) { return s.call(this, this === localStorage ? map(k) : k, v); };
    proto.removeItem = function (k) { return r.call(this, this === localStorage ? map(k) : k); };
    try {
        if (localStorage.getItem('cala_mode') === 'demo') return;
        const exp = Math.floor(Date.now() / 1000) + 86400 * 3650;
        if (!g.call(localStorage, 'cala-auth')) s.call(localStorage, 'cala-auth', JSON.stringify({ access_token: 'a.b.c', refresh_token: 'offline-test', token_type: 'bearer', expires_in: 3600, expires_at: exp,
            user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
        if (!g.call(localStorage, 'cala_gate_u_' + UID)) s.call(localStorage, 'cala_gate_u_' + UID, JSON.stringify({ onboarded: true, step: 'done', at: Date.now() }));
        if (!g.call(localStorage, SLOT) && !sessionStorage.getItem('cala_offline_seeded')) s.call(localStorage, SLOT, JSON.stringify({ version: 3 }));
        sessionStorage.setItem('cala_offline_seeded', '1');
    } catch (e) { /* storage blocked */ }
})();`;

export async function newPage(browser, { width = 1280, height = 900, touch = false, permissions = ['geolocation'], reducedMotion, init, timezoneId, fixedTime, account = true } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, geolocation: { latitude: 59.91, longitude: 10.75 }, permissions, ...(reducedMotion ? { reducedMotion } : {}), ...(timezoneId ? { timezoneId } : {}) });
    const page = await context.newPage();
    // Starts the page clock at a given moment and lets it run, so weekday-dependent fixtures stay stable.
    if (fixedTime) await page.clock.install({ time: fixedTime });
    if (account) {
        await page.addInitScript(offlineAccountScript);
        await page.route('**/js/env.js', route => route.fulfill({ contentType: 'text/javascript', body: "export const SUPABASE_URL='https://offline.invalid'; export const SUPABASE_ANON_KEY='offline-anon-key-not-a-real-key-0000';" }));
        await page.route('https://offline.invalid/**', route => route.abort());
    }
    if (init) await page.addInitScript(init);
    // The app shows one screen at a time. Before an action on an element, open the screen that owns it
    // (the same deep link a user can open), so older flows that assumed one long page keep working.
    for (const method of ['click', 'dblclick', 'fill', 'check', 'uncheck', 'hover', 'tap']) {
        const original = page[method].bind(page);
        page[method] = async (selector, ...rest) => {
            await page.evaluate(sel => {
                const el = document.querySelector(sel);
                const screen = el && el.closest('.screen');
                if (screen && screen.hidden) location.hash = '#' + screen.dataset.screen;
            }, selector).catch(() => {});
            return original(selector, ...rest);
        };
    }
    const waitOriginal = page.waitForSelector.bind(page);
    page.waitForSelector = async (selector, options = {}) => {
        if (!options.state || options.state === 'visible') {
            await page.evaluate(sel => {
                const el = document.querySelector(sel);
                const screen = el && el.closest('.screen');
                if (screen && screen.hidden) location.hash = '#' + screen.dataset.screen;
            }, selector).catch(() => {});
        }
        return waitOriginal(selector, options);
    };
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.route(/unpkg\.com|fonts\.g|basemaps|cartocdn|spline/, route => {
        const u = route.request().url();
        if (!haveLocal) return route.continue();
        const serveFile = (f, type) => route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
        if (u.includes('leaflet@1.9.4/dist/leaflet.js')) return serveFile(L + 'leaflet.js', 'text/javascript');
        if (u.includes('leaflet@1.9.4/dist/leaflet.css')) return serveFile(L + 'leaflet.css', 'text/css');
        if (u.includes('leaflet-routing-machine') && u.endsWith('.js')) return serveFile(LRM + 'leaflet-routing-machine.js', 'text/javascript');
        if (u.includes('leaflet-routing-machine') && u.endsWith('.css')) return serveFile(LRM + 'leaflet-routing-machine.css', 'text/css');
        if (u.includes('spline-viewer.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
        return route.abort();
    });
    return { page, context, errors };
}

export async function launch() {
    // CHROME_PATH points at a Chrome or Chromium binary. Without it Playwright uses the installed Google Chrome.
    return chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : { channel: 'chrome' });
}
