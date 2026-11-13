// Screens: boot, setup, connect-error, welcome, signup, login, forgot, reset, verify, terms and privacy.
// Presentation and form handling only. The rules live in auth.js, the status in gate.js.
import * as auth from './auth.js';
import { gate, rememberPendingEmail, clearPendingEmail, endRecovery, acceptSession, recheckSession, logOut, takeNotice, takeLinkProblem, onGateChange } from './gate.js';
import { describeError, isNetworkError } from '../cloud/errors.js';
import { navigate, goBack, onScreenChange } from '../router.js';
import { switchMode } from '../state.js';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal.js';
import { showToast } from '../utils.js';

const $ = id => document.getElementById(id);

function setText(id, text) { const el = $(id); if (el) el.textContent = text || ''; }
function fieldError(inputId, message) {
    const input = $(inputId);
    const err = $(`${inputId}-err`) || $(`${inputId.replace(/-input$/, '')}-err`);
    if (input) { if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    if (err) err.textContent = message || '';
}
function clearErrors(form) {
    form.querySelectorAll('[aria-invalid]').forEach(i => i.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-err, .form-err').forEach(e => { e.textContent = ''; });
}
export function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); if (label) btn.textContent = label; }
    else { btn.disabled = false; btn.removeAttribute('aria-busy'); if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}

function renderRules(listId, value) {
    const ul = $(listId);
    if (!ul) return;
    ul.innerHTML = auth.PASSWORD_RULES.map(r => `<li class="${r.test(value) ? 'ok' : ''}">${r.label}</li>`).join('');
}

function showNotice(id, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
}

// ---- Resend cooldown (the email service limits how often it sends) ----
let cooldownTimer = null;
function startCooldown(seconds = 60) {
    const btn = $('verify-resend');
    let left = seconds;
    clearInterval(cooldownTimer);
    const tick = () => {
        if (left <= 0) { clearInterval(cooldownTimer); btn.disabled = false; btn.textContent = 'Send the email again'; return; }
        btn.disabled = true; btn.textContent = `Send again in ${left}s`; left -= 1;
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
}

let verifyPoll = null;
function stopPoll() { clearInterval(verifyPoll); verifyPoll = null; }
function startPoll() {
    stopPoll();
    verifyPoll = setInterval(async () => {
        if (document.hidden) return;
        try { await recheckSession(); } catch (e) { /* offline: keep waiting */ }
    }, 6000);
}

function renderVerify() {
    setText('verify-email', gate.email || gate.pendingEmail || 'your address');
    showNotice('verify-ok', '');
    setText('verify-err', '');
}

function wireSignup() {
    const form = $('signup-form');
    $('su-pass').addEventListener('input', e => renderRules('su-rules', e.target.value));
    renderRules('su-rules', '');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (form.dataset.busy) return;
        clearErrors(form);
        const email = $('su-email').value.trim();
        const pass = $('su-pass').value;
        const pass2 = $('su-pass2').value;
        const accepted = $('su-terms').checked;
        let bad = false;
        const eErr = auth.validateEmail(email); if (eErr) { fieldError('su-email', eErr); bad = true; }
        const pErr = auth.validatePassword(pass); if (pErr) { fieldError('su-pass', pErr); bad = true; }
        if (!pErr && pass !== pass2) { fieldError('su-pass2', 'The passwords do not match.'); bad = true; }
        if (!accepted) { setText('su-terms-err', 'Accept the terms and the privacy policy to continue.'); bad = true; }
        if (bad) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
        form.dataset.busy = '1';
        busy($('signup-btn'), true, 'Creating account…');
        try {
            const { session } = await auth.signUp(email, pass);
            $('su-pass').value = ''; $('su-pass2').value = '';
            if (session) { await acceptSession(session); return; }          // email confirmation is off in this project
            rememberPendingEmail(email);
            gate.email = email;
            renderVerify();
            startCooldown();
            navigate('verify', { replace: true });
        } catch (err) {
            if (err.code === 'email_exists') {
                setText('signup-err', 'An account with this email already exists. Log in instead, or reset your password.');
            } else setText('signup-err', describeError(err, 'The account could not be created. Try again.'));
        } finally { delete form.dataset.busy; busy($('signup-btn'), false); }
    });
}

