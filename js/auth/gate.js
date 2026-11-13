// The app gate. One place that knows who the user is and what they may see.
//
// Status:
//   loading        starting up
//   unconfigured   no Supabase settings in js/env.js (demo mode still works)
//   connect-error  the account could not be reached and there is no cached copy to continue with
//   guest          not signed in
//   unverified     signed in but the email is not confirmed
//   recovery       opened a password reset link, must choose a new password
//   onboarding     signed in and verified, setup not finished (the server holds the step)
//   ready          signed in, verified, setup finished: the main app
//   demo           demo mode: separate data, no account, no network
//
// routeGuard() is given to the router. It answers "may this screen be shown?" for the first load,
// clicks, the back button and typed URLs alike.
import { getMode, initState, setUserSlot, userStateKey, state } from '../state.js';
import { isConfigured, getClient, AUTH_STORAGE_KEY } from '../cloud/client.js';
import * as auth from './auth.js';
import * as api from '../cloud/api.js';
import { applySnapshot, startSync, stopSync, clearSyncMeta, flush, flushBeforeLeaving, pendingWork } from '../cloud/sync.js';
import { findLegacy, legacyChoice, setLegacyChoice } from '../cloud/migrate.js';
import { isNetworkError, isSessionError } from '../cloud/errors.js';
import { revalidate } from '../router.js';

export const gate = { status: 'loading', uid: null, email: null, account: null, legacy: null, notice: null, offline: false, pendingEmail: null, recovery: false };
const listeners = new Set();
export const onGateChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

const GATE_CACHE = id => `cala_gate_u_${id}`;
const PENDING = 'cala_pending_email';
const NOTICE = 'cala_notice';

function set(patch) {
    Object.assign(gate, patch);
    listeners.forEach(fn => { try { fn(gate); } catch (e) { console.warn(e); } });
    revalidate();
}

// The copy of this account kept on this device. Without it there is nothing to show while offline.
const hasLocalCopy = id => { try { return !!localStorage.getItem(userStateKey(id)); } catch (e) { return false; } };
function readCache(id) { try { return JSON.parse(localStorage.getItem(GATE_CACHE(id)) || 'null'); } catch (e) { return null; } }
function writeCache(id, profile) { try { localStorage.setItem(GATE_CACHE(id), JSON.stringify({ onboarded: !!profile.onboarding_completed, step: profile.onboarding_step, at: Date.now() })); } catch (e) { /* ignore */ } }
export const gateCacheKey = GATE_CACHE;

// ---- Coming back from an email link ----
// A reset link opens the app with ?code=... (or ?error=... when it is no good). The app must then show the
// new-password screen, or a clear message, and never just the home page.
const fresh = key => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return !!v && Date.now() - v.at < auth.RESET_WINDOW_MS; } catch (e) { return false; } };
const resetLinkPending = () => fresh(auth.RESET_PENDING);
const resetActive = () => fresh(auth.RESET_ACTIVE);
export function clearResetMarks() { try { localStorage.removeItem(auth.RESET_PENDING); localStorage.removeItem(auth.RESET_ACTIVE); } catch (e) { /* ignore */ } }
export const LINK_PROBLEM = 'That link did not work. It may have expired, been used already, or been opened in another browser. Only the newest email works. Ask for a new link.';
let linkProblem = null;
export function takeLinkProblem() { const p = linkProblem; linkProblem = null; return p; }

