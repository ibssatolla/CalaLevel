// Profile > Account settings, Profile > Goals and preferences, and the account card on the Profile screen.
import * as api from '../cloud/api.js';
import { getClient } from '../cloud/client.js';
import { gate, refreshAccount, logOut, deleteAccount, afterImport } from './gate.js';
import { getSyncInfo, onSyncChange, flush } from '../cloud/sync.js';
import { findLegacy, importLegacy } from '../cloud/migrate.js';
import { describeError } from '../cloud/errors.js';
import { isDemo } from '../state.js';
import { onScreenChange } from '../router.js';
import { confirmDialog, showToast } from '../utils.js';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal.js';
import { busy } from './ui.js';
import * as O from '../onboarding/options.js';
import { readPrefs, prefsProblem } from '../onboarding/ui.js';

const $ = id => document.getElementById(id);
const say = (id, t) => { const el = $(id); if (el) el.textContent = t || ''; };
const note = (id, t) => { const el = $(id); if (el) { el.textContent = t || ''; el.classList.toggle('hidden', !t); } };

export function syncText(info = getSyncInfo()) {
    if (gate.offline && info.status !== 'syncing') return { tone: 'warn', text: info.pending ? `Offline. ${info.pending} change${info.pending === 1 ? '' : 's'} will be sent when you are back online.` : 'Offline. Your progress is saved on this device.' };
    switch (info.status) {
        case 'syncing': return { tone: 'warn', text: 'Syncing…' };
        case 'offline': return { tone: 'warn', text: `Offline. ${info.pending} change${info.pending === 1 ? '' : 's'} will be sent when you are back online.` };
        case 'error': return { tone: 'warn', text: info.problem === 'session' ? 'Your session expired. Log in again to send your changes.' : 'Some changes could not be sent. They stay on this device and the app will try again.' };
        default: return info.pending > 0
            ? { tone: 'warn', text: `${info.pending} change${info.pending === 1 ? '' : 's'} waiting to be sent.` }
            : { tone: 'ok', text: info.lastSyncedAt ? `Everything is saved to your account. Last sync ${new Date(info.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Everything is saved to your account.' };
    }
}

async function renderAccount() {
    say('ac-email', gate.email || '');
    const username = gate.account?.profile?.username || '';
    say('ac-username', username || 'Not set');
    $('ac-user-input').value = username;
    renderSync();
    const ok = gate.account?.policies_accepted;
    say('ac-policies', `Terms ${TERMS_VERSION} and privacy policy ${PRIVACY_VERSION}. ${ok === false ? 'You have not accepted the current versions.' : 'Accepted.'}`);
    try {
        const c = await getClient();
        const { data } = await c.from('policy_acceptances').select('policy_type,version,accepted_at').order('accepted_at', { ascending: false });
        if (data?.length) say('ac-policies', data.map(a => `${a.policy_type === 'terms' ? 'Terms' : 'Privacy policy'} ${a.version}, accepted ${new Date(a.accepted_at).toLocaleString()}`).join('. ') + '.');
    } catch (e) { /* offline: keep the short text */ }
    const legacy = findLegacy(gate.uid, { ignoreChoice: true });
    $('ac-import-btn').classList.toggle('hidden', !legacy);
}
function renderSync() {
    const { tone, text } = syncText();
    const el = $('ac-sync');
    if (el) el.innerHTML = `<span class="sync-dot ${tone}" aria-hidden="true"></span>${text.replace(/</g, '&lt;')}`;
}

function wireAccount() {
    $('username-form').addEventListener('submit', async e => {
        e.preventDefault();
        say('ac-user-err', '');
        const v = $('ac-user-input').value.trim();
        if (!v) { say('ac-user-err', 'Enter a username.'); return; }
        try { await api.setUsername(v); await refreshAccount(); renderAccount(); showToast('Saved', 'Username updated.', { icon: 'check', tone: 'success' }); }
        catch (err) { say('ac-user-err', describeError(err, 'The username could not be saved.')); }
    });
    $('ac-sync-btn').addEventListener('click', async () => { try { await flush(); } catch (e) { /* shown in the status */ } renderSync(); });
    $('ac-logout').addEventListener('click', async () => { $('ac-logout').disabled = true; await logOut(); });
    $('ac-import-btn').addEventListener('click', async () => {
        const legacy = findLegacy(gate.uid, { ignoreChoice: true });
        if (!legacy) return;
        const ok = await confirmDialog({ title: 'Import progress from this device?', message: `Adds ${legacy.summary.workouts} workouts and ${legacy.summary.totalXp.toLocaleString()} XP to your account. Only works while your account has no progress. The data on this device is kept.`, confirmLabel: 'Import' });
        if (!ok) return;
        try { await importLegacy(gate.uid, legacy.data); await afterImport(); location.reload(); }
        catch (err) { showToast('Import failed', `${describeError(err, 'The import failed.')} Your data on this device is unchanged.`, { icon: 'shield', tone: 'gold' }); }
    });
    $('delete-form').addEventListener('submit', async e => {
        e.preventDefault();
        const submit = e.currentTarget.querySelector('button[type="submit"]');
        say('ac-del-err', '');
        const pass = $('ac-del-pass').value;
        if (!pass) { say('ac-del-err', 'Enter your password to confirm.'); return; }
        const ok = await confirmDialog({ title: 'Delete your account?', message: 'Your login, character, workouts, quests and XP are deleted for good. This cannot be undone.', confirmLabel: 'Delete account', danger: true });
        if (!ok) return;
        busy(submit, true, 'Deleting…');
        try { await deleteAccount(pass); }
        catch (err) { busy(submit, false); say('ac-del-err', (err.code || err.error_code) === 'invalid_credentials' ? 'Wrong password.' : describeError(err, 'The account could not be deleted. Nothing was removed.')); }
        finally { $('ac-del-pass').value = ''; }
    });
}

// ---- Goals and preferences (edit) ----
let syncGoals = () => {};
function loadEdit() {
    const p = gate.account?.preferences || {};
    O.renderGroup('ep-primary', 'egoal', O.GOALS, { selected: p.primary_goal });
    O.renderGroup('ep-secondary', 'egoal2', O.GOALS, { type: 'checkbox', selected: p.secondary_goals || [] });
    O.renderGroup('ep-experience', 'eexp', O.EXPERIENCE, { selected: p.training_experience });
    O.renderGroup('ep-environment', 'eenv', O.ENVIRONMENT, { selected: p.training_environment });
    O.renderGroup('ep-equipment', 'eeq', O.EQUIPMENT_OPTIONS, { type: 'checkbox', selected: p.available_equipment || [] });
    O.renderGroup('ep-frequency', 'efreq', O.FREQUENCY, { selected: p.weekly_training_frequency });
    O.renderGroup('ep-duration', 'edur', O.DURATION, { selected: p.preferred_workout_duration });
    syncGoals(); say('edit-err', ''); note('edit-ok', '');
}
function wireEdit() {
    syncGoals = O.wireGoals('ep-primary', 'ep-secondary');
    O.wireEquipment('ep-equipment');
    $('edit-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;
        if (form.dataset.busy) return;
        say('edit-err', ''); note('edit-ok', '');
        const primary = O.readGroup('ep-primary');
        if (!primary) { say('edit-err', 'Pick one main goal.'); return; }
        const p = readPrefs('ep');
        const problem = prefsProblem(p);
        if (problem) { say('edit-err', problem); return; }
        form.dataset.busy = '1'; busy($('edit-btn'), true, 'Saving…');
        try {
            await api.saveGoals({ primary, secondary: O.readGroup('ep-secondary', 'checkbox') });
            await api.savePreferences(p);
            await refreshAccount();      // rebuilds the quest engine settings from the account
            note('edit-ok', 'Saved. New quests use these settings from tomorrow.');
        } catch (err) { say('edit-err', describeError(err, 'Your changes could not be saved. Try again.')); }
        finally { delete form.dataset.busy; busy($('edit-btn'), false); }
    });
}

// ---- Profile card ----
export function renderProfileAccountCard() {
    const card = $('profile-account-card');
    const setup = $('profile-setup-card');
    if (!card) return;
    const demo = isDemo();
    card.classList.toggle('hidden', demo);
    setup?.classList.toggle('hidden', !demo);          // the old controls stay for demo mode only
    if (!demo) {
        const { text } = syncText();
        say('pa-text', `${gate.email ? `Signed in as ${gate.email}. ` : ''}${text}`);
    }
}

export function initAccountUi() {
    wireAccount(); wireEdit();
    onSyncChange(() => { renderSync(); renderProfileAccountCard(); });
    onScreenChange(({ route }) => {
        if (route === 'account') renderAccount();
        if (route === 'preferences') loadEdit();
        if (route === 'profile') renderProfileAccountCard();
    });
}
