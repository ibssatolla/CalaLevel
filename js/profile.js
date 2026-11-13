// Profile section: identity card, recent activity, achievements. Everything is derived from state.
import { state, saveState, isDemo, switchMode, hasLegacySeed, removeLegacySeed } from './state.js';
import {
    getTotalXp, levelProgress, rankTitleForLevel, isAchievementUnlocked, achievementProgress, ACHIEVEMENT_ICONS, UNTRACKED_ACHIEVEMENTS
} from './progression.js';
import { icon } from './icons.js';
import { emit, EVT } from './events.js';
import { escapeHtml, capitalize, dateKey, addDays, showToast, confirmDialog } from './utils.js';

const $ = id => document.getElementById(id);
const TYPE_ICONS = { push: 'dumbbell', pull: 'skill-pullup', legs: 'footprints', skill: 'target', full: 'flame', core: 'activity' };
const OLD_ICONS = { '🌳': 'pin', '⚔️': 'swords', '🪜': 'skill-dips' };

function relativeDay(key) {
    const today = dateKey();
    if (key === today) return 'Today';
    if (key === addDays(today, -1)) return 'Yesterday';
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getActivity() {
    const fromHistory = [...state.data.workoutHistory]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5)
        .map(h => ({
            title: h.title || `${capitalize(h.type)} Session`,
            date: relativeDay(h.dateKey),
            xp: h.stats.xp,
            icon: TYPE_ICONS[h.type] || 'flame'
        }));
    const older = state.data.userProfile.activity.map(a => ({ ...a, icon: OLD_ICONS[a.icon] || 'activity' }));
    return [...fromHistory, ...older].slice(0, 6);
}

// Toast once for each achievement unlocked since the last visit. The first run only records what is already unlocked.
function announceNewAchievements() {
    const profile = state.data.userProfile;
    const unlockedKeys = profile.achievements.filter(isAchievementUnlocked).map(a => a.key);
    if (profile.achievementsSeen === null) {
        profile.achievementsSeen = unlockedKeys;
        saveState();
        return;
    }
    const fresh = profile.achievements.filter(a => unlockedKeys.includes(a.key) && !profile.achievementsSeen.includes(a.key));
    if (!fresh.length) return;
    profile.achievementsSeen = [...new Set([...profile.achievementsSeen, ...unlockedKeys])];
    saveState();
    fresh.forEach(a => emit(EVT.ACHIEVEMENT_UNLOCKED, { achievement: a }));
    fresh.forEach((a, i) => setTimeout(() => showToast('Achievement unlocked', a.name, { icon: ACHIEVEMENT_ICONS[a.key] || 'award', tone: 'gold' }), i * 600));
}

export function renderProfile() {
    const total = getTotalXp();
    const p = levelProgress(total);
    $('profile-rank-title').textContent = rankTitleForLevel(p.level);
    $('profile-level-circle').textContent = p.level;
    $('profile-level-label').textContent = `Level ${p.level}`;
    $('profile-xp-text').textContent = `${total.toLocaleString()} / ${p.ceiling.toLocaleString()} XP`;
    $('profile-xp-bar').style.width = `${p.pct}%`;
    $('profile-xp-track').setAttribute('aria-valuenow', String(Math.round(p.pct)));

    const activity = getActivity();
    $('activity-list').innerHTML = activity.length === 0
        ? '<li class="empty">No workouts yet. Finish one and it shows up here.</li>'
        : activity.map(item => `
        <li class="activity">
            <span class="act-icon" aria-hidden="true">${icon(item.icon, { size: 18 })}</span>
            <div class="act-body"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.date)}</small></div>
            <span class="act-xp">+${Number(item.xp) || 0} XP</span>
        </li>`).join('');

    const list = state.data.userProfile.achievements;
    const unlockedCount = list.filter(isAchievementUnlocked).length;
    $('ach-meta').textContent = `${isDemo() ? 'Demo · ' : ''}${unlockedCount} / ${list.length}`;
    $('achievements-grid').innerHTML = list.map(a => {
        const unlocked = isAchievementUnlocked(a);
        const prog = unlocked ? null : achievementProgress(a);
        const untracked = !unlocked && !isDemo() && UNTRACKED_ACHIEVEMENTS.includes(a.key);
        return `
            <li class="ach ${unlocked ? 'unlocked' : 'locked'}${untracked ? ' untracked' : ''}" aria-label="${escapeHtml(a.name)}: ${escapeHtml(a.desc)}. ${unlocked ? 'Unlocked' : 'Locked'}">
                <span class="ach-icon" aria-hidden="true">${icon(unlocked ? (ACHIEVEMENT_ICONS[a.key] || 'award') : 'lock', { size: 22 })}</span>
                <div class="ach-body">
                    <strong>${escapeHtml(a.name)}</strong>
                    <span class="desc">${escapeHtml(a.desc)}</span>${untracked ? '<span class="soon">Not tracked yet</span>' : ''}
                    ${prog ? `<div class="progress progress-thin" aria-hidden="true"><div class="progress-fill" style="width:${(prog.value / prog.target) * 100}%"></div></div><span class="count">${prog.value.toLocaleString()} / ${prog.target.toLocaleString()}</span>` : ''}
                </div>
            </li>`;
    }).join('');

    announceNewAchievements();
    renderDataCard();
}

function renderDataCard() {
    const text = $('data-text');
    const actions = $('data-actions');
    if (!text || !actions) return;
    const btn = (id, label, cls = 'btn-ghost') => `<button type="button" class="btn ${cls} btn-sm" data-data-action="${id}">${label}</button>`;
    if (isDemo()) {
        text.textContent = 'You are looking at demo data. Anything you do here does not change your real progress.';
        actions.innerHTML = btn('live', 'Back to my progress', 'btn-primary');
    } else if (hasLegacySeed()) {
        text.textContent = 'This account still includes sample progress from an older version (12,450 XP, level 5). Your real workouts are kept if you remove it.';
        actions.innerHTML = btn('clean', 'Remove sample progress', 'btn-primary') + btn('demo', 'Open demo mode');
    } else {
        text.textContent = 'Your progress is saved in this browser only. Nothing is sent anywhere.';
        actions.innerHTML = btn('demo', 'Open demo mode');
    }
}

export function initProfile({ onChange }) {
    $('data-actions')?.addEventListener('click', async e => {
        const b = e.target.closest('[data-data-action]');
        if (!b) return;
        const act = b.dataset.dataAction;
        if (act === 'live') { switchMode('live'); return; }
        if (act === 'demo') {
            const ok = await confirmDialog({ title: 'Open demo mode?', message: 'Demo mode shows sample progress and simulated players. Your real progress is kept separately and is not changed.', confirmLabel: 'Open demo' });
            if (ok) switchMode('demo');
            return;
        }
        if (act === 'clean') {
            const ok = await confirmDialog({ title: 'Remove sample progress?', message: 'This removes the sample XP, streak, skills and activity. Your own workout history stays. A copy is kept in your browser.', confirmLabel: 'Remove', danger: true });
            if (!ok) return;
            removeLegacySeed();
            showToast('Sample progress removed', 'Your account now shows only your own workouts.', { icon: 'check', tone: 'success' });
            onChange();
        }
    });
}
