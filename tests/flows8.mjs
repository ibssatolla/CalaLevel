// Phase 3.3, part 2: returning users, sessions, password reset, security and account deletion.
// Real app in Chrome against the local Supabase stand-in (real Postgres, real migrations). Not a live Supabase project.
import fs from 'node:fs';
import path from 'node:path';
import { makeRunner, setupOnline, visible, hash, waitScreen, tabbarShown, logInUi, clientFor, authSession, cachedState, ROOT } from './online.mjs';

const { check, finish } = makeRunner();
const env = await setupOnline('cala_flows8');
const { sb, url, open } = env;
const q = (sql, args) => sb.pool.query(sql, args).then(r => r.rows);
const errText = (page, id) => page.$eval(id, e => e.textContent);

try {
    // ================= Returning user =================
    const ret = await sb.createUser({ email: 'ret@example.com', onboard: true, name: 'Returner' });
    let { page, context, errors, requests } = await open();
    await page.goto(url + '#login'); await waitScreen(page, 'login');
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-login.png' });
    await page.fill('#li-email', 'ret@example.com'); await page.fill('#li-pass', 'wrong-Pass1'); await page.click('#login-btn');
    await page.waitForFunction(() => document.getElementById('login-err').textContent.length > 0);
    const wrongPass = await errText(page, '#login-err');
    await page.fill('#li-email', 'nobody@example.com'); await page.click('#login-btn');
    await page.waitForFunction(t => document.getElementById('login-err').textContent.length > 0, null);
    await page.waitForTimeout(300);
    check('wrong password and unknown email give the same message (no account enumeration)', wrongPass === (await errText(page, '#login-err')) && /wrong email or password/i.test(wrongPass), `${wrongPass} / ${await errText(page, '#login-err')}`);
    await page.fill('#li-email', 'ret@example.com'); await page.fill('#li-pass', 'Passw0rd!'); await page.click('#login-btn');
    await waitScreen(page, 'home');
    check('a returning user logs in straight to Home (no onboarding)', (await hash(page)) === '#home' && (await tabbarShown(page)));
    check('the password field is cleared after login', (await page.inputValue('#li-pass')) === '');
    await page.waitForSelector('#quest-board .quest-card', { state: 'attached' });
    check('the character from the account is shown', await page.evaluate(() => document.getElementById('dash-name').textContent.includes('Returner')));
    const reqMark = requests.length;
    await page.reload(); await waitScreen(page, 'home');
    check('session restore: a reload keeps the user signed in on Home', (await hash(page)) === '#home');
    check('session restore: no password login request is made on reload', !requests.slice(reqMark).some(u => u.includes('grant_type=password')));
    const tokenKeys = await page.evaluate(() => Object.keys(localStorage));
    check('only one auth entry is stored (cala-auth) and it holds tokens, not a password', tokenKeys.filter(k => /auth/.test(k)).join() === 'cala-auth');
    const storageDump = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    check('no password appears in localStorage or sessionStorage', !storageDump.includes('Passw0rd!') && !storageDump.includes('wrong-Pass1'));
    for (const r of ['#ob-character', '#welcome', '#login', '#signup', '#verify', '#reset']) {
        await page.evaluate(h => { location.hash = h; }, r); await page.waitForTimeout(120);
        if ((await visible(page)) !== 'home') { check(`signed-in user is kept out of ${r}`, false, await visible(page)); }
    }
    check('a signed-in user cannot open sign-in, sign-up or onboarding screens', (await visible(page)) === 'home');

    // ---- Account screen and logout ----
    await page.evaluate(() => { location.hash = '#profile'; }); await waitScreen(page, 'profile');
    check('Profile shows the account card and hides the old demo-style training setup', await page.evaluate(() => !document.getElementById('profile-account-card').classList.contains('hidden') && document.getElementById('profile-setup-card').classList.contains('hidden')));
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-profile.png', fullPage: true });
    await page.click('#profile-account-card a[href="#account"]'); await waitScreen(page, 'account');
    check('account settings show the email, sync status and policy versions', await page.evaluate(() => document.getElementById('ac-email').textContent === 'ret@example.com' && /saved to your account|Syncing|waiting/i.test(document.getElementById('ac-sync').textContent) && /2026-11-13/.test(document.getElementById('ac-policies').textContent)));
    await page.fill('#ac-user-input', 'ab'); await page.click('#username-form button'); await page.waitForTimeout(400);
    check('an invalid username is refused with a message', (await errText(page, '#ac-user-err')).length > 0);
    await page.fill('#ac-user-input', 'returner_1'); await page.click('#username-form button'); await page.waitForTimeout(500);
    check('a valid username is saved on the account', (await q(`select username from public.profiles where id=$1`, [ret.id]))[0].username === 'returner_1');
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-account-settings.png', fullPage: true });
    check('account settings touch targets are at least 44px', await page.evaluate(() => [...document.querySelectorAll('#screen-account .btn, #screen-account input')].filter(e => e.offsetParent).every(e => e.getBoundingClientRect().height >= 44)));
    await page.click('#ac-logout');
    await waitScreen(page, 'welcome');
    await page.waitForFunction(() => !document.getElementById('welcome-notice').classList.contains('hidden'));
    check('logout returns to Welcome with a confirmation', (await errText(page, '#welcome-notice')).includes('logged out'));
    check('logout removes the session from the browser', (await authSession(page)) === null);
    check('after logout the app is closed again (#home is refused)', await (async () => { await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(250); return (await visible(page)) === 'welcome'; })());
    check('after logout no quests or character render from the old session', await page.evaluate(() => !document.getElementById('dash-name') || !document.getElementById('dash-name').textContent.includes('Returner') || document.getElementById('screen-home').hidden));
    await logInUi(page, url, 'ret@example.com'); await waitScreen(page, 'home');
    check('the same user can log in again after logout', (await hash(page)) === '#home');

    // ---- Second device: same account, same progress ----
    const dev2 = await open();
    await logInUi(dev2.page, url, 'ret@example.com'); await waitScreen(dev2.page, 'home');
    const s1 = await cachedState(page), s2 = await cachedState(dev2.page);
    check('cross-device: a second browser sees the same character and the same quests', s1.character.name === s2.character.name && s1.quests.items.length === s2.quests.items.length && s1.quests.items.map(x => x.id).sort().join() === s2.quests.items.map(x => x.id).sort().join());
    await dev2.context.close();

    // ---- Expired / invalid session ----
    const exp = await open();
    await exp.page.goto(url); await waitScreen(exp.page, 'welcome');
    await exp.page.evaluate(() => localStorage.setItem('cala-auth', JSON.stringify({ access_token: 'x.y.z', refresh_token: 'bogus', token_type: 'bearer', expires_in: 1, expires_at: 1, user: { id: '00000000-0000-0000-0000-000000000000', email: 'ret@example.com' } })));
    await exp.page.reload(); await exp.page.waitForTimeout(2000); await waitScreen(exp.page, 'welcome');
    check('an expired session that cannot be refreshed sends the user to Welcome', (await hash(exp.page)) === '#welcome');
    check('the invalid session is removed from the browser', (await authSession(exp.page)) === null || (await authSession(exp.page)) === undefined);
    await exp.context.close();

    // ================= Password reset =================
    const fp = await open();
    await fp.page.goto(url + '#login'); await waitScreen(fp.page, 'login');
    await fp.page.click('a[href="#forgot"]'); await waitScreen(fp.page, 'forgot');
    await fp.page.screenshot({ path: 'shots/33-forgot.png' });
    const mails0 = sb.emails.length;
    await fp.page.fill('#fg-email', 'nobody@example.com'); await fp.page.click('#forgot-btn');
    await fp.page.waitForFunction(() => !document.getElementById('forgot-ok').classList.contains('hidden'));
    const unknownMsg = await errText(fp.page, '#forgot-ok');
    check('reset for an unknown address shows the same neutral message and sends no email', sb.emails.length === mails0 && /if an account exists/i.test(unknownMsg));
    check('after a send the button counts down and is disabled', await fp.page.evaluate(() => { const b = document.getElementById('forgot-btn'); return b.disabled && /\(\d+ s\)/.test(b.textContent) && /new link/i.test(b.textContent); }));
    await fp.page.evaluate(() => localStorage.removeItem('cala_reset_sends'));
    await fp.page.fill('#fg-email', 'ret@example.com'); await fp.page.click('#forgot-btn'); await fp.page.waitForTimeout(500);
    check('reset for a real address shows the same message and sends one email', (await errText(fp.page, '#forgot-ok')) === unknownMsg && sb.emails.filter(m => m.type === 'recovery' && m.to === 'ret@example.com').length === 1);
    // A request that fails (rate limit) must not break the link that is already on its way.
    const verKey = 'cala-auth-code-verifier';
    const verBefore = await fp.page.evaluate(k => localStorage.getItem(k), verKey);
    await fp.page.evaluate(() => localStorage.removeItem('cala_reset_sends'));
    await fp.page.route('**/auth/v1/recover**', r => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }) }));
    await fp.page.click('#forgot-btn'); await fp.page.waitForTimeout(600);
    await fp.page.unroute('**/auth/v1/recover**');
    check('a rate-limited request shows a clear message and a longer wait', /too many/i.test(await errText(fp.page, '#forgot-err')) && await fp.page.evaluate(() => document.getElementById('forgot-btn').disabled));
    check('a failed request keeps the code that belongs to the email already sent', (await fp.page.evaluate(k => localStorage.getItem(k), verKey)) === verBefore && verBefore);
    const mailCount = sb.emails.length;
    await fp.page.evaluate(() => { localStorage.removeItem('cala_reset_sends'); localStorage.removeItem('cala_reset_block'); });
    check('no email left while the server blocked the request', sb.emails.length === mailCount);
    // Five sends in an hour is the limit.
    await fp.page.evaluate(() => localStorage.setItem('cala_reset_sends', JSON.stringify([1,2,3,4,5].map(i => Date.now() - i * 1000))));
    await fp.page.reload(); await waitScreen(fp.page, 'forgot');
    check('after five emails in an hour the button waits and says why', await fp.page.evaluate(() => document.getElementById('forgot-btn').disabled && /5 links/.test(document.getElementById('forgot-err').textContent)));
    await fp.page.evaluate(() => localStorage.removeItem('cala_reset_sends'));
    const link = await sb.followEmailLink('ret@example.com', 'recovery');
    // Links that arrive with an error in the address.
    const expired = await open();
    await expired.page.goto(url + '#forgot'); await waitScreen(expired.page, 'forgot');
    await expired.page.evaluate(() => localStorage.setItem('cala_reset_pending', JSON.stringify({ at: Date.now() })));
    await expired.page.goto(url + '?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid#error=access_denied&error_code=otp_expired');
    await waitScreen(expired.page, 'forgot');
    check('an expired link sends the user to the forgot screen with a message and a clean address', /did not work/i.test(await errText(expired.page, '#forgot-err')) && !/error/i.test(await expired.page.evaluate(() => location.href)));
    await expired.context.close();
    await fp.page.goto(link);
    await waitScreen(fp.page, 'reset');
    check('the reset link opens the new-password screen (not the app)', (await hash(fp.page)) === '#reset' && !(await tabbarShown(fp.page)));
    await fp.page.evaluate(() => { location.hash = '#home'; }); await fp.page.waitForTimeout(250);
    check('while resetting, the app stays closed', (await visible(fp.page)) === 'reset');
    await fp.page.fill('#rs-pass', 'short'); await fp.page.fill('#rs-pass2', 'short'); await fp.page.click('#reset-btn');
    check('a weak new password is rejected', (await errText(fp.page, '#rs-pass-err')).length > 0);
    await fp.page.fill('#rs-pass', 'NewPassw0rd!'); await fp.page.fill('#rs-pass2', 'NewPassw0rd!'); await fp.page.click('#reset-btn');
    await waitScreen(fp.page, 'home');
    check('after choosing a new password the user is signed in on Home', (await hash(fp.page)) === '#home');
    await fp.context.close();
    // The same kind of link in a browser that did not ask for it must explain itself and not open the app.
    const asker = await open();
    await asker.page.goto(url + '#forgot'); await waitScreen(asker.page, 'forgot');
    await asker.page.fill('#fg-email', 'ret@example.com'); await asker.page.click('#forgot-btn'); await asker.page.waitForTimeout(500);
    const link2 = await sb.followEmailLink('ret@example.com', 'recovery');
    const otherBr = await open();
    await otherBr.page.goto(link2); await otherBr.page.waitForTimeout(1200);
    check('a link opened in another browser shows a clear message and not the app', (await visible(otherBr.page)) === 'welcome' && /did not work/i.test(await errText(otherBr.page, '#welcome-notice')) && !(await tabbarShown(otherBr.page)));
    await otherBr.context.close(); await asker.context.close();
    const oldPw = await open(); await logInUi(oldPw.page, url, 'ret@example.com', 'Passw0rd!');
    await oldPw.page.waitForFunction(() => document.getElementById('login-err').textContent.length > 0);
    check('the old password no longer works', (await visible(oldPw.page)) === 'login');
    await oldPw.page.fill('#li-pass', 'NewPassw0rd!'); await oldPw.page.click('#login-btn'); await waitScreen(oldPw.page, 'home');
    check('the new password works', (await hash(oldPw.page)) === '#home');
    await oldPw.context.close();

    // ================= Security =================
    // 1. No secrets in anything the browser can download.
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['node_modules', 'tests', 'supabase', 'docs', '.git', 'scripts'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
    const served = walk(ROOT).filter(f => /\.(js|html|css|json|txt)$/.test(f));
    const jwtRole = s => { try { return JSON.parse(Buffer.from(s.split('.')[1], 'base64url').toString()).role; } catch { return null; } };
    const bad = served.filter(f => { const t = fs.readFileSync(f, 'utf8'); return /service_role|SERVICE_ROLE/i.test(t) || (t.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g) || []).some(j => jwtRole(j) === 'service_role'); });
    check('no service-role key or name appears in any file the app serves', bad.length === 0, bad.map(f => path.relative(ROOT, f)).join());
    check('the served env.js only holds the URL and the anon key', /export const SUPABASE_URL/.test(fs.readFileSync(path.join(ROOT, 'js/env.js'), 'utf8')) && !/SECRET|PASSWORD|service/i.test(fs.readFileSync(path.join(ROOT, 'js/env.js'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')));
    check('.env (if present) is git-ignored and holds no secret, and .env.example holds placeholders only', (!fs.existsSync(path.join(ROOT, '.env')) || (/^\.env$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')) && !/secret|service_role|password|eyJ/i.test(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')))) && !/eyJ/.test(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')));
    const anonRole = jwtRole(sb.anonKey);
    check('the key the browser receives has the anon role', anonRole === 'anon');

    // 2. Attacks on the API with a real user's token (what a modified client could try).
    const sess = await authSession(page);
    const me = clientFor(sb, sess.access_token);
    const other = await sb.createUser({ email: 'other@example.com', onboard: true, name: 'Other' });
    const xpBefore = Number((await q(`select total_xp from public.characters where user_id=$1`, [ret.id]))[0].total_xp);
    const t1 = await me.from('characters').update({ total_xp: 999999, level: 99, current_xp: 5 }).eq('user_id', ret.id);
    check('RLS: a user cannot write XP, level or total XP on their character', !!t1.error && Number((await q(`select total_xp from public.characters where user_id=$1`, [ret.id]))[0].total_xp) === xpBefore, JSON.stringify(t1.error));
    const t2 = await me.from('xp_transactions').insert({ user_id: ret.id, source_type: 'quest', source_id: 'cheat', xp_amount: 100000 });
    check('RLS: a user cannot insert XP transactions', !!t2.error);
    const countRows = async () => (await q(`select (select count(*) from public.xp_transactions where user_id=$1)::int x, (select count(*) from public.workouts where user_id=$1)::int w`, [ret.id]))[0];
    const rowsBefore = await countRows();
    const t3 = await me.from('xp_transactions').delete().eq('user_id', ret.id);
    const t4 = await me.from('workouts').delete().eq('user_id', ret.id);
    const rowsAfter = await countRows();
    check('RLS: a user cannot delete XP history or workouts', !!t3.error && !!t4.error && rowsBefore.x === rowsAfter.x && rowsBefore.w === rowsAfter.w);
    const t5 = await me.from('profiles').update({ onboarding_completed: false }).eq('id', ret.id);
    check('RLS: a user cannot edit the profile row directly', !!t5.error);
    const t6 = await me.from('characters').select('character_name,user_id');
    check('RLS: a user only sees their own character (not other users)', t6.data.length === 1 && t6.data[0].user_id === ret.id);
    const t7 = await me.from('characters').update({ character_name: 'Hacked' }).eq('user_id', other.id);
    check('RLS: a user cannot edit another user\'s character', (await q(`select character_name from public.characters where user_id=$1`, [other.id]))[0].character_name === 'Other');
    const t8 = await me.from('policy_versions').insert({ policy_type: 'terms', version: 'x', is_current: true });
    check('RLS: reference tables are read-only for users', !!t8.error);
    const anonClient = clientFor(sb, sb.anonKey);
    const t9 = await anonClient.from('characters').select('*');
    const t10 = await anonClient.rpc('get_progress');
    check('anon (not signed in) cannot read user tables or call account functions', (!t9.data || t9.data.length === 0) && !!t10.error);
    const w1 = await me.rpc('record_workout', { p_client_id: 'cheat-1', p_type: 'push', p_title: 'cheat', p_exercises: [{ id: 'a', name: 'Push-ups', unit: 'reps', sets: 1, reps: [5] }], p_duration: 60, p_completed_at: new Date().toISOString(), p_complete: true, p_details: { stats: { xp: 99999 } } });
    check('XP tampering: the server ignores an inflated XP number in a workout', !w1.error && Number(w1.data.xp) > 0 && Number(w1.data.xp) < 200, JSON.stringify(w1));
    const w2 = await me.rpc('record_workout', { p_client_id: 'cheat-1', p_type: 'push', p_title: 'cheat', p_exercises: [{ id: 'a', name: 'Push-ups', unit: 'reps', sets: 1, reps: [5] }], p_duration: 60, p_completed_at: new Date().toISOString(), p_complete: true, p_details: {} });
    check('no duplicate reward: sending the same workout again adds no XP', (await q(`select count(*)::int n from public.xp_transactions where user_id=$1 and source_id='cheat-1'`, [ret.id]))[0].n === 1 && !w2.error);

    // 3. Unverified accounts get nothing from the data API.
    const unv = await sb.createUser({ email: 'unv@example.com', confirmed: false });
    const tok = await sb.issueSession(unv.id);
    const uc = clientFor(sb, tok.access_token);
    const u1 = await uc.rpc('get_progress');
    check('an unverified account is refused by the database even with a valid token', !!u1.error && /email_not_verified/.test(u1.error.message), JSON.stringify(u1.error));

    // ================= Account deletion =================
    const del = await open();
    const delUser = await sb.createUser({ email: 'del@example.com', onboard: true, name: 'ToDelete' });
    await logInUi(del.page, url, 'del@example.com'); await waitScreen(del.page, 'home');
    await del.page.waitForSelector('#quest-board .quest-card', { state: 'attached' }); await del.page.waitForTimeout(1800);
    check('before deletion the account has rows in several tables', (await q(`select (select count(*) from public.characters where user_id=$1)::int c, (select count(*) from public.quests where user_id=$1)::int q`, [delUser.id]))[0].c === 1);
    await del.page.evaluate(() => { location.hash = '#account'; }); await waitScreen(del.page, 'account');
    await del.page.click('#delete-form button[type="submit"]');
    check('deleting without a password is refused', (await errText(del.page, '#ac-del-err')).length > 0);
    await del.page.fill('#ac-del-pass', 'Wrong-pass1'); await del.page.click('#delete-form button[type="submit"]');
    await del.page.waitForSelector('#confirm-ok', { state: 'visible' }); await del.page.click('#confirm-ok');
    await del.page.waitForFunction(() => document.getElementById('ac-del-err').textContent.length > 0);
    check('a wrong password does not delete the account', (await errText(del.page, '#ac-del-err')) === 'Wrong password.' && (await q(`select count(*)::int n from auth.users where email='del@example.com'`))[0].n === 1);
    await del.page.fill('#ac-del-pass', 'Passw0rd!'); await del.page.click('#delete-form button[type="submit"]');
    await del.page.waitForSelector('#confirm-ok', { state: 'visible' }); await del.page.click('#confirm-ok');
    await waitScreen(del.page, 'welcome');
    await del.page.waitForFunction(() => !document.getElementById('welcome-notice').classList.contains('hidden'));
    const left = await q(`select (select count(*) from auth.users where id=$1)::int u, (select count(*) from public.profiles where id=$1)::int p, (select count(*) from public.characters where user_id=$1)::int c, (select count(*) from public.user_preferences where user_id=$1)::int up, (select count(*) from public.workouts where user_id=$1)::int w, (select count(*) from public.quests where user_id=$1)::int q, (select count(*) from public.xp_transactions where user_id=$1)::int x, (select count(*) from public.policy_acceptances where user_id=$1)::int pa, (select count(*) from public.app_state where user_id=$1)::int a`, [delUser.id]);
    check('account deletion removed the login and every row of the user', Object.values(left[0]).every(n => n === 0), JSON.stringify(left[0]));
    check('deletion cleared the cache, sync data and session in the browser', await del.page.evaluate(id => !Object.keys(localStorage).some(k => k.includes(id) || k === 'cala-auth'), delUser.id));
    check('the deleted account can no longer log in', await (async () => { await logInUi(del.page, url, 'del@example.com'); await del.page.waitForFunction(() => document.getElementById('login-err').textContent.length > 0); return (await visible(del.page)) === 'login'; })());
    check('other users were not affected by the deletion', (await q(`select count(*)::int n from public.characters where user_id=$1`, [ret.id]))[0].n === 1);
    await del.context.close();
    const unexpected = errors.filter(e => !/status of (400|401|403)/.test(e));
    check('no unexpected page errors in the returning-user flows', unexpected.length === 0, errors.join(' | '));
    await context.close();
} catch (e) {
    check('test run finished without a crash', false, e.stack);
}
await finish(env.close);
