// Account actions on top of Supabase Auth. Passwords go straight to Supabase over HTTPS.
// They are never stored by the app (not in localStorage, not in state, not in any table).
import { getClient, AUTH_STORAGE_KEY } from '../cloud/client.js';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(value) {
    const v = String(value || '').trim();
    if (!v) return 'Enter your email address.';
    if (v.length > 254 || !EMAIL.test(v)) return 'That does not look like an email address.';
    return null;
}

export const PASSWORD_RULES = [
    { id: 'length', label: '8 or more characters', test: p => p.length >= 8 },
    { id: 'lower', label: 'A lower case letter', test: p => /[a-z]/.test(p) },
    { id: 'upper', label: 'An upper case letter', test: p => /[A-Z]/.test(p) },
    { id: 'digit', label: 'A number', test: p => /[0-9]/.test(p) }
];
export const passwordProblems = p => PASSWORD_RULES.filter(r => !r.test(String(p || ''))).map(r => r.label);
export function validatePassword(p) {
    if (!p) return 'Enter a password.';
    if (p.length > 72) return 'Use at most 72 characters.';
    const bad = passwordProblems(p);
    return bad.length ? `Password needs: ${bad.join(', ').toLowerCase()}.` : null;
}

// The link in the email brings the user back here. The address must be in the Supabase "Redirect URLs" list.
export const redirectUrl = () => `${location.origin}${location.pathname}`;

// supabase-js writes a new PKCE code verifier BEFORE it sends the request. A request that fails (for example a rate
// limit) would leave a verifier that does not belong to the email already on its way, and that email's link would
// stop working. So the old verifier is put back when the request fails.
const VERIFIER_KEY = `${AUTH_STORAGE_KEY}-code-verifier`;
async function keepVerifierOnError(run) {
    let before = null;
    try { before = localStorage.getItem(VERIFIER_KEY); } catch (e) { /* storage blocked */ }
    let failed = true;
    try {
        const result = await run();
        failed = !!result?.error;
        return result;
    } finally {
        if (failed) {
            try { if (before === null) localStorage.removeItem(VERIFIER_KEY); else localStorage.setItem(VERIFIER_KEY, before); } catch (e) { /* ignore */ }
        }
    }
}

export async function signUp(email, password) {
    const c = await getClient();
    const { data, error } = await keepVerifierOnError(() => c.auth.signUp({
        email: email.trim(),
        password,
        options: {
            emailRedirectTo: redirectUrl(),
            // Recorded by the database trigger together with the time. See supabase/migrations.
            data: { accepted_terms: TERMS_VERSION, accepted_privacy: PRIVACY_VERSION }
        }
    }));
    if (error) throw error;
    // With "Confirm email" on, Supabase answers an existing address with a user that has no identities (no error).
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        const e = new Error('email_exists');
        e.code = 'email_exists';
        throw e;
    }
    return { session: data.session, user: data.user };
}

export async function signIn(email, password) {
    const c = await getClient();
    const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    return data;
}

export async function signOut() {
    const c = await getClient();
    const { error } = await c.auth.signOut({ scope: 'local' });
    if (error && !/session/i.test(error.message)) throw error;
}

export async function resendVerification(email) {
    const c = await getClient();
    const { error } = await c.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectUrl() } });
    if (error) throw error;
}

// Remembers (on this device only) that a reset link is on its way. When a link comes back with a code while this
// mark is fresh, the app shows the new-password screen. The mark holds no secret.
export const RESET_PENDING = 'cala_reset_pending';
export const RESET_ACTIVE = 'cala_reset_active';
export const RESET_WINDOW_MS = 60 * 60 * 1000;      // the link in the email is valid for one hour

export async function sendPasswordReset(email) {
    const c = await getClient();
    const { error } = await keepVerifierOnError(() => c.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl() }));
    if (error) throw error;
    try { localStorage.setItem(RESET_PENDING, JSON.stringify({ at: Date.now() })); } catch (e) { /* ignore */ }
}

export async function updatePassword(password) {
    const c = await getClient();
    const { error } = await c.auth.updateUser({ password });
    if (error) throw error;
}

// Checks the password again without changing the session (used before account deletion).
export async function confirmPassword(email, password) {
    const c = await getClient();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
}

export async function getSession() {
    const c = await getClient();
    const { data, error } = await c.auth.getSession();
    if (error) throw error;
    return data.session;
}

export async function refreshSession() {
    const c = await getClient();
    const { data, error } = await c.auth.refreshSession();
    if (error) throw error;
    return data.session;
}

export async function onAuthEvent(fn) {
    const c = await getClient();
    return c.auth.onAuthStateChange((event, session) => { setTimeout(() => fn(event, session), 0); }); // never call Supabase inside the callback
}

// Removes what the Supabase library keeps on this device (the session). The app's own caches are cleared by the caller.
export function clearAuthStorage() {
    try {
        Object.keys(localStorage).filter(k => k.startsWith(AUTH_STORAGE_KEY)).forEach(k => localStorage.removeItem(k));
    } catch (e) { /* storage blocked */ }
}
