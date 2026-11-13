// Character card, attributes, cosmetics picker and training setup. Presentation only.
// Everything shown comes from getCharacterProfile() and getCosmeticStatus() in character.js.
import { getCharacterProfile, getCosmeticStatus, selectCosmetic, setCharacterName, setPreferences, EQUIPMENT, FOCUS_OPTIONS, MAX_NAME_LENGTH } from './character.js';
import { icon } from './icons.js';
import { escapeHtml, showToast } from './utils.js';
import { saveState } from './state.js';
import { on, EVT } from './events.js';

const $ = id => document.getElementById(id);

export function avatarHtml(profile, { size = 36 } = {}) {
    return `<span class="avatar-face bg-${profile.background.css} frame-${profile.frame.css}">${icon(profile.avatar.icon, { size })}</span>`;
}

function renderIdentity(p) {
    const dash = $('dash-avatar');
    if (dash) dash.innerHTML = avatarHtml(p, { size: 20 });
    if ($('dash-name')) $('dash-name').textContent = p.name;
    if ($('dash-title-text')) $('dash-title-text').textContent = p.title.name;

    const big = $('char-avatar');
    if (big) big.innerHTML = avatarHtml(p, { size: 40 }) + `<span class="avatar-level">${p.level}</span>`;
    const name = $('char-name');
    if (name && name.tagName === 'H3') name.textContent = p.name;
    if ($('char-title')) $('char-title').textContent = p.title.name;
    const badge = $('char-rank-badge');
    if (badge) badge.className = `rank-badge badge-${p.badge.css}`;
}

function renderAttributes(p) {
    const list = $('attr-list');
    if (!list) return;
    list.innerHTML = p.attributes.map(a => `
        <li class="attr">
            <span class="attr-icon" aria-hidden="true">${icon(a.icon, { size: 18 })}</span>
            <div class="attr-body">
                <div class="attr-top"><strong>${escapeHtml(a.label)}</strong><span class="attr-value" aria-label="${escapeHtml(a.label)} ${a.value}">${a.value}</span></div>
                <div class="progress progress-thin" role="progressbar" aria-label="${escapeHtml(a.label)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(a.pct)}"><div class="progress-fill" style="width:${a.pct}%"></div></div>
                <small>${escapeHtml(a.desc)} ${a.points === 0 ? 'No points yet.' : `${a.toNext} points to the next level.`}</small>
            </div>
        </li>`).join('');
}

function itemPreview(item) {
    if (item.category === 'avatar') return `<span class="cos-preview">${icon(item.icon, { size: 22 })}</span>`;
    if (item.category === 'frame') return `<span class="cos-preview"><span class="swatch frame-${item.css}"></span></span>`;
    if (item.category === 'background') return `<span class="cos-preview"><span class="swatch bg-${item.css}"></span></span>`;
    if (item.category === 'badge') return `<span class="cos-preview"><span class="rank-badge badge-${item.css}">${icon('award', { size: 12 })}</span></span>`;
    return `<span class="cos-preview cos-text">Aa</span>`;
}

function renderCosmetics() {
    const root = $('cosmetics');
    if (!root) return;
    root.innerHTML = getCosmeticStatus().map(cat => `
        <fieldset class="cos-group">
            <legend>${escapeHtml(cat.label)}</legend>
            <div class="cos-row">
                ${cat.items.map(i => `
                    <button type="button" class="cos-item${i.selected ? ' selected' : ''}${i.unlocked ? '' : ' locked'}" data-cosmetic="${i.id}"
                        aria-pressed="${i.selected}" ${i.unlocked ? '' : 'aria-disabled="true"'}>
                        ${itemPreview(i)}
                        <span class="cos-name">${escapeHtml(i.name)}</span>
                        <span class="cos-req">${i.unlocked ? (i.selected ? 'In use' : 'Unlocked') : `${icon('lock', { size: 12 })}${escapeHtml(i.description)}`}</span>
                    </button>`).join('')}
            </div>
        </fieldset>`).join('');
}

function renderSetup(p) {
    const eq = $('setup-equipment');
    if (eq) eq.innerHTML = EQUIPMENT.map(e => `
        <label class="check"><input type="checkbox" data-equipment="${e.id}" ${p.preferences.equipment.includes(e.id) ? 'checked' : ''}><span>${escapeHtml(e.label)}</span></label>`).join('') +
        '<p class="data-note">With no equipment selected, quests use floor exercises only.</p>';
    const focus = $('setup-focus');
    if (focus) focus.innerHTML = FOCUS_OPTIONS.map(f => `
        <button type="button" class="chip${p.preferences.focus === f.id ? ' active' : ''}" data-focus="${f.id}" aria-pressed="${p.preferences.focus === f.id}">${escapeHtml(f.label)}</button>`).join('');
}

export function renderCharacter() {
    const p = getCharacterProfile();
    renderIdentity(p);
    renderAttributes(p);
    renderCosmetics();
    renderSetup(p);
}

function startRename(onChange) {
    const h = $('char-name');
    if (!h || h.tagName !== 'H3') return;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'char-name';
    input.className = 'name-input';
    input.maxLength = MAX_NAME_LENGTH;
    input.value = h.textContent;
    input.setAttribute('aria-label', 'Character name');
    h.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = save => {
        if (done) return;
        done = true;
        const next = document.createElement('h3');
        next.id = 'char-name';
        input.replaceWith(next);
        if (save && setCharacterName(input.value)) { saveState(); onChange(); } else if (save && input.value.trim() === '') showToast('Name not changed', 'A name cannot be empty.', { icon: 'x', tone: 'gold' });
        renderCharacter();
    };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
}

export function initCharacterUi({ onChange }) {
    $('char-rename-btn')?.addEventListener('click', () => startRename(onChange));

    $('cosmetics')?.addEventListener('click', e => {
        const b = e.target.closest('[data-cosmetic]');
        if (!b) return;
        if (b.getAttribute('aria-disabled') === 'true') {
            showToast('Still locked', b.querySelector('.cos-req')?.textContent || 'Keep training to unlock it.', { icon: 'lock', tone: 'purple' });
            return;
        }
        if (selectCosmetic(b.dataset.cosmetic)) { saveState(); onChange(); }
    });

    $('setup-equipment')?.addEventListener('change', () => {
        const equipment = [...document.querySelectorAll('[data-equipment]')].filter(i => i.checked).map(i => i.dataset.equipment);
        setPreferences({ equipment });
        saveState();
        showToast('Training setup saved', 'New quests use this from tomorrow. Today\'s quests stay as they are.', { icon: 'check', tone: 'success' });
    });
    $('setup-focus')?.addEventListener('click', e => {
        const b = e.target.closest('[data-focus]');
        if (!b) return;
        setPreferences({ focus: b.dataset.focus });
        saveState();
        renderCharacter();
        showToast('Training setup saved', 'New quests use this from tomorrow. Today\'s quests stay as they are.', { icon: 'check', tone: 'success' });
    });

    on(EVT.COSMETIC_UNLOCKED, ({ item }) => showToast('Unlocked', `${item.name} (${item.category})`, { icon: 'sparkles', tone: 'purple' }));
    renderCharacter();
}
