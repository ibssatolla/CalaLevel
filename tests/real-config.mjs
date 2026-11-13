// Phase 3.3.2: starts the app with the REAL js/env.js (project URL + publishable key), not the test stand-in.
// The workspace has no route to supabase.co, so requests to it are aborted and counted. This checks the app side only:
// the config is picked up, the setup screen is gone, the guest screens load, demo mode stays offline.
// It proves nothing about the live backend. Live checks are in docs/SUPABASE-LIVE-CHECK.md.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch } from './harness.mjs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS ' : 'FAIL ', n, ok ? '' : extra); };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const envText = fs.readFileSync(path.join(ROOT, 'js/env.js'), 'utf8');
check('js/env.js holds the project URL', /https:\/\/qhmdfaiqunmxkfibytqg\.supabase\.co/.test(envText));
check('js/env.js holds a publishable key and no secret', /sb_publishable_/.test(envText) && !/sb_secret_|service_role/.test(envText));
check('.env is ignored by git', /^\.env$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')));
check('.env.example has placeholders only', !/sb_publishable_[A-Za-z0-9]|qhmdfaiq/.test(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')));

const { server, url } = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const sb = []; const errors = [];
await page.route(/supabase\.co/, route => { sb.push(route.request().url()); route.abort(); });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/supabase\.co|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const screen = () => page.evaluate(() => [...document.querySelectorAll('.screen')].filter(s => !s.hidden && getComputedStyle(s).display !== 'none').map(s => s.dataset.screen).join(','));
const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(400); return screen(); };

await page.goto(url);
await page.waitForFunction(() => [...document.querySelectorAll('.screen')].some(s => !s.hidden && s.dataset.screen === 'welcome'), null, { timeout: 8000 }).catch(() => {});
check('welcome screen loads (not the setup screen)', (await screen()) === 'welcome', await screen());
check('no request to Supabase for a guest on the welcome screen', sb.length === 0, sb.join(' '));
check('signup screen loads', (await go('#signup')) === 'signup');
check('login screen loads', (await go('#login')) === 'login');
check('forgot password screen loads', (await go('#forgot')) === 'forgot');
check('protected route #home sends a guest back to welcome', (await go('#home')) === 'welcome');
check('protected route #profile sends a guest back to welcome', (await go('#profile')) === 'welcome');
await go('#welcome');
await page.click('#screen-welcome [data-flow-action="demo"]');
await page.waitForSelector('#demo-banner:not(.hidden)', { timeout: 8000 }).catch(() => {});
await page.waitForFunction(() => { const h = document.querySelector('.screen[data-screen="home"]'); return h && !h.hidden && getComputedStyle(h).display !== 'none'; }, null, { timeout: 8000 }).catch(() => {});
check('demo mode opens Home with the demo banner', await page.evaluate(() => !document.getElementById('demo-banner').classList.contains('hidden')) && (await screen()) === 'home', 'screen=' + await screen());
check('demo mode made no Supabase request', sb.length === 0, sb.join(' '));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