// Runs before the router starts. Reads the address the email link came back to.
export function captureAuthReturn() {
    let params;
    try { params = new URLSearchParams(location.search.replace(/^\?/, '') + '&' + location.hash.replace(/^#\/?/, '')); } catch (e) { return; }
    const hasError = params.has('error') || params.has('error_code');
    const hasCode = new URLSearchParams(location.search).has('code');
    const reset = resetLinkPending();
    if (hasError) {
        // Remove the error from the address (it would otherwise be read as a screen name) and explain it.
        ['error', 'error_code', 'error_description'].forEach(k => params.delete(k));
        try { history.replaceState(history.state, '', location.pathname + (reset ? '#forgot' : '#welcome')); } catch (e) { /* ignore */ }
        if (reset) linkProblem = LINK_PROBLEM; else gate.notice = LINK_PROBLEM;
        return;
    }
    let signupWaiting = false;
    try { signupWaiting = !!sessionStorage.getItem(PENDING); } catch (e) { /* ignore */ }
    if (hasCode && reset && !signupWaiting) {
        // The code is read by the Supabase library later. From here on this browser is in password recovery.
        gate.recovery = true;
        try { localStorage.setItem(auth.RESET_ACTIVE, JSON.stringify({ at: Date.now() })); localStorage.removeItem(auth.RESET_PENDING); } catch (e) { /* ignore */ }
    }
}

export function takeNotice() {
    const n = gate.notice;
    gate.notice = null;
    return n;
}
export function setNotice(text) { gate.notice = text; }

// ---- Routes ----
const OPEN = new Set(['terms', 'privacy']);                  // readable by everyone
const GUEST_ROUTES = ['welcome', 'signup', 'login', 'forgot'];
const FLOW_ROUTES = new Set(['boot', 'setup', 'connect-error', 'welcome', 'signup', 'login', 'forgot', 'verify', 'reset', 'ob-import', 'ob-character', 'ob-goals', 'ob-prefs', 'ob-done']);
const ONBOARDING_ORDER = ['ob-import', 'ob-character', 'ob-goals', 'ob-prefs', 'ob-done'];

export function onboardingRoute() {
    if (gate.legacy) return 'ob-import';
    switch (gate.account?.profile?.onboarding_step) {
        case 'goals': return 'ob-goals';
        case 'preferences': return 'ob-prefs';
        case 'summary': return 'ob-done';
        default: return 'ob-character';
    }
}

export function routeGuard(route) {
    if (OPEN.has(route)) return null;
    switch (gate.status) {
        case 'loading': return route === 'boot' ? null : 'boot';
        case 'unconfigured': return route === 'setup' ? null : 'setup';
        case 'connect-error': return route === 'connect-error' ? null : 'connect-error';
        case 'guest': {
            const open = gate.pendingEmail ? [...GUEST_ROUTES, 'verify'] : GUEST_ROUTES;
            return open.includes(route) ? null : 'welcome';
        }
        case 'unverified': return route === 'verify' ? null : 'verify';
        case 'recovery': return route === 'reset' ? null : 'reset';
        case 'onboarding': {
            const current = onboardingRoute();
            if (!ONBOARDING_ORDER.includes(route)) return current;
            if (route === 'ob-import') return gate.legacy ? null : current;
            return ONBOARDING_ORDER.indexOf(route) <= ONBOARDING_ORDER.indexOf(current) ? null : current;
        }
        default:                                                 // ready, demo
            if (gate.status === 'demo' && (route === 'account' || route === 'preferences')) return 'profile';   // no account in demo mode
            return FLOW_ROUTES.has(route) ? 'home' : null;
    }
}

// ---- Loading the account ----
async function loadAccount(session) {
    const uid = session.user.id;
    setUserSlot(uid);
    initState();                      // the cached copy of this user, if any
    gate.recovery = false;
    try {
        let snap = await api.getProgress();
        writeCache(uid, snap.profile);
        if (snap.profile.onboarding_completed) {
            startSync();
            if (pendingWork().count > 0) { await flush(); snap = await api.getProgress(); }   // never overwrite changes that are not sent yet
            applySnapshot(snap);
            set({ status: 'ready', uid, email: session.user.email, account: snap, legacy: null, offline: false });
        } else {
            const legacy = findLegacy(uid);
            set({ status: 'onboarding', uid, email: session.user.email, account: snap, legacy, offline: false });
        }
    } catch (err) {
        if (isNetworkError(err)) {
            const cached = readCache(uid);
            if (cached?.onboarded && hasLocalCopy(uid)) {
                startSync();
                set({ status: 'ready', uid, email: session.user.email, account: null, legacy: null, offline: true });
                return;
            }
            set({ status: 'connect-error', uid, notice: 'The server could not be reached.' });
            return;
        }
        if (isSessionError(err)) { await dropSession('Your session has expired. Log in again.'); return; }
        set({ status: 'connect-error', uid, notice: 'Your account could not be loaded.' });
    }
}

// Everything that changes the status runs one after the other, so a login and its auth event never load the account twice.
let queue = Promise.resolve();
const enqueue = fn => { queue = queue.then(fn, fn).catch(e => console.warn(e)); return queue; };

async function doSettle(session) {
    if (!session) { stopSync(); setUserSlot(null); set({ status: 'guest', uid: null, email: null, account: null, legacy: null }); return; }
    if (!session.user.email_confirmed_at) { set({ status: 'unverified', uid: session.user.id, email: session.user.email }); return; }
    if (gate.recovery || resetActive()) { gate.recovery = true; set({ status: 'recovery', uid: session.user.id, email: session.user.email }); return; }
    try { sessionStorage.removeItem(PENDING); } catch (e) { /* ignore */ }
    gate.pendingEmail = null;
    await loadAccount(session);
}
const settle = session => enqueue(() => doSettle(session));
// Called by the login screen with the session it just got.
export const acceptSession = session => enqueue(async () => {
    if (gate.uid === session.user.id && (gate.status === 'ready' || gate.status === 'onboarding')) return;
    await doSettle(session);
});
// Verification check for the "I have verified" button and the poll.
export async function recheckSession() {
    const c = await getClient();
    let { data } = await c.auth.getSession();
    if (data.session && !data.session.user.email_confirmed_at) {
        try { await auth.refreshSession(); } catch (e) { /* offline: keep waiting */ }
        ({ data } = await c.auth.getSession());
    }
    if (data.session?.user.email_confirmed_at) await settle(data.session);
    return gate.status;
}

// A session that is no longer valid: forget it here, keep the cached copy (unsent changes stay safe for the next login).
async function dropSession(message) {
    stopSync();
    clearResetMarks(); gate.recovery = false;
    try { await auth.signOut(); } catch (e) { auth.clearAuthStorage(); }
    setUserSlot(null);
    set({ status: 'guest', uid: null, email: null, account: null, legacy: null, notice: message });
}

// Must return at once: supabase-js waits for this function before it sends the next event, and a password reset link
// produces SIGNED_IN and then PASSWORD_RECOVERY. The recovery flag therefore has to be set before the account loads.
function onAuthEvent(event, session) {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'PASSWORD_RECOVERY') gate.recovery = true;
    enqueue(async () => {
        if (event === 'SIGNED_IN') await new Promise(r => setTimeout(r, 0));   // let a PASSWORD_RECOVERY that follows right behind arrive first
        if (event === 'PASSWORD_RECOVERY') { await doSettle(session); return; }
        if (event === 'SIGNED_OUT') {
            if (gate.status !== 'guest' && gate.status !== 'loading') { stopSync(); setUserSlot(null); set({ status: 'guest', uid: null, email: null, account: null, legacy: null }); }
            return;
        }
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
            if (!session) return;
            const same = gate.uid === session.user.id;
            if (same && (gate.status === 'ready' || gate.status === 'onboarding' || gate.status === 'recovery') && !(gate.recovery && event === 'USER_UPDATED')) return;
            if (same && gate.status === 'unverified' && !session.user.email_confirmed_at) return;
            await doSettle(session);
        }
    });
}

export async function initGate() {
    if (getMode() === 'demo') { initState(); set({ status: 'demo' }); return gate.status; }
    try { gate.pendingEmail = sessionStorage.getItem(PENDING); } catch (e) { /* ignore */ }
    try { const n = sessionStorage.getItem(NOTICE); if (n) { gate.notice = n; sessionStorage.removeItem(NOTICE); } } catch (e) { /* ignore */ }
    try { localStorage.setItem('cala_probe', '1'); localStorage.removeItem('cala_probe'); }
    catch (e) { gate.notice = 'Your browser is blocking storage (private mode?). You cannot stay signed in or save progress until it is allowed.'; }
    if (!isConfigured()) { set({ status: 'unconfigured' }); return gate.status; }
    const hadCode = new URLSearchParams(location.search).has('code');
    try { await getClient(); } catch (e) { set({ status: 'connect-error', notice: 'The account library could not be loaded.' }); return gate.status; }
    await auth.onAuthEvent(onAuthEvent);
    let session = null;
    try { session = await auth.getSession(); } catch (err) {
        if (isNetworkError(err)) {
            // Offline start: use the session the library keeps on this device, if it is still valid.
            try {
                const raw = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
                if (raw?.user && raw.expires_at && raw.expires_at * 1000 > Date.now()) session = raw;
            } catch (e) { /* ignore */ }
        }
    }
    if (hadCode) {
        // The library removes the code from the address when it could use it. A code that is still there, or no session
        // after a code, means the link did not work (expired, used before, or another browser than the one that asked).
        try { const u = new URL(location.href); if (u.searchParams.has('code')) { u.searchParams.delete('code'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } } catch (e) { /* ignore */ }
        if (!session) {
            gate.recovery = false;
            try { localStorage.removeItem(auth.RESET_ACTIVE); } catch (e) { /* ignore */ }
            if (resetLinkPending()) { linkProblem = LINK_PROBLEM; try { history.replaceState(history.state, '', location.pathname + '#forgot'); } catch (e) { /* ignore */ } }
            else gate.notice = LINK_PROBLEM;
        }
    }
    await settle(session);
    return gate.status;
}

// ---- Actions used by the screens ----
export async function refreshAccount() {
    const snap = await api.getProgress();
    writeCache(gate.uid, snap.profile);
    if (snap.profile.onboarding_completed) {
        startSync();
        applySnapshot(snap);
        set({ status: 'ready', account: snap, legacy: null });
    } else {
        set({ account: snap });
    }
    return snap;
}

export function rememberPendingEmail(email) {
    gate.pendingEmail = email;
    try { sessionStorage.setItem(PENDING, email); } catch (e) { /* ignore */ }
    revalidate();
}
export function clearPendingEmail() {
    gate.pendingEmail = null;
    try { sessionStorage.removeItem(PENDING); } catch (e) { /* ignore */ }
}

export function chooseFreshInsteadOfImport() {
    setLegacyChoice(gate.uid, 'fresh');
    set({ legacy: null });
}
export async function afterImport() {
    await refreshAccount();
}
export const hasLegacyChoice = () => legacyChoice(gate.uid);

export async function endRecovery() {
    gate.recovery = false;
    clearResetMarks();
    const c = await getClient();
    const { data } = await c.auth.getSession();
    await settle(data.session);
}

export const gateState = () => gate;

export async function logOut() {
    let clean = true;
    try { clean = await flushBeforeLeaving(); } catch (e) { clean = false; }
    stopSync();
    clearResetMarks();
    try { await auth.signOut(); } catch (e) { auth.clearAuthStorage(); }
    clearPendingEmail();
    // The cached copy stays (so unsent changes survive until the next login). It is only readable after login.
    try { sessionStorage.setItem(NOTICE, clean ? 'You are logged out.' : 'You are logged out. Some changes were not sent yet. They stay on this device until you log in again.'); } catch (e) { /* ignore */ }
    location.hash = '#welcome';
    location.reload();
}

// Deletes the account and everything stored for it, here and on the server.
export async function deleteAccount(password) {
    await auth.confirmPassword(gate.email, password);
    await api.deleteMyAccount();
    const uid = gate.uid;
    stopSync();
    try { await auth.signOut(); } catch (e) { /* the user no longer exists on the server */ }
    auth.clearAuthStorage();
    try {
        localStorage.removeItem(userStateKey(uid));
        localStorage.removeItem(GATE_CACHE(uid));
        localStorage.removeItem(`cala_legacy_done_${uid}`);
        clearSyncMeta(uid);
        sessionStorage.setItem(NOTICE, 'Your account and its data were deleted.');
    } catch (e) { /* ignore */ }
    location.hash = '#welcome';
    location.reload();
}
