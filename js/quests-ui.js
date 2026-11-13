// Quest screen, the compact quest list on the dashboard, and the reward feedback.
// Presentation only. Quest state comes from quests.js and is never changed here.
import { getQuestsForDate, getQuestHistory, msUntilReset } from './quests.js';
import { startPreset } from './session.js';
import { on, EVT } from './events.js';
import { icon } from './icons.js';
import { escapeHtml, showToast, dateKey, addDays } from './utils.js';

const $ = id => document.getElementById(id);
const CATEGORY_ICON = { strength: 'dumbbell', skill: 'target', mobility: 'activity', consistency: 'calendar', endurance: 'flame', exploration: 'navigation' };
const SLOT_LABEL = { main: 'Main quest', side: 'Side quest', optional: 'Optional' };
const DIFFICULTY = ['Easy', 'Medium', 'Hard'];

function amount(q, value) {
    switch (q.metric.kind) {
        case 'reps': return `${value} / ${q.target} reps`;
        case 'seconds': return q.target >= 120 && q.target % 60 === 0 ? `${Math.round(value / 6) / 10} / ${q.target / 60} min` : `${value} / ${q.target} s`;
        case 'active_seconds': return `${Math.floor(value / 60)} / ${Math.round(q.target / 60)} min`;
        default: return `${value} / ${q.target} sets`;
    }
}

function resetText(now = new Date()) {
    const mins = Math.max(1, Math.ceil(msUntilReset(now) / 60000));
    const h = Math.floor(mins / 60);
    return h > 0 ? `New quests in ${h} h ${mins % 60} min` : `New quests in ${mins} min`;
}

function statusChip(q) {
    if (q.status === 'completed') return `<span class="badge badge-success">${icon('check', { size: 14 })}Completed</span>`;
    if (q.status === 'expired') return '<span class="badge">Expired</span>';
    return '<span class="badge badge-primary">Active</span>';
}

function startButton(q) {
    if (q.status !== 'active') return '';
    if (q.category === 'mobility') return `<button type="button" class="btn btn-primary btn-sm" data-quest-start="mobility">${icon('play', { size: 16 })}Start mobility</button>`;
    if (q.category === 'skill') return `<button type="button" class="btn btn-ghost btn-sm" data-quest-start="skill">${icon('play', { size: 16 })}Skill practice</button>`;
    return `<button type="button" class="btn ${q.slot === 'main' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="start-training">${icon('play', { size: 16 })}Start workout</button>`;
}

function questCard(q, restDay) {
    const pct = Math.round((q.progress / q.target) * 100);
    const done = q.status === 'completed';
    const reward = done
        ? `<span class="quest-reward earned">${q.rewardStatus === 'granted' ? `+${q.rewardXp} XP earned` : 'Reward on its way'}</span>`
        : `<span class="quest-reward">+${q.rewardXp} XP</span>`;
    return `
        <article class="card quest-card ${q.slot}${done ? ' done' : ''}${q.status === 'expired' ? ' expired' : ''}" data-quest="${escapeHtml(q.id)}" aria-label="${SLOT_LABEL[q.slot]}: ${escapeHtml(q.title)}">
            <div class="quest-card-top">
                <span class="quest-icon" aria-hidden="true">${icon(done ? 'check' : (CATEGORY_ICON[q.category] || 'target'), { size: q.slot === 'main' ? 22 : 18 })}</span>
                <div class="quest-card-head">
                    <p class="eyebrow">${SLOT_LABEL[q.slot]}${q.slot === 'main' && restDay ? ' · Rest day' : ''}</p>
                    <h3 class="quest-card-title">${escapeHtml(q.title)}</h3>
                </div>
                ${statusChip(q)}
            </div>
            <p class="quest-card-desc">${escapeHtml(q.description)}</p>
            <div class="progress ${q.slot === 'main' ? '' : 'progress-thin'}" role="progressbar" aria-label="${escapeHtml(q.title)}" aria-valuemin="0" aria-valuemax="${q.target}" aria-valuenow="${q.progress}">
                <div class="progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="quest-card-foot">
                <span class="quest-count">${amount(q, q.progress)}</span>
                <span class="difficulty" aria-label="Difficulty ${DIFFICULTY[q.difficulty - 1]}"><span class="pips" aria-hidden="true">${[1, 2, 3].map(n => `<i class="${n <= q.difficulty ? 'on' : ''}"></i>`).join('')}</span>${DIFFICULTY[q.difficulty - 1]}</span>
                ${reward}
            </div>
            ${startButton(q) ? `<div class="quest-card-actions">${startButton(q)}</div>` : ''}
        </article>`;
}

