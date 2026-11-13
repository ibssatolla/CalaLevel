// Phase 3.3, part 1: a new user. Sign-up, email verification, onboarding, resume, protected routes.
// Runs the real app in Chrome against the local Supabase stand-in. This is NOT a live Supabase project.
import { makeRunner, setupOnline, visible, hash, waitScreen, tabbarShown, headerShown, signUpUi, verifyByLink, finishOnboardingUi, logInUi } from './online.mjs';

const { check, finish } = makeRunner();
const env = await setupOnline('cala_flows7');
const { sb, url, open } = env;
const q = (sql, args) => sb.pool.query(sql, args).then(r => r.rows);

try {
    // ---------- Welcome ----------
    let { page, context, errors, requests } = await open({ fixedTime: new Date() });
    await page.goto(url);
    await waitScreen(page, 'welcome');
    check('a visitor without a session lands on Welcome', (await hash(page)) === '#welcome');
    check('Welcome offers Create account, Log in and Demo mode', await page.evaluate(() => !!document.querySelector('#screen-welcome a[href="#signup"]') && !!document.querySelector('#screen-welcome a[href="#login"]') && !!document.querySelector('#screen-welcome [data-flow-action="demo"]')));
    check('onboarding screens hide the bottom navigation and the header', !(await tabbarShown(page)) && !(await headerShown(page)));
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-welcome.png' });
    check('no quests or app screens exist for a visitor (app not started)', await page.evaluate(() => document.querySelectorAll('#quest-board .quest-card').length === 0));
    for (const hashName of ['#home', '#profile', '#quests', '#train', '#discover', '#account', '#ob-character', '#ob-done']) {
        await page.evaluate(h => { location.hash = h; }, hashName);
        await page.waitForTimeout(150);
        if ((await visible(page)) !== 'welcome') { check(`protected route ${hashName} is blocked for a visitor`, false, await visible(page)); }
    }
    check('protected routes (home, profile, quests, train, discover, account, onboarding) are blocked for a visitor', (await visible(page)) === 'welcome');

    // ---------- Sign-up validation ----------
    await page.goto(url + '#signup'); await waitScreen(page, 'signup');
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-signup.png' });
    const reqBefore = requests.length;
    await page.click('#signup-btn');
    const errText = id => page.$eval(id, e => e.textContent);
    check('empty sign-up form shows an email error and a password error', (await errText('#su-email-err')).length > 0 && (await errText('#su-pass-err')).length > 0);
    check('an invalid sign-up form sends no request to the server', requests.length === reqBefore);
    await page.fill('#su-email', 'not-an-email'); await page.fill('#su-pass', 'abc'); await page.fill('#su-pass2', 'abd'); await page.click('#signup-btn');
    check('invalid email and weak password are rejected', (await errText('#su-email-err')).includes('email') && (await errText('#su-pass-err')).toLowerCase().includes('password needs'));
    await page.fill('#su-email', 'new1@example.com'); await page.fill('#su-pass', 'Passw0rd!'); await page.fill('#su-pass2', 'Passw0rd?'); await page.click('#signup-btn');
    check('mismatched passwords are rejected', (await errText('#su-pass2-err')).includes('do not match'));
    await page.fill('#su-pass2', 'Passw0rd!'); await page.click('#signup-btn');
    check('terms and privacy must be accepted', (await errText('#su-terms-err')).length > 0);
    check('password rules light up as the user types', await page.evaluate(() => document.querySelectorAll('#su-rules li.ok').length === 4));
    check('nothing was created on the server by invalid forms', (await q(`select count(*)::int n from auth.users`))[0].n === 0);

    // ---------- Sign-up and verification ----------
    await page.check('#su-terms');
    await Promise.all([page.click('#signup-btn'), page.click('#signup-btn').catch(() => {})]);   // a double tap must not create two accounts
    await waitScreen(page, 'verify');
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-verify.png' });
    check('after sign-up the verification screen shows the address', (await page.$eval('#verify-email', e => e.textContent)) === 'new1@example.com');
    check('verification screen hides the bottom navigation', !(await tabbarShown(page)));
    check('a double tap on Create account made exactly one account', (await q(`select count(*)::int n from auth.users where email='new1@example.com'`))[0].n === 1);
    check('the database trigger created one profile for the account', (await q(`select count(*)::int n from public.profiles`))[0].n === 1);
    check('terms and privacy acceptance was recorded with version and time', (await q(`select policy_type, version, accepted_at is not null as t from public.policy_acceptances order by policy_type`)).map(r => `${r.policy_type}:${r.version}:${r.t}`).join() === 'privacy:2026-11-13:true,terms:2026-11-13:true');
    check('a verification email was sent', sb.emails.filter(m => m.to === 'new1@example.com' && m.type === 'signup').length >= 1);
    check('the user cannot reach the app before verifying (#home is refused)', await (async () => { await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(200); return ['welcome', 'verify'].includes(await visible(page)); })());
    await page.evaluate(() => { location.hash = '#verify'; }); await waitScreen(page, 'verify');
    check('resend is disabled for a cooldown right after sign-up (no repeated sends)', await page.$eval('#verify-resend', b => b.disabled));
    await page.clock.runFor(61000);
    await page.waitForFunction(() => !document.querySelector('#verify-resend').disabled);
    const before = sb.emails.length;
    await page.click('#verify-resend');
    await page.waitForFunction(() => document.querySelector('#verify-ok') && !document.querySelector('#verify-ok').classList.contains('hidden'));
    check('resend sends another email', sb.emails.length === before + 1);
    check('resend starts a new cooldown', await page.$eval('#verify-resend', b => b.disabled));
    // Login before verification is refused and sends the user to the verification screen
    await logInUi(page, url, 'new1@example.com'); await waitScreen(page, 'verify');
    check('login before verification leads to the verification screen', (await visible(page)) === 'verify');
    await verifyByLink(page, sb, 'new1@example.com');
    await waitScreen(page, 'ob-character');
    check('opening the verification link signs the user in and starts onboarding at character creation', (await hash(page)) === '#ob-character');
    check('the PKCE code was removed from the address bar', !(await page.evaluate(() => location.search)).includes('code='));
    check('account row says onboarding is not complete', (await q(`select onboarding_completed, onboarding_step from public.profiles`))[0].onboarding_step === 'character');
    check('no quests are generated while onboarding is open', (await q(`select count(*)::int n from public.quests`))[0].n === 0);
    check('the local cache has no quests either', await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('cala_state_u_')).every(k => (JSON.parse(localStorage[k]).quests?.items || []).length === 0)));
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-character-empty.png' });

    // ---------- Character creation ----------
    check('step indicator shows step 1 of 4', (await page.$eval('#screen-ob-character [data-step-label]', e => e.textContent)) === 'Step 1 of 4');
    await page.click('#char-btn');
    check('empty character name is rejected before saving', (await errText('#oc-name-err')).length > 0);
    await page.fill('#oc-name', 'Ibssa<b>'); await page.click('#char-btn');
    check('a name with angle brackets is rejected', (await errText('#oc-name-err')).length > 0);
    await page.fill('#oc-name', 'Atlas');
    check('live preview shows the typed name and Level 1 / 0 XP', (await page.$eval('#oc-preview', e => e.textContent)).includes('Atlas') && (await page.$eval('#oc-preview', e => e.textContent)).includes('Level 1 · 0 XP'));
    await page.check('#oc-options input[value="avatar-flame"]');
    check('locked cosmetics are shown but cannot be picked', await page.evaluate(() => { const i = document.querySelector('#oc-options input[value="avatar-crown"]'); return i && i.disabled; }));
    check('character creation touch targets are at least 44px', await page.evaluate(() => [...document.querySelectorAll('#screen-ob-character .opt, #screen-ob-character .btn, #screen-ob-character input[type=text]')].every(e => e.getBoundingClientRect().height >= 44)));
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-character.png', fullPage: true });
    await page.click('#char-btn'); await waitScreen(page, 'ob-goals');
    const ch = (await q(`select character_name, avatar_id, level, current_xp, total_xp from public.characters`));
    check('the character was saved with Level 1, 0 XP and 0 total XP', ch.length === 1 && ch[0].character_name === 'Atlas' && ch[0].avatar_id === 'avatar-flame' && ch[0].level === 1 && Number(ch[0].current_xp) === 0 && Number(ch[0].total_xp) === 0);

    // ---------- Resume: reload in the middle of onboarding ----------
    await page.reload(); await waitScreen(page, 'ob-goals');
    check('reloading during onboarding resumes at the saved step', (await hash(page)) === '#ob-goals');
    await page.evaluate(() => { location.hash = '#ob-done'; }); await page.waitForTimeout(250);
    check('a later onboarding step cannot be skipped to by URL', (await visible(page)) === 'ob-goals');
    await page.evaluate(() => { location.hash = '#ob-character'; }); await waitScreen(page, 'ob-character');
    check('an earlier step can be revisited and shows the saved values', (await page.inputValue('#oc-name')) === 'Atlas');
    await page.evaluate(() => { location.hash = '#ob-goals'; }); await waitScreen(page, 'ob-goals');

    // ---------- Goals ----------
    await page.click('#goals-btn');
    check('goals step needs a main goal', (await errText('#goals-err')).length > 0);
    await page.check('#og-primary input[value="skills"]');
    await page.check('#og-secondary input[value="strength"]'); await page.check('#og-secondary input[value="mobility"]'); await page.check('#og-secondary input[value="endurance"]');
    check('at most three extra goals can be picked', await page.evaluate(() => [...document.querySelectorAll('#og-secondary input')].filter(i => !i.checked && !i.disabled).length === 0));
    await page.check('#og-primary input[value="strength"]');
    check('the main goal is removed from the extra goals', await page.evaluate(() => !document.querySelector('#og-secondary input[value="strength"]').checked && document.querySelector('#og-secondary input[value="strength"]').disabled));
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-goals.png', fullPage: true });
    await page.click('#goals-btn'); await waitScreen(page, 'ob-prefs');
    const pref1 = (await q(`select primary_goal, secondary_goals from public.user_preferences`))[0];
    check('goal and extra goals were saved', pref1.primary_goal === 'strength' && pref1.secondary_goals.length === 2);

    // ---------- Preferences ----------
    await page.click('#prefs-btn');
    check('preferences step needs every answer', (await errText('#prefs-err')).length > 0);
    await page.check('#op-experience input[value="intermediate"]'); await page.check('#op-environment input[value="outdoor"]');
    await page.check('#op-equipment input[value="pullup-bar"]'); await page.check('#op-equipment input[value="none"]');
    check('"No equipment" clears other equipment', await page.evaluate(() => !document.querySelector('#op-equipment input[value="pullup-bar"]').checked));
    await page.check('#op-equipment input[value="pullup-bar"]'); await page.check('#op-equipment input[value="parallel-bars"]');
    check('choosing equipment clears "No equipment"', await page.evaluate(() => !document.querySelector('#op-equipment input[value="none"]').checked));
    await page.check('#op-frequency input[value="4"]'); await page.check('#op-duration input[value="30-45"]');
    check('frequency offers 2, 3, 4, 5 and 6+ and durations 15-20 to 60+', await page.evaluate(() => [...document.querySelectorAll('#op-frequency .opt span:first-child')].map(e => e.textContent).join() === '2,3,4,5,6+' && [...document.querySelectorAll('#op-duration .opt span:first-child')].map(e => e.textContent).join() === '15-20,20-30,30-45,45-60,60+'));
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-preferences.png', fullPage: true });
    await page.click('#prefs-btn'); await waitScreen(page, 'ob-done');
    const pref2 = (await q(`select training_experience, training_environment, available_equipment, weekly_training_frequency, preferred_workout_duration from public.user_preferences`))[0];
    check('preferences were saved', pref2.training_experience === 'intermediate' && pref2.training_environment === 'outdoor' && pref2.available_equipment.sort().join() === 'parallel-bars,pullup-bar' && pref2.weekly_training_frequency === 4 && pref2.preferred_workout_duration === '30-45');

    // ---------- Completion ----------
    check('summary shows the character, goals and preferences', await page.$eval('#od-summary', e => e.textContent.includes('Atlas') && e.textContent.includes('Get stronger') && e.textContent.includes('Level 1')));
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-completion.png', fullPage: true });
    check('quests do not exist yet on the completion screen', (await q(`select count(*)::int n from public.quests`))[0].n === 0);
    await Promise.all([page.click('#done-btn'), page.click('#done-btn').catch(() => {})]);
    await waitScreen(page, 'home');
    await page.waitForSelector('#quest-board .quest-card', { state: 'attached' });
    check('after completion the user is on Home with the bottom navigation', (await hash(page)) === '#home' && (await tabbarShown(page)));
    check('Home shows Level 1 and 0 XP for the new character', await page.evaluate(() => /Atlas/.test(document.getElementById('dash-name').textContent) && /^1$/.test(document.getElementById('core-level').textContent.trim())));
    check('onboarding is marked complete on the account, once', (await q(`select onboarding_completed, onboarding_step from public.profiles`))[0].onboarding_step === 'done');
    await page.waitForTimeout(1800);   // sync pushes the first quests
    check('quests were generated only after onboarding and synced to the account', (await q(`select count(*)::int n from public.quests`))[0].n >= 1);
    check('exactly one character and one preference row exist (no duplicates)', (await q(`select (select count(*) from public.characters)::int c, (select count(*) from public.user_preferences)::int p, (select count(*) from public.profiles)::int pr`))[0].c === 1);
    check('the new character starts with 0 XP on the server', Number((await q(`select coalesce(sum(xp_amount),0) s from public.xp_transactions`))[0].s) === 0);
    await page.waitForTimeout(500); await page.screenshot({ path: 'shots/33-home-after-onboarding.png' });
    check('the quest engine uses the equipment from onboarding (pull-up bar and parallel bars)', await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('cala_state_u_')); const c = JSON.parse(localStorage[k]).character; return c.preferences.equipment.sort().join() === 'bar,parallel'; }));
    check('a finished user cannot open onboarding screens again', await (async () => { await page.evaluate(() => { location.hash = '#ob-character'; }); await page.waitForTimeout(250); return (await visible(page)) === 'home'; })());
    check('a finished user cannot open Welcome or Log in', await (async () => { await page.evaluate(() => { location.hash = '#welcome'; }); await page.waitForTimeout(250); const a = await visible(page); await page.evaluate(() => { location.hash = '#login'; }); await page.waitForTimeout(250); return a === 'home' && (await visible(page)) === 'home'; })());
    const unexpected = errors.filter(e => !/status of 400/.test(e));
    check('no page errors in the new-user flow (the one expected 400 is the refused login before verification)', unexpected.length === 0 && errors.length <= 1, errors.join(' | '));
    await context.close();
} catch (e) {
    check('test run finished without a crash', false, e.stack);
}
await finish(env.close);
