// Onboarding: import prompt, character, goal, preferences, summary. Each step saves to the account before moving on.
// The server holds the step, so a user who leaves can log in anywhere and continue on the same screen.
import * as api from '../cloud/api.js';
import { gate, refreshAccount, onboardingRoute, afterImport, chooseFreshInsteadOfImport } from '../auth/gate.js';
import { importLegacy } from '../cloud/migrate.js';
import { describeError } from '../cloud/errors.js';
import { COSMETICS, COSMETIC_CATEGORIES, DEFAULT_SELECTION, getCosmetic, isDefaultItem } from '../cosmetics.js';
import { avatarHtml } from '../character-ui.js';
import { cleanName } from '../character.js';
import { navigate, onScreenChange } from '../router.js';
import { escapeHtml } from '../utils.js';
import { busy } from '../auth/ui.js';
import * as O from './options.js';

const $ = id => document.getElementById(id);
const say = (id, text) => { const el = $(id); if (el) el.textContent = text || ''; };
const ROUTES = ['ob-character', 'ob-goals', 'ob-prefs', 'ob-done'];

// ---- Character ----
const draft = { name: '', picks: { ...DEFAULT_SELECTION } };

function previewProfile() {
    const pick = cat => getCosmetic(draft.picks[cat]) || getCosmetic(DEFAULT_SELECTION[cat]);
    return { avatar: pick('avatar'), frame: pick('frame'), background: pick('background'), title: pick('title'), badge: pick('badge') };
}
function renderPreview(target) {
    const p = previewProfile();
    const name = cleanName(draft.name) || 'Your character';
    $(target).innerHTML = `${avatarHtml(p, { size: 30 })}<div><strong>${escapeHtml(name)}</strong><small>Level 1 · 0 XP · ${escapeHtml(p.title.name)}</small></div>`;
}

function renderCharacterOptions() {
    $('oc-options').innerHTML = COSMETIC_CATEGORIES.map(cat => {
        const items = COSMETICS.filter(c => c.category === cat.id);
        return `<fieldset class="opt-group"><legend>${escapeHtml(cat.label)}</legend><div class="opt-list opt-inline">${items.map(i => {
            const open = isDefaultItem(i);
            return `<label class="opt"><input type="radio" name="cos-${cat.id}" value="${i.id}"${draft.picks[cat.id] === i.id ? ' checked' : ''}${open ? '' : ' disabled'}>
                <span class="opt-text"><span>${escapeHtml(i.name)}</span>${open ? '' : `<small>Locked · ${escapeHtml(i.description)}</small>`}</span></label>`;
        }).join('')}</div></fieldset>`;
    }).join('');
}

function loadCharacterDraft() {
    const ch = gate.account?.character;
    if (ch) {
        draft.name = ch.name;
        draft.picks = { ...DEFAULT_SELECTION, avatar: ch.avatar_id, ...(ch.cosmetic_options || {}) };
    }
    $('oc-name').value = draft.name;
    renderCharacterOptions();
    renderPreview('oc-preview');
}

function wireCharacter() {
    $('oc-name').addEventListener('input', e => { draft.name = e.target.value; renderPreview('oc-preview'); });
    $('oc-options').addEventListener('change', e => {
        const m = /^cos-(.+)$/.exec(e.target.name || '');
        if (m) { draft.picks[m[1]] = e.target.value; renderPreview('oc-preview'); }
    });
    $('char-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;
        if (form.dataset.busy) return;
        say('oc-name-err', ''); say('char-err', ''); $('oc-name').removeAttribute('aria-invalid');
        const name = cleanName(draft.name);
        if (!name || /[<>]/.test(draft.name)) {
            say('oc-name-err', 'Use 1 to 20 characters for the name. No < or > signs.');
            $('oc-name').setAttribute('aria-invalid', 'true'); $('oc-name').focus(); return;
        }
        form.dataset.busy = '1'; busy($('char-btn'), true, 'Saving…');
        try {
            const { avatar, ...options } = draft.picks;
            await api.saveCharacter({ name, avatar, options });
            await refreshAccount();
            navigate('ob-goals');
        } catch (err) { say('char-err', describeError(err, 'Your character could not be saved. Try again.')); }
        finally { delete form.dataset.busy; busy($('char-btn'), false); }
    });
}

// ---- Goals ----
let syncGoals = () => {};
function loadGoals() {
    const p = gate.account?.preferences || {};
    O.renderGroup('og-primary', 'goal', O.GOALS, { selected: p.primary_goal });
    O.renderGroup('og-secondary', 'goal2', O.GOALS, { type: 'checkbox', selected: p.secondary_goals || [] });
    syncGoals();
}
function wireGoalsForm() {
    syncGoals = O.wireGoals('og-primary', 'og-secondary');
    $('goals-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;
        if (form.dataset.busy) return;
        say('goals-err', '');
        const primary = O.readGroup('og-primary');
        if (!primary) { say('goals-err', 'Pick one main goal.'); return; }
        form.dataset.busy = '1'; busy($('goals-btn'), true, 'Saving…');
        try {
            await api.saveGoals({ primary, secondary: O.readGroup('og-secondary', 'checkbox') });
            await refreshAccount();
            navigate('ob-prefs');
        } catch (err) { say('goals-err', describeError(err, 'Your goal could not be saved. Try again.')); }
        finally { delete form.dataset.busy; busy($('goals-btn'), false); }
    });
}

