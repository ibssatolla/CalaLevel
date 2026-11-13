import { state, saveState, isDemo, switchMode } from './state.js';
import { getLeaderboard } from './progression.js';
import { levelFromXp } from './progression.js';
import { icon } from './icons.js';
import { escapeHtml, showToast } from './utils.js';

const initials = name => name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '?';
const hue = name => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function avatar(name, me = false) {
    return `<span class="avatar-sm${me ? ' you' : ''}" style="--hue:${hue(name)}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function renderRankSummary(board) {
    const box = document.getElementById('my-rank-summary');
    if (!box) return;
    const me = board.find(p => p.name === 'You');
    if (!isDemo()) {
        box.innerHTML = `<span class="rank-big">-</span><div><strong>No online ranking yet</strong><span class="sub">Your total: ${me.xp.toLocaleString()} XP</span></div>`;
        return;
    }
    const above = board[me.rank - 2];
    const text = above
        ? `${(above.xp - me.xp).toLocaleString()} XP behind ${escapeHtml(above.name)}`
        : 'You lead the leaderboard';
    box.innerHTML = `<span class="rank-big">#${me.rank}</span><div><strong>Your position</strong><span class="sub">${text}</span></div>`;
}

export function renderBattles() {
    const challengesList = document.getElementById('challenges-list');
    const leaderboardList = document.getElementById('leaderboard-list');

    const demo = isDemo();
    document.querySelectorAll('.demo-tag').forEach(t => t.classList.toggle('hidden', !demo));
    const boardNote = document.getElementById('board-note');
    if (boardNote) boardNote.textContent = demo
        ? 'Demo data: these players and battles are simulated. This is not a real global ranking.'
        : 'Rankings and battles need other players and an online service. They are not available yet.';

    if (challengesList && !demo) {
        challengesList.innerHTML = `
            <div class="empty-card">
                <strong>No battles yet</strong>
                <p>Battles are played against other people. Player accounts are not available yet.</p>
                <button type="button" class="btn btn-ghost btn-sm" data-open-demo>See how battles will look</button>
            </div>`;
    } else if (challengesList) {
        challengesList.innerHTML = state.data.challenges.map(c => {
            const open = c.status === 'Open';
            return `
            <article class="challenge${open ? '' : ' live'}">
                <div class="vs">
                    <span class="vs-side">${avatar('You', true)}<span>You</span></span>
                    <span class="vs-mark">VS</span>
                    <span class="vs-side"><span>${escapeHtml(c.opponent)}</span>${avatar(c.opponent)}</span>
                </div>
                <div class="challenge-foot">
                    <div><h4>${escapeHtml(c.title)}</h4><span class="badge">${escapeHtml(c.type)}</span></div>
                    ${open
                        ? `<button type="button" class="btn btn-secondary btn-sm" data-challenge-id="${Number(c.id)}" aria-label="Accept challenge ${escapeHtml(c.title)}">Accept</button>`
                        : `<span class="badge badge-success">${icon('check', { size: 14 })}Accepted</span>`}
                </div>
            </article>`;
        }).join('');
    }

    if (leaderboardList) {
        const board = getLeaderboard();
        leaderboardList.innerHTML = board.map(item => {
            const me = item.name === 'You';
            return `
            <li class="lb-row${me ? ' me' : ''}${demo && item.rank <= 3 ? ` top-${item.rank}` : ''}"${me ? ' aria-current="true"' : ''}>
                <span class="lb-rank">${demo ? item.rank : '-'}</span>
                ${avatar(item.name, me)}
                <span class="lb-name"><strong>${escapeHtml(item.name)}</strong><small>Level ${levelFromXp(item.xp)}</small></span>
                <span class="lb-xp">${item.xp.toLocaleString()} XP</span>
            </li>`;
        }).join('');
        renderRankSummary(board);
    }
}

export function initBattles() {
    document.getElementById('challenges-list')?.addEventListener('click', e => {
        if (e.target.closest('[data-open-demo]')) switchMode('demo');
    });
    document.getElementById('challenges-list')?.addEventListener('click', e => {
        const btn = e.target.closest('button[data-challenge-id]');
        if (!btn) return;
        const challenge = state.data.challenges.find(c => c.id === Number(btn.dataset.challengeId));
        if (!challenge || challenge.status !== 'Open') return;
        challenge.status = 'In Progress';
        saveState();
        renderBattles();
        showToast('Challenge accepted', `Beat ${challenge.opponent} in ${challenge.title}.`, { icon: 'swords', tone: 'purple' });
    });
    renderBattles();
}
