// The one Supabase client. The browser library (vendor/supabase.js) is loaded only when a real account is used,
// so demo mode never downloads it and never talks to any server.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../env.js';

export const AUTH_STORAGE_KEY = 'cala-auth';
let client = null;
let loading = null;

export const isConfigured = () => /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (window.supabase?.createClient) { resolve(); return; }
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = () => reject(new Error('Could not load the account library.'));
        document.head.appendChild(el);
    });
}

// Resolves to the client, or throws when the library cannot be loaded. Safe to call many times.
export function getClient() {
    if (client) return Promise.resolve(client);
    if (!isConfigured()) return Promise.reject(new Error('not_configured'));
    loading ||= loadScript('vendor/supabase.js').then(() => {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                // PKCE keeps tokens out of the URL hash, which the screen router uses.
                flowType: 'pkce',
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: AUTH_STORAGE_KEY
            }
        });
        return client;
    }).catch(err => { loading = null; throw err; });
    return loading;
}

// The client if it is already loaded (never loads it).
export const peekClient = () => client;
