// The answers offered in onboarding and in Profile > Goals and preferences. The ids match the checks in the database functions.
import { escapeHtml } from '../utils.js';

export const GOALS = [
    { id: 'strength', label: 'Get stronger', hint: 'Push-ups, pull-ups, dips' },
    { id: 'skills', label: 'Learn skills', hint: 'Handstand, muscle-up, levers' },
    { id: 'endurance', label: 'Build endurance', hint: 'More reps, longer sessions' },
    { id: 'mobility', label: 'Improve mobility', hint: 'Range of motion and control' },
    { id: 'fat-loss', label: 'Lose fat', hint: 'Higher activity, steady habit' },
    { id: 'general', label: 'General fitness', hint: 'A bit of everything' }
];
export const EXPERIENCE = [
    { id: 'beginner', label: 'Beginner', hint: 'Under 6 months' },
    { id: 'intermediate', label: 'Intermediate', hint: '6 months to 2 years' },
    { id: 'advanced', label: 'Advanced', hint: 'More than 2 years' }
];
export const ENVIRONMENT = [
    { id: 'home', label: 'At home' }, { id: 'outdoor', label: 'Outdoors' }, { id: 'gym', label: 'In a gym' }, { id: 'mixed', label: 'A mix' }
];
export const EQUIPMENT_OPTIONS = [
    { id: 'none', label: 'No equipment' }, { id: 'pullup-bar', label: 'Pull-up bar' }, { id: 'parallel-bars', label: 'Parallel bars or dip station' },
    { id: 'rings', label: 'Rings' }, { id: 'bands', label: 'Resistance bands' }, { id: 'gym', label: 'Full gym' }, { id: 'other', label: 'Other' }
];
export const FREQUENCY = [2, 3, 4, 5, 6].map(n => ({ id: String(n), label: n === 6 ? '6+' : String(n) }));
export const DURATION = ['15-20', '20-30', '30-45', '45-60', '60+'].map(id => ({ id, label: id === '60+' ? '60+' : id }));

export const labelOf = (list, id) => list.find(i => String(i.id) === String(id))?.label || '';

// Renders a radio or checkbox group into the container. `selected` is an id or an array of ids.
export function renderGroup(containerId, name, items, { type = 'radio', selected = [] } = {}) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const sel = new Set([].concat(selected ?? []).map(String));
    el.innerHTML = items.map(i => `
        <label class="opt"><input type="${type}" name="${name}" value="${escapeHtml(String(i.id))}"${sel.has(String(i.id)) ? ' checked' : ''}>
            <span class="opt-text"><span>${escapeHtml(i.label)}</span>${i.hint ? `<small>${escapeHtml(i.hint)}</small>` : ''}</span></label>`).join('');
}
export const readGroup = (containerId, type = 'radio') => {
    const el = document.getElementById(containerId);
    const picked = [...el.querySelectorAll('input:checked')].map(i => i.value);
    return type === 'radio' ? (picked[0] ?? null) : picked;
};

// 'None' excludes everything else.
export function wireEquipment(containerId) {
    const el = document.getElementById(containerId);
    el.addEventListener('change', e => {
        const t = e.target;
        if (t.type !== 'checkbox') return;
        const boxes = [...el.querySelectorAll('input')];
        if (t.checked && t.value === 'none') boxes.forEach(b => { if (b !== t) b.checked = false; });
        else if (t.checked) boxes.find(b => b.value === 'none').checked = false;
    });
}

// Extra goals: up to 3, never the main goal.
export function wireGoals(primaryId, secondaryId) {
    const p = document.getElementById(primaryId);
    const s = document.getElementById(secondaryId);
    const sync = () => {
        const main = p.querySelector('input:checked')?.value;
        const boxes = [...s.querySelectorAll('input')];
        boxes.forEach(b => { if (b.value === main) b.checked = false; });
        const count = boxes.filter(b => b.checked).length;
        boxes.forEach(b => { b.disabled = b.value === main || (!b.checked && count >= 3); });
    };
    p.addEventListener('change', sync);
    s.addEventListener('change', sync);
    return sync;
}