function renderBoard(quests) {
    const board = $('quest-board');
    if (!board) return;
    if (!quests.length) {
        board.innerHTML = '<div class="empty-card"><strong>No quests yet</strong><p>Quests could not be created. Reload the page. If this stays, browser storage may be blocked.</p></div>';
        return;
    }
    const rest = quests.some(q => q.slot === 'main' && q.templateId === 'main-recovery');
    const main = quests.find(q => q.slot === 'main');
    const others = quests.filter(q => q.slot !== 'main');
    const finished = quests.filter(q => q.status === 'completed').length;
    board.innerHTML = `
        <p class="quest-summary" id="quest-summary">${finished} of ${quests.length} completed today${rest ? '. Today is a rest day. Light work only.' : ''}</p>
        ${main ? questCard(main, rest) : ''}
        <div class="quest-side">${others.map(q => questCard(q, rest)).join('')}</div>`;
}

function renderCompact(quests, now) {
    const list = $('quests-list');
    if (!list) return;
    const finished = quests.filter(q => q.status === 'completed').length;
    $('quests-meta').textContent = quests.length ? `${finished} of ${quests.length} completed · ${resetText(now).replace('New quests in', 'resets in')}` : '';
    list.innerHTML = quests.length ? quests.map(q => {
        const pct = Math.round((q.progress / q.target) * 100);
        const done = q.status === 'completed';
        return `
            <li class="quest${done ? ' claimed' : ''}${q.slot === 'main' ? ' is-main' : ''}">
                <span class="quest-icon" aria-hidden="true">${icon(done ? 'check' : (CATEGORY_ICON[q.category] || 'target'), { size: 18 })}</span>
                <div>
                    <span class="quest-title">${escapeHtml(q.title)}</span>
                    <div class="progress progress-thin" role="progressbar" aria-label="${escapeHtml(q.title)}" aria-valuemin="0" aria-valuemax="${q.target}" aria-valuenow="${q.progress}">
                        <div class="progress-fill" style="width:${pct}%"></div>
                    </div>
                    <span class="quest-count">${amount(q, q.progress)}</span>
                </div>
                <span class="${done ? 'badge badge-success' : 'quest-xp'}">${done ? `${icon('check', { size: 14 })}Done` : `+${q.rewardXp} XP`}</span>
            </li>`;
    }).join('') : '<li class="empty">Quests appear here once the app has loaded.</li>';
}

function renderHistory(today) {
    const list = $('quest-history');
    if (!list) return;
    const rows = getQuestHistory(today, 7);
    list.innerHTML = rows.length ? rows.map(r => {
        const [y, m, d] = r.date.split('-').map(Number);
        const label = r.date === addDays(today, -1) ? 'Yesterday' : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
        return `<li><span>${escapeHtml(label)}</span><span class="quest-count">${r.completed} of ${r.total} completed</span></li>`;
    }).join('') : '<li class="empty">Your quest history shows up here after the first day.</li>';
}

export function renderQuestsUi(now = new Date()) {
    const today = dateKey(now);
    const quests = getQuestsForDate(today);
    renderBoard(quests);
    renderCompact(quests, now);
    renderHistory(today);
    const chip = $('quest-reset');
    if (chip) chip.querySelector('span').textContent = resetText(now);
}

function addSummaryLine(q, xp) {
    const list = $('summary-quests');
    if (!list) return;
    list.classList.remove('hidden');
    const li = document.createElement('li');
    li.innerHTML = `${icon('check', { size: 16 })}<span>${escapeHtml(q.title)}</span><strong>+${xp} XP</strong>`;
    list.appendChild(li);
}

export function initQuestsUi({ onChange }) {
    // Reward feedback comes from the authoritative reward event, so it appears once per paid reward.
    on(EVT.REWARD_GRANTED, ({ quest, tx }) => {
        showToast('Quest complete', `${quest.title}: +${tx.xp} XP`, { icon: 'gift', tone: 'gold' });
        addSummaryLine(quest, tx.xp);
    });

    const board = $('quest-board');
    board?.addEventListener('click', e => {
        const b = e.target.closest('[data-quest-start]');
        if (b) startPreset(b.dataset.questStart);
    });

    // The countdown moves once a minute. A change of day is handled by the daily cycle, not here.
    setInterval(() => {
        const chip = $('quest-reset');
        if (chip && !document.hidden) chip.querySelector('span').textContent = resetText();
    }, 60000);
    renderQuestsUi();
    void onChange;
}
