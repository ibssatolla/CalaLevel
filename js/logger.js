import { state, saveState } from './state.js';
import { showToast } from './utils.js';

// ---- Body Weight Log ----

export function logBodyWeight(kg) {
    const entry = {
        date: new Date().toISOString(),
        kg: parseFloat(kg)
    };
    if (!state.data.bodyLog) state.data.bodyLog = [];
    state.data.bodyLog.push(entry);

    // Update current weight in profile
    state.data.userProfile.weightKg = entry.kg;

    saveState();
    showToast('Vekt logget', `${entry.kg} kg registrert`);
}

export function getBodyLog() {
    return state.data.bodyLog || [];
}

export function getLatestWeight() {
    const log = getBodyLog();
    if (log.length === 0) return state.data.userProfile.weightKg || null;
    return log[log.length - 1].kg;
}

// ---- Exercise PR Log ----
// exerciseLog: { exerciseId: [{ date, sets, reps, weightKg }] }

export function logExerciseSet(exerciseId, exerciseName, sets, reps, weightKg) {
    if (!state.data.exerciseLog) state.data.exerciseLog = {};
    if (!state.data.exerciseLog[exerciseId]) state.data.exerciseLog[exerciseId] = [];

    const entry = {
        date: new Date().toISOString(),
        name: exerciseName,
        sets: parseInt(sets) || 0,
        reps: parseInt(reps) || 0,
        weightKg: parseFloat(weightKg) || 0
    };

    state.data.exerciseLog[exerciseId].push(entry);
    saveState();
}

export function getExerciseHistory(exerciseId) {
    return (state.data.exerciseLog || {})[exerciseId] || [];
}

export function getExercisePR(exerciseId) {
    const history = getExerciseHistory(exerciseId);
    if (history.length === 0) return null;
    // PR = highest reps in a set, or highest weight
    return history.reduce((best, entry) => {
        const score = entry.weightKg > 0 ? entry.weightKg : entry.reps;
        const bestScore = best.weightKg > 0 ? best.weightKg : best.reps;
        return score > bestScore ? entry : best;
    }, history[0]);
}

// ---- Render Body Log Section ----

export function renderBodyLogger(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const log = getBodyLog().slice(-10).reverse(); // last 10
    const latestWeight = getLatestWeight();

    container.innerHTML = `
        <div class="body-logger">
            <div class="logger-header">
                <div class="current-weight">
                    <span class="weight-value">${latestWeight ? latestWeight + ' kg' : '--'}</span>
                    <span class="weight-label">Nåværende vekt</span>
                </div>
                <div class="log-input-row">
                    <input type="number" id="weight-input" placeholder="kg" min="30" max="300" step="0.1" class="weight-input" />
                    <button class="cta-button primary small" id="log-weight-btn">Logg</button>
                </div>
            </div>

            <div class="weight-history">
                ${log.length === 0 ? '<p class="empty-state-small">Ingen logger ennå.</p>' : ''}
                ${log.map(entry => {
                    const date = new Date(entry.date).toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
                    return `
                        <div class="weight-entry">
                            <span class="we-date">${date}</span>
                            <span class="we-kg">${entry.kg} kg</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    document.getElementById('log-weight-btn')?.addEventListener('click', () => {
        const input = document.getElementById('weight-input');
        const val = parseFloat(input?.value);
        if (!val || val < 30 || val > 300) {
            showToast('Ugyldig vekt', 'Skriv inn en gyldig vekt (30–300 kg)');
            return;
        }
        logBodyWeight(val);
        input.value = '';
        renderBodyLogger(containerId);
    });
}

// ---- Render Profile Settings Panel ----

export function renderProfileSettings(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const p = state.data.userProfile;
    const apiKey = state.data.apiKey || '';

    container.innerHTML = `
        <div class="settings-panel">
            <div class="settings-row">
                <label>Navn</label>
                <input type="text" id="set-name" value="${p.name || ''}" placeholder="Navn" />
            </div>
            <div class="settings-row">
                <label>Høyde (cm)</label>
                <input type="number" id="set-height" value="${p.heightCm || ''}" placeholder="175" min="100" max="250" />
            </div>
            <div class="settings-row">
                <label>Mål</label>
                <select id="set-goal">
                    <option value="strength" ${p.goal === 'strength' ? 'selected' : ''}>Styrke</option>
                    <option value="skill" ${p.goal === 'skill' ? 'selected' : ''}>Ferdigheter</option>
                    <option value="endurance" ${p.goal === 'endurance' ? 'selected' : ''}>Kondisjon</option>
                    <option value="aesthetics" ${p.goal === 'aesthetics' ? 'selected' : ''}>Estetikk</option>
                </select>
            </div>
            <div class="settings-row">
                <label>Nivå</label>
                <select id="set-level">
                    <option value="beginner" ${p.fitnessLevel === 'beginner' ? 'selected' : ''}>Nybegynner</option>
                    <option value="intermediate" ${p.fitnessLevel === 'intermediate' ? 'selected' : ''}>Mellomnivå</option>
                    <option value="advanced" ${p.fitnessLevel === 'advanced' ? 'selected' : ''}>Avansert</option>
                </select>
            </div>
            <div class="settings-row">
                <label>Anthropic API-nøkkel</label>
                <input type="password" id="set-apikey" value="${apiKey}" placeholder="sk-ant-..." />
            </div>
            <button class="cta-button primary" id="save-settings-btn" style="margin-top: 1rem; width: 100%;">Lagre innstillinger</button>
            <button class="cta-button secondary small" id="reset-user-btn" style="margin-top: 0.5rem; width: 100%; color: var(--accent);">Tilbakestill bruker</button>
        </div>
    `;

    document.getElementById('save-settings-btn')?.addEventListener('click', () => {
        import('./auth.js').then(({ updateProfile }) => {
            updateProfile({
                name: document.getElementById('set-name')?.value.trim(),
                heightCm: document.getElementById('set-height')?.value,
                goal: document.getElementById('set-goal')?.value,
                fitnessLevel: document.getElementById('set-level')?.value,
                apiKey: document.getElementById('set-apikey')?.value.trim()
            });
            showToast('Lagret', 'Innstillinger oppdatert');
        });
    });

    document.getElementById('reset-user-btn')?.addEventListener('click', () => {
        if (confirm('Er du sikker? All data slettes.')) {
            import('./auth.js').then(({ resetUser }) => resetUser());
        }
    });
}