// ---- Preferences ----
function loadPrefs() {
    const p = gate.account?.preferences || {};
    O.renderGroup('op-experience', 'exp', O.EXPERIENCE, { selected: p.training_experience });
    O.renderGroup('op-environment', 'env', O.ENVIRONMENT, { selected: p.training_environment });
    O.renderGroup('op-equipment', 'eq', O.EQUIPMENT_OPTIONS, { type: 'checkbox', selected: p.available_equipment || [] });
    O.renderGroup('op-frequency', 'freq', O.FREQUENCY, { selected: p.weekly_training_frequency });
    O.renderGroup('op-duration', 'dur', O.DURATION, { selected: p.preferred_workout_duration });
}
export function readPrefs(prefix) {
    const g = (k, t) => O.readGroup(`${prefix}-${k}`, t);
    return { experience: g('experience'), environment: g('environment'), equipment: g('equipment', 'checkbox'), frequency: Number(g('frequency')) || null, duration: g('duration') };
}
export function prefsProblem(p) {
    if (!p.experience) return 'Choose your experience.';
    if (!p.environment) return 'Choose where you train.';
    if (!p.equipment.length) return 'Choose your equipment, or "No equipment".';
    if (!p.frequency) return 'Choose how many days a week.';
    if (!p.duration) return 'Choose how long a workout takes.';
    return null;
}
function wirePrefs() {
    O.wireEquipment('op-equipment');
    $('prefs-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;
        if (form.dataset.busy) return;
        say('prefs-err', '');
        const p = readPrefs('op');
        const problem = prefsProblem(p);
        if (problem) { say('prefs-err', problem); return; }
        form.dataset.busy = '1'; busy($('prefs-btn'), true, 'Saving…');
        try {
            await api.savePreferences(p);
            await refreshAccount();
            navigate('ob-done');
        } catch (err) { say('prefs-err', describeError(err, 'Your answers could not be saved. Try again.')); }
        finally { delete form.dataset.busy; busy($('prefs-btn'), false); }
    });
}

// ---- Summary ----
export function summaryRows(acct) {
    const p = acct?.preferences || {};
    const goals = [p.primary_goal, ...(p.secondary_goals || [])].filter(Boolean).map(g => O.labelOf(O.GOALS, g));
    const eq = (p.available_equipment || []).map(e => O.labelOf(O.EQUIPMENT_OPTIONS, e));
    return [
        ['Character', acct?.character?.name || ''],
        ['Goals', goals.join(', ')],
        ['Experience', O.labelOf(O.EXPERIENCE, p.training_experience)],
        ['Where', O.labelOf(O.ENVIRONMENT, p.training_environment)],
        ['Equipment', eq.join(', ')],
        ['Days per week', p.weekly_training_frequency ? (p.weekly_training_frequency >= 6 ? '6+' : String(p.weekly_training_frequency)) : ''],
        ['Minutes per workout', p.preferred_workout_duration || ''],
        ['Starting point', 'Level 1 · 0 XP']
    ];
}
function loadDone() {
    loadCharacterDraft();
    renderPreview('od-preview');
    $('od-summary').innerHTML = summaryRows(gate.account).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
}
function wireDone() {
    $('done-btn').addEventListener('click', async () => {
        const btn = $('done-btn');
        if (btn.disabled) return;
        say('done-err', ''); busy(btn, true, 'Starting…');
        try {
            await api.completeOnboarding();      // safe to repeat: it only sets the flag
            await refreshAccount();              // status becomes "ready", the app starts and quests are created
            navigate('home');
        } catch (err) { say('done-err', describeError(err, 'Setup could not be finished. Try again.')); }
        finally { busy(btn, false); }
    });
}

// ---- Import prompt ----
function loadImport() {
    const s = gate.legacy?.summary;
    say('import-summary', s ? `Found ${s.workouts} workout${s.workouts === 1 ? '' : 's'} and ${s.totalXp.toLocaleString()} XP (level ${s.level}), saved as "${s.name}".` : '');
    say('import-err', '');
}
function wireImport() {
    $('import-btn').addEventListener('click', async () => {
        const btn = $('import-btn');
        if (btn.disabled || !gate.legacy) return;
        say('import-err', ''); busy(btn, true, 'Importing…');
        try {
            await importLegacy(gate.uid, gate.legacy.data);
            await afterImport();
            navigate('home');
        } catch (err) {
            say('import-err', `${describeError(err, 'The import failed.')} Your data on this device is unchanged. Try again, or start fresh.`);
        } finally { busy(btn, false); }
    });
    $('import-skip').addEventListener('click', () => { chooseFreshInsteadOfImport(); navigate(onboardingRoute()); });
}

export function initOnboardingUi() {
    wireCharacter(); wireGoalsForm(); wirePrefs(); wireDone(); wireImport();
    document.addEventListener('click', e => {
        const b = e.target.closest('[data-flow-action="ob-back"]');
        if (!b) return;
        const i = ROUTES.indexOf(location.hash.replace('#', ''));
        navigate(i > 0 ? ROUTES[i - 1] : 'ob-character');
    });
    onScreenChange(({ route }) => {
        const i = ROUTES.indexOf(route);
        if (i >= 0) { const el = document.querySelector(`#screen-${route} [data-step-label]`); if (el) el.textContent = `Step ${i + 1} of ${ROUTES.length}`; }
        if (route === 'ob-import') loadImport();
        if (route === 'ob-character') loadCharacterDraft();
        if (route === 'ob-goals') loadGoals();
        if (route === 'ob-prefs') loadPrefs();
        if (route === 'ob-done') loadDone();
    });
}