function wireLogin() {
    const form = $('login-form');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (form.dataset.busy) return;
        clearErrors(form);
        const email = $('li-email').value.trim();
        const pass = $('li-pass').value;
        let bad = false;
        const eErr = auth.validateEmail(email); if (eErr) { fieldError('li-email', eErr); bad = true; }
        if (!pass) { fieldError('li-pass', 'Enter your password.'); bad = true; }
        if (bad) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
        form.dataset.busy = '1';
        busy($('login-btn'), true, 'Logging in…');
        try {
            const { session } = await auth.signIn(email, pass);
            $('li-pass').value = '';
            await acceptSession(session);
        } catch (err) {
            if ((err.code || err.error_code) === 'email_not_confirmed') {
                rememberPendingEmail(email); gate.email = email; renderVerify(); navigate('verify', { replace: true });
            } else setText('login-err', describeError(err, 'Could not log in. Try again.'));
        } finally { delete form.dataset.busy; busy($('login-btn'), false); }
    });
}

// Limits for reset emails, kept on this device so a reload does not reset them. The server has its own limits too.
const SEND_LOG = 'cala_reset_sends';
const SEND_GAP_S = 60;           // wait between two emails
const SEND_PER_HOUR = 5;         // at most this many per hour
const RATE_WAIT_S = 180;         // wait after the server says "too many"
const readSends = () => { try { return JSON.parse(localStorage.getItem(SEND_LOG) || '[]').filter(t => Date.now() - t < 3600e3); } catch (e) { return []; } };
const writeSends = list => { try { localStorage.setItem(SEND_LOG, JSON.stringify(list)); } catch (e) { /* ignore */ } };
const BLOCK = 'cala_reset_block';
const readBlock = () => { try { return Number(localStorage.getItem(BLOCK) || 0); } catch (e) { return 0; } };

// Seconds left before another email may be sent, and the reason ('gap', 'hour' or 'server').
export function resetWait() {
    const now = Date.now(), sends = readSends();
    const server = Math.ceil((readBlock() - now) / 1000);
    if (server > 0) return { s: server, why: 'server' };
    if (sends.length >= SEND_PER_HOUR) return { s: Math.ceil((sends[0] + 3600e3 - now) / 1000), why: 'hour' };
    const last = sends[sends.length - 1];
    if (last) { const gap = Math.ceil((last + SEND_GAP_S * 1000 - now) / 1000); if (gap > 0) return { s: gap, why: 'gap' }; }
    return { s: 0, why: null };
}

let forgotTimer = null, countdownMsg = false;
function paintForgotButton() {
    const btn = $('forgot-btn'), form = $('forgot-form');
    if (!btn || form.dataset.busy) return;
    clearTimeout(forgotTimer);
    const w = resetWait();
    const sent = readSends().length > 0;
    const idle = sent ? 'Send a new link' : 'Send reset link';
    if (w.s > 0) {
        btn.disabled = true;
        const mins = w.s > 90 ? `${Math.ceil(w.s / 60)} min` : `${w.s} s`;
        btn.textContent = `${idle} (${mins})`;
        countdownMsg = w.why !== 'gap';
        if (countdownMsg) setText('forgot-err', w.why === 'hour' ? `You have asked for ${SEND_PER_HOUR} links in the last hour. Try again in ${Math.ceil(w.s / 60)} min.`
            : w.why === 'server' ? 'Too many tries. The mail service needs a pause. Try again when the countdown ends.' : '');
        forgotTimer = setTimeout(paintForgotButton, 1000);
    } else {
        btn.disabled = false; btn.textContent = idle;
        if (countdownMsg) { setText('forgot-err', ''); countdownMsg = false; }
    }
}

const FORGOT_OK = 'If an account exists for this address, a reset link is on its way. Open it in this browser. Only the newest email works, so if you ask again, use the last one you get.';

function wireForgot() {
    const form = $('forgot-form');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (form.dataset.busy) return;
        clearErrors(form); showNotice('forgot-ok', '');
        const email = $('fg-email').value.trim();
        const eErr = auth.validateEmail(email);
        if (eErr) { fieldError('fg-email', eErr); $('fg-email').focus(); return; }
        if (resetWait().s > 0) { paintForgotButton(); return; }
        form.dataset.busy = '1';
        busy($('forgot-btn'), true, 'Sending…');
        try {
            await auth.sendPasswordReset(email);
            writeSends([...readSends(), Date.now()]);
            showNotice('forgot-ok', FORGOT_OK);
        } catch (err) {
            // The same message for known and unknown addresses, so the form does not reveal who has an account.
            if (isNetworkError(err)) setText('forgot-err', describeError(err));
            else if (/rate|429|over_/i.test(`${err.code} ${err.status} ${err.message}`)) {
                try { localStorage.setItem(BLOCK, String(Date.now() + RATE_WAIT_S * 1000)); } catch (e2) { /* ignore */ }
                setText('forgot-err', describeError(err));
            } else {
                writeSends([...readSends(), Date.now()]);
                showNotice('forgot-ok', FORGOT_OK);
            }
        } finally { delete form.dataset.busy; busy($('forgot-btn'), false); paintForgotButton(); }
    });
}

