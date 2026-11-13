// Dashboard: level ring, XP, streak, week dots, stats, recent skills. All values come from state. Quests: quests-ui.js.
import { state, isDemo } from './state.js';
import {
    getTotalXp, levelProgress, rankTitleForLevel, getWorkoutCount, getTotalReps, getStreak,
    getGlobalRank, getTrainedDays
} from './progression.js';
import { icon, skillIcons } from './icons.js';
import { escapeHtml, countTo, dateKey } from './utils.js';

const $ = id => document.getElementById(id);
const RING_LEN = 2 * Math.PI * 52;
let onChange = () => {};

function setProgress(trackId, barId, pct) {
    const bar = $(barId);
    if (bar) bar.style.width = `${pct}%`;
    $(trackId)?.setAttribute('aria-valuenow', String(Math.round(pct)));
}

function renderLevel() {
    const total = getTotalXp();
    const p = levelProgress(total);
    $('dash-ring-fill').style.strokeDashoffset = String(RING_LEN * (1 - p.pct / 100));
    countTo($('dash-level-num'), p.level, { duration: 500 });
    $('dash-rank').textContent = rankTitleForLevel(p.level);
    $('dash-xp-text').textContent = `${total.toLocaleString()} / ${p.ceiling.toLocaleString()} XP`;
    $('dash-to-next').textContent = `${p.toNext.toLocaleString()} XP to level ${p.level + 1}`;
    setProgress('dash-xp-track', 'dash-xp-bar', p.pct);
    $('dash-streak-chip').textContent = `${getStreak()} day streak`;
}

function renderWeek() {
    const today = dateKey();
    const days = getTrainedDays();
    $('week-meta').textContent = `${days.filter(d => d.trained).length} of 7 days`;
    $('week-streak').innerHTML = days.map(d => {
        const [y, m, day] = d.key.split('-').map(Number);
        const label = new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
        const full = new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: 'long' });
        const isToday = d.key === today;
        return `
            <li class="day-dot${d.trained ? ' trained' : ''}${isToday ? ' today' : ''}" aria-label="${full}${isToday ? ', today' : ''}: ${d.trained ? 'trained' : 'no workout'}">
                <span class="dot-circle">${icon('check', { size: 16 })}</span>
                <span aria-hidden="true">${label}</span>
            </li>`;
    }).join('');
}

function renderStats() {
    countTo($('stat-workouts'), getWorkoutCount());
    countTo($('stat-reps'), getTotalReps());
    countTo($('stat-streak'), getStreak());
    // A global rank only exists in demo mode (simulated players). Real accounts see their level instead.
    if (isDemo()) {
        $('stat-rank-label').textContent = 'Demo rank';
        $('stat-rank').textContent = `#${getGlobalRank()}`;
    } else {
        $('stat-rank-label').textContent = 'Level';
        $('stat-rank').textContent = String(levelProgress(getTotalXp()).level);
    }
}

function skillItem(s, next = false) {
    const ic = skillIcons[s.id] || 'zap';
    const sub = next ? `Needs level ${s.requiredLevel} · ${s.cost.toLocaleString()} XP` : s.status === 'mastered' ? 'Mastered' : 'Unlocked';
    return `
        <a class="mini-skill${next ? ' next' : ''}" href="#skills" data-skill="${s.id}">
            <span class="mini-icon" aria-hidden="true">${icon(ic, { size: 22 })}</span>
            <span><strong>${escapeHtml(s.name)}</strong><span class="sub">${sub}</span></span>
        </a>`;
}

function renderSkills() {
    const { skills } = state.data;
    const owned = skills.filter(s => s.status !== 'locked');
    // Newest unlocks first. Skills without a timestamp (the starting ones) come last.
    const recent = [...owned].sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0)).slice(0, 3);
    const nextUp = skills
        .filter(s => s.status === 'locked' && s.parents.every(pid => skills.find(x => x.id === pid)?.status !== 'locked'))
        .sort((a, b) => a.cost - b.cost)[0];
    $('dash-skills').innerHTML = recent.map(s => skillItem(s)).join('') + (nextUp ? skillItem(nextUp, true) : '');
}

export function renderDashboard() {
    renderLevel();
    renderWeek();
    renderStats();
    renderSkills();
}

export function initDashboard({ onChange: cb }) {
    onChange = cb;
    renderDashboard();
}
