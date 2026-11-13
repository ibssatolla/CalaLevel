// Skill tree: four states (locked, ready to unlock, unlocked, mastered), curved links, detail panel with requirements.
import { state, saveState } from './state.js';
import { checkSkillUnlock, unlockSkill, getAvailableXp, getLevel } from './progression.js';
import { icon, skillIcons } from './icons.js';
import { escapeHtml, showToast, confirmDialog } from './utils.js';

const LABEL = { locked: 'Locked', available: 'Ready to unlock', unlocked: 'Unlocked', mastered: 'Mastered' };
const BADGE = { locked: 'badge', available: 'badge badge-secondary', unlocked: 'badge badge-primary', mastered: 'badge badge-gold' };
const DESC = {
    pushup: 'The base of every pushing skill. Keep the body in one line and use the full range.',
    dips: 'Builds pressing strength for the muscle-up and the planche.',
    pullup: 'Builds pulling strength for the muscle-up and the front lever.',
    muscleup: 'A pull that turns into a dip over the bar. Needs strong pull-ups and dips.',
    frontlever: 'A straight-body hold under the bar. Needs a strong pull-up base.',
    planche: 'A straight-body hold on the hands. Needs a strong dip base.'
};

let selectedId = null;
let justUnlocked = null;
let onUnlocked = () => {};

const $ = id => document.getElementById(id);
const find = id => state.data.skills.find(s => s.id === id);

// Display state: "available" means every requirement is met right now.
function displayState(skill) {
    if (skill.status !== 'locked') return skill.status;
    return checkSkillUnlock(skill.id).ok ? 'available' : 'locked';
}

function defaultSelection() {
    const { skills } = state.data;
    return (skills.find(s => displayState(s) === 'available')
        || skills.find(s => s.status === 'locked' && s.parents.every(p => find(p)?.status !== 'locked'))
        || skills[0])?.id ?? null;
}

function renderTree() {
    const container = $('skill-tree-container');
    if (!container) return;
    const { skills } = state.data;

    const paths = skills.flatMap(skill => skill.parents.map(pid => {
        const p = find(pid);
        if (!p) return '';
        const mid = (p.y + skill.y) / 2;
        const cls = skill.status !== 'locked' ? 'open' : displayState(skill) === 'available' ? 'ready' : '';
        return `<path class="link ${cls}" d="M${p.x} ${p.y} C${p.x} ${mid}, ${skill.x} ${mid}, ${skill.x} ${skill.y}"/>`;
    })).join('');

    const nodes = skills.map(skill => {
        const st = displayState(skill);
        const badge = st === 'locked' ? 'lock' : st === 'available' ? 'plus' : st === 'mastered' ? 'star' : 'check';
        return `
            <button type="button" class="node node-${st}${skill.id === selectedId ? ' selected' : ''}${skill.id === justUnlocked ? ' just-unlocked' : ''}"
                style="left:${skill.x}%;top:${skill.y}%" data-skill-id="${skill.id}"
                aria-label="${escapeHtml(skill.name)}, ${LABEL[st]}" aria-pressed="${skill.id === selectedId}">
                <span class="node-disc">${icon(skillIcons[skill.id] || 'zap', { size: 30 })}<span class="node-badge">${icon(badge, { size: 12 })}</span></span>
                <span class="node-label">${escapeHtml(skill.name)}</span>
            </button>`;
    }).join('');

    container.innerHTML = `<svg class="tree-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>${nodes}`;
}

function req(met, label, value, target, text) {
    const pct = Math.min(100, Math.round((value / target) * 100));
    return `
        <li class="req${met ? ' met' : ''}">
            <span class="req-icon" aria-hidden="true">${icon(met ? 'check' : 'x', { size: 14 })}</span>
            <div>
                <div class="req-main"><span>${label}</span><small>${text}</small></div>
                <div class="progress progress-thin" aria-hidden="true"><div class="progress-fill" style="width:${pct}%"></div></div>
            </div>
        </li>`;
}