function wireReset() {
    const form = $('reset-form');
    $('rs-pass').addEventListener('input', e => renderRules('rs-rules', e.target.value));
    renderRules('rs-rules', '');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (form.dataset.busy) return;
        clearErrors(form);
        const pass = $('rs-pass').value;
        const pErr = auth.validatePassword(pass);
        if (pErr) { fieldError('rs-pass', pErr); $('rs-pass').focus(); return; }
        if (pass !== $('rs-pass2').value) { fieldError('rs-pass2', 'The passwords do not match.'); $('rs-pass2').focus(); return; }
        form.dataset.busy = '1';
        busy($('reset-btn'), true, 'Saving…');
        try {
            await auth.updatePassword(pass);
            $('rs-pass').value = ''; $('rs-pass2').value = '';
            await endRecovery();
            showToast('Password changed', 'Use the new password next time you log in.', { icon: 'check', tone: 'success' });
        } catch (err) { setText('reset-err', describeError(err, 'The password could not be changed. The link may have expired.')); }
        finally { delete form.dataset.busy; busy($('reset-btn'), false); }
    });
}

async function resend() {
    const email = gate.email || gate.pendingEmail;
    if (!email) { navigate('login'); return; }
    setText('verify-err', ''); showNotice('verify-ok', '');
    try {
        await auth.resendVerification(email);
        showNotice('verify-ok', 'Sent. It can take a minute to arrive.');
        startCooldown();
    } catch (err) {
        setText('verify-err', describeError(err, 'The email could not be sent. Try again in a minute.'));
        if (/rate|429|over_/i.test(`${err.code} ${err.status} ${err.message}`)) startCooldown();
    }
}

export function initAuthUi() {
    // An error under a field goes away as soon as the user edits it.
    document.addEventListener('input', e => {
        const i = e.target.closest?.('.field input');
        if (!i) return;
        i.removeAttribute('aria-invalid');
        const err = document.getElementById(`${i.id}-err`) || document.getElementById(`${i.id.replace(/-input$/, '')}-err`);
        if (err) err.textContent = '';
    });
    wireSignup(); wireLogin(); wireForgot(); wireReset();
    document.querySelectorAll('[data-policy="terms"]').forEach(e => { e.textContent = TERMS_VERSION; });
    document.querySelectorAll('[data-policy="privacy"]').forEach(e => { e.textContent = PRIVACY_VERSION; });

    document.addEventListener('click', async e => {
        const b = e.target.closest('[data-flow-action]');
        if (!b) return;
        switch (b.dataset.flowAction) {
            case 'demo': switchMode('demo'); break;
            case 'back': goBack(); break;
            case 'retry': location.reload(); break;
            case 'logout': await logOut(); break;
            case 'resend': await resend(); break;
            case 'check': {
                showNotice('verify-ok', ''); setText('verify-err', '');
                if (gate.status === 'unverified') {
                    try {
                        const st = await recheckSession();
                        if (st === 'unverified') setText('verify-err', 'Not verified yet. Open the link in the email first.');
                    } catch (err) { setText('verify-err', describeError(err)); }
                } else {
                    showNotice('verify-ok', 'Once you have opened the link, log in with your email and password.');
                }
                break;
            }
            case 'to-login': {
                if (gate.status === 'unverified') await logOut(); else { clearPendingEmail(); navigate('login'); }
                break;
            }
            default: break;
        }
    });

    onScreenChange(({ route }) => {
        stopPoll();
        if (route === 'verify') { renderVerify(); if (gate.status === 'unverified') startPoll(); }
        if (route === 'welcome' || route === 'login') {
            const n = takeNotice();
            showNotice(route === 'welcome' ? 'welcome-notice' : 'login-notice', n);
        }
        if (route === 'forgot') {
            const p = takeLinkProblem();
            if (p) setText('forgot-err', p);
            paintForgotButton();
        }
        if (route === 'connect-error') setText('connect-error-text', gate.notice || 'The server could not be reached.');
        if (route === 'login' && gate.pendingEmail && !$('li-email').value) $('li-email').value = gate.pendingEmail;
    });
    onGateChange(() => { if (document.getElementById('screen-verify') && !document.getElementById('screen-verify').hidden) renderVerify(); });
}
