import { state, saveState } from './state.js';
import { showToast } from './utils.js';

// ---- PR detection ----

export function checkAndUpdatePR(exId, exName, reps, kg) {
    if (!state.data.personalRecords) state.data.personalRecords = {};
    const pr = state.data.personalRecords[exId];
    const numReps = typeof reps === 'number' ? reps : 0;
    const numKg   = kg || 0;
    const volume  = numReps * numKg;

    const betterKg     = numKg > (pr?.maxKg || 0);
    const betterReps   = numReps > (pr?.maxReps || 0);
    const betterVolume = volume > (pr?.maxVolume || 0);
    const isNewPR      = betterKg || betterReps || (volume > 0 && betterVolume);

    if (isNewPR) {
        state.data.personalRecords[exId] = {
            name:      exName,
            maxKg:     Math.max(numKg,    pr?.maxKg    || 0),
            maxReps:   Math.max(numReps,  pr?.maxReps  || 0),
            maxVolume: Math.max(volume,   pr?.maxVolume || 0),
            date:      new Date().toISOString()
        };
        return true;
    }
    return false;
}

// ---- Save per-exercise session data ----

export function saveExerciseSession(exId, exName, sets) {
    if (!state.data.exerciseHistory) state.data.exerciseHistory = {};
    if (!state.data.exerciseHistory[exId]) state.data.exerciseHistory[exId] = [];

    state.data.exerciseHistory[exId].push({
        date: new Date().toISOString(),
        name: exName,
        sets: sets.map(s => ({ reps: s.reps, kg: s.kg || 0 }))
    });

    // Keep max 30 sessions per exercise
    if (state.data.exerciseHistory[exId].length > 30) {
        state.data.exerciseHistory[exId] = state.data.exerciseHistory[exId].slice(-30);
    }
}

// ---- Last session lookup ----

export function getLastSession(exId) {
    const history = (state.data.exerciseHistory || {})[exId];
    if (!history || history.length === 0) return null;
    return history[history.length - 1];
}

// ---- Render progress page ----

export function renderProgressPage() {
    const container = document.getElementById('progress-content');
    if (!container) return;

    const records = state.data.personalRecords || {};
    const history = state.data.exerciseHistory || {};
    const allIds  = [...new Set([...Object.keys(records), ...Object.keys(history)])];

    if (allIds.length === 0) {
        container.innerHTML = `
            <div class="progress-empty">
                <div class="progress-empty-icon">📈</div>
                <h3>Ingen data ennå</h3>
                <p>Fullfør din første treningsøkt for å se fremgang her.</p>
            </div>`;
        return;
    }

    // --- Personal Records ---
    const prHTML = allIds.filter(id => records[id]).map(id => {
        const pr   = records[id];
        const date = new Date(pr.date).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' });
        return `
            <div class="pr-card glass-card">
                <div class="pr-card-top">
                    <h4>${pr.name}</h4>
                    <span class="pr-date-badge">${date}</span>
                </div>
                <div class="pr-stats">
                    ${pr.maxReps > 0 ? `
                        <div class="pr-stat">
                            <span class="pr-val">${pr.maxReps}</span>
                            <span class="pr-label">Maks reps</span>
                        </div>` : ''}
                    ${pr.maxKg > 0 ? `
                        <div class="pr-stat">
                            <span class="pr-val">${pr.maxKg} kg</span>
                            <span class="pr-label">Maks vekt</span>
                        </div>` : ''}
                    ${pr.maxVolume > 0 ? `
                        <div class="pr-stat">
                            <span class="pr-val">${pr.maxVolume}</span>
                            <span class="pr-label">Maks volum</span>
                        </div>` : ''}
                </div>
            </div>`;
    }).join('');

    // --- Fremgang siden forrige økt ---
    const progressHTML = allIds
        .filter(id => history[id] && history[id].length >= 2)
        .map(id => {
            const sessions = history[id];
            const prev = sessions[sessions.length - 2];
            const curr = sessions[sessions.length - 1];

            const avgReps = arr => arr.reduce((s, x) => s + (x.reps || 0), 0) / arr.length;
            const avgKg   = arr => arr.reduce((s, x) => s + (x.kg  || 0), 0) / arr.length;

            const repsDiff = Math.round((avgReps(curr.sets) - avgReps(prev.sets)) * 10) / 10;
            const kgDiff   = Math.round((avgKg(curr.sets)   - avgKg(prev.sets))   * 10) / 10;

            if (repsDiff === 0 && kgDiff === 0) return '';

            const badge = (val, unit) => val === 0 ? '' :
                `<span class="diff-badge ${val > 0 ? 'positive' : 'negative'}">${val > 0 ? '+' : ''}${val}${unit}</span>`;

            return `
                <div class="progress-row">
                    <span class="progress-ex-name">${curr.name}</span>
                    <div class="progress-diffs">
                        ${badge(repsDiff, ' reps')}
                        ${badge(kgDiff, ' kg')}
                    </div>
                </div>`;
        }).filter(Boolean).join('');

    // --- Historikk per øvelse ---
    const historyHTML = allIds
        .filter(id => history[id] && history[id].length > 0)
        .map(id => {
            const sessions = [...history[id]].reverse().slice(0, 6);
            const name = sessions[0].name;
            return `
                <details class="history-exercise glass-card">
                    <summary class="history-exercise-summary">
                        <span>${name}</span>
                        <span class="hist-count">${history[id].length} økter</span>
                    </summary>
                    <div class="history-sessions">
                        ${sessions.map(s => {
                            const date = new Date(s.date).toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric', month: 'short' });
                            return `
                                <div class="history-session-row">
                                    <span class="hist-date">${date}</span>
                                    <div class="hist-sets">
                                        ${s.sets.map((set, i) => `
                                            <span class="hist-set">Sett ${i + 1}: ${set.reps} reps${set.kg > 0 ? ` @ ${set.kg} kg` : ''}</span>
                                        `).join('')}
                                    </div>
                                </div>`;
                        }).join('')}
                    </div>
                </details>`;
        }).join('');

    container.innerHTML = `
        ${prHTML ? `<h3 class="progress-section-title">Personlige rekorder 🏆</h3><div class="pr-grid">${prHTML}</div>` : ''}
        ${progressHTML ? `<h3 class="progress-section-title">Fremgang siden forrige økt 📈</h3><div class="progress-list glass-card">${progressHTML}</div>` : ''}
        <h3 class="progress-section-title">Historikk per øvelse 📋</h3>
        ${historyHTML || '<p class="section-subtitle">Fullfør minst én økt for å se historikk her.</p>'}
    `;
}