function renderDetail() {
    const box = $('skill-detail');
    const level = getLevel();
    const xp = getAvailableXp();
    const owned = state.data.skills.filter(s => s.status !== 'locked').length;
    $('skill-count').textContent = `${owned} / ${state.data.skills.length} unlocked`;
    $('skill-xp-available').textContent = `${xp.toLocaleString()} XP available · Level ${level}`;
    if (!box) return;

    const skill = find(selectedId);
    if (!skill) { box.innerHTML = '<p class="muted">Select a skill to see what it needs.</p>'; return; }
    const st = displayState(skill);
    const head = `
        <div class="detail-head">
            <span class="detail-icon" aria-hidden="true">${icon(skillIcons[skill.id] || 'zap', { size: 28 })}</span>
            <div><h3>${escapeHtml(skill.name)}</h3><span class="${BADGE[st]}">${LABEL[st]}</span></div>
        </div>
        <p class="detail-desc">${escapeHtml(DESC[skill.id] || '')}</p>`;

    if (skill.status !== 'locked') {
        box.innerHTML = `${head}<p class="detail-note">${skill.status === 'mastered' ? 'You have mastered this skill.' : 'Unlocked. Train it in your workouts.'}</p>`;
        return;
    }

    const parents = skill.parents.map(find).filter(Boolean);
    const parentsDone = parents.filter(p => p.status !== 'locked').length;
    const res = checkSkillUnlock(skill.id);
    box.innerHTML = `${head}
        <h4 class="detail-sub">Requirements</h4>
        <ul class="req-list">
            ${parents.length ? req(parentsDone === parents.length, `Unlock ${escapeHtml(parents.map(p => p.name).join(' and '))}`, parentsDone, parents.length, `${parentsDone} / ${parents.length}`) : ''}
            ${req(level >= skill.requiredLevel, `Reach level ${skill.requiredLevel}`, level, skill.requiredLevel, `${level} / ${skill.requiredLevel}`)}
            ${req(xp >= skill.cost, `Spend ${skill.cost.toLocaleString()} XP`, xp, skill.cost, `${xp.toLocaleString()} / ${skill.cost.toLocaleString()}`)}
        </ul>
        <button type="button" class="btn btn-primary full" id="skill-unlock-btn" ${res.ok ? '' : 'disabled'}>${icon(res.ok ? 'zap' : 'lock', { size: 18 })}Unlock for ${skill.cost.toLocaleString()} XP</button>
        ${res.ok ? '' : `<p class="detail-note">${escapeHtml(res.reason)}</p>`}`;
}

export function renderSkills() {
    if (!selectedId || !find(selectedId)) selectedId = defaultSelection();
    renderTree();
    renderDetail();
}

export function initSkills({ onChange }) {
    onUnlocked = onChange;

    $('skill-tree-container')?.addEventListener('click', e => {
        const node = e.target.closest('.node');
        if (!node) return;
        selectedId = node.dataset.skillId;
        renderSkills();
        $('skill-tree-container').querySelector(`[data-skill-id="${selectedId}"]`)?.focus({ preventScroll: true });
    });

    $('skill-detail')?.addEventListener('click', async e => {
        if (!e.target.closest('#skill-unlock-btn')) return;
        const skill = find(selectedId);
        if (!skill) return;
        const ok = await confirmDialog({
            title: `Unlock ${skill.name}`,
            message: `Spend ${skill.cost.toLocaleString()} XP? This does not lower your level.`,
            confirmLabel: 'Unlock'
        });
        if (!ok) return;
        const result = unlockSkill(skill.id); // re-checks every requirement
        if (!result.ok) {
            showToast('Cannot unlock', result.reason, { icon: 'lock', tone: 'gold' });
            renderSkills();
            return;
        }
        saveState();
        justUnlocked = skill.id;
        onUnlocked();
        setTimeout(() => { justUnlocked = null; }, 1200);
        showToast('Skill unlocked', `${result.skill.name} added to your arsenal.`, { icon: 'zap', tone: 'gold' });
    });

    renderSkills();
}
