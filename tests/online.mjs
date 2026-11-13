// Helpers for the online suites. The app runs in a real browser against the local Supabase stand-in
// (real Postgres, real migrations, real supabase-js). It is not a live Supabase project.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { serve, launch, newPage } from './harness.mjs';
import { startLocalSupabase } from './supabase/local-supabase.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const requireSb = createRequire(path.join(HERE, 'supabase/'));
export const { createClient } = requireSb('@supabase/supabase-js');

// A supabase-js client for a signed-in user, used to attack the API directly the way a modified app could.
export const clientFor = (sb, accessToken) => createClient(sb.url, sb.anonKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false, autoRefreshToken: false } });
export const authSession = page => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('cala-auth')); } catch (e) { return null; } });
// The cached state of the signed-in user (one slot per account).
export const cachedState = page => page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('cala_state_u_')); return k ? JSON.parse(localStorage[k]) : null; });

export function makeRunner() {
    const results = [];
    const skipped = [];
    const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + String(detail).slice(0, 400) : ''}`); };
    const finish = async (cleanup) => {
        const failed = results.filter(r => !r.ok);
        console.log(`\n${results.length - failed.length}/${results.length} passed`);
        skipped.forEach(s => console.log('NOT EXECUTED: ' + s));
        if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' - ' + f.name)); }
        await cleanup();
        process.exit(failed.length ? 1 : 0);
    };
    return { check, finish, skipped, results };
}

export async function setupOnline(dbName) {
    const sb = await startLocalSupabase({ dbName });
    const { server, url } = await serve();
    const browser = await launch();
    const envBody = `export const SUPABASE_URL=${JSON.stringify(sb.url)}; export const SUPABASE_ANON_KEY=${JSON.stringify(sb.anonKey)};`;
    // A new browser context per call, so every user starts with empty storage.
    const open = async (opts = {}) => {
        const r = await newPage(browser, { width: 390, height: 844, touch: true, account: false, ...opts });
        await r.page.route('**/js/env.js', route => route.fulfill({ contentType: 'text/javascript', body: envBody }));
        r.requests = [];
        r.page.on('request', q => { if (q.url().startsWith(sb.url)) r.requests.push(q.url()); });
        return r;
    };
    const close = async () => { await browser.close(); server.close(); await sb.close(); };
    return { sb, url, browser, open, close, envBody };
}

export const visible = page => page.$$eval('.screen', s => s.filter(x => !x.hidden).map(x => x.dataset.screen).join());
export const hash = page => page.evaluate(() => location.hash);
export const waitScreen = (page, id, timeout = 8000) => page.waitForFunction(i => { const s = [...document.querySelectorAll('.screen')].filter(x => !x.hidden); return s.length === 1 && s[0].dataset.screen === i; }, id, { timeout });
export const tabbarShown = page => page.evaluate(() => getComputedStyle(document.getElementById('tabbar')).display !== 'none');
export const headerShown = page => page.evaluate(() => getComputedStyle(document.getElementById('site-header')).display !== 'none');

export async function signUpUi(page, url, email, password = 'Passw0rd!') {
    await page.goto(url + '#signup');
    await waitScreen(page, 'signup');
    await page.fill('#su-email', email);
    await page.fill('#su-pass', password);
    await page.fill('#su-pass2', password);
    await page.check('#su-terms');
    await page.click('#signup-btn');
    await waitScreen(page, 'verify');
}

// Opens the link from the verification email in the same browser (as a user would), then waits for the app.
export async function verifyByLink(page, sb, email, type = 'signup') {
    const link = await sb.followEmailLink(email, type);
    await page.goto(link);
}

export async function finishOnboardingUi(page, name = 'Tester') {
    await waitScreen(page, 'ob-character');
    await page.fill('#oc-name', name);
    await page.click('#char-btn');
    await waitScreen(page, 'ob-goals');
    await page.check('#og-primary input[value="strength"]');
    await page.click('#goals-btn');
    await waitScreen(page, 'ob-prefs');
    await page.check('#op-experience input[value="beginner"]');
    await page.check('#op-environment input[value="home"]');
    await page.check('#op-equipment input[value="pullup-bar"]');
    await page.check('#op-frequency input[value="3"]');
    await page.check('#op-duration input[value="20-30"]');
    await page.click('#prefs-btn');
    await waitScreen(page, 'ob-done');
    await page.click('#done-btn');
    await waitScreen(page, 'home');
}

export async function logInUi(page, url, email, password = 'Passw0rd!') {
    await page.goto(url + '#login');
    await waitScreen(page, 'login');
    await page.fill('#li-email', email);
    await page.fill('#li-pass', password);
    await page.click('#login-btn');
}
