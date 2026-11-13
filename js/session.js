// Workout mode: full-screen session with set tracking, workout timer, rest timer, summary.
// The session lives in state.data.activeSession, so it survives reloads. After a reload it
// starts minimised (a pill at the bottom) and the user reopens it.
import { state, saveState } from './state.js';
import { computeSessionTotals, getProgressSnapshot, xpForSet } from './progression.js';
import { emit, EVT } from './events.js';
import { presetWorkouts, exerciseLibrary } from './exercises.js';
import { icon } from './icons.js';
import { showToast, escapeHtml, formatClock, dateKey, setupModal, confirmDialog, countTo } from './utils.js';

const REST_DEFAULT_SEC = 60;
const REST_STEP_SEC = 15;

let hooks = { onChange: () => {}, onLevelUp: () => {} };
let tickHandle = null;
let restAlerted = false;
let workoutModal = null;
let expandedIndex = null; // exercise the user opened by hand; null = follow the current one
let finishing = false;

const $ = id => document.getElementById(id);

export function getActiveSession() {
    return state.data.activeSession;
}

// ---- Session creation ----

function toSessionExercise(ex) {
    const unit = ex.unit === 'sec' ? 'sec' : 'reps';
    const reps = typeof ex.reps === 'string' ? parseInt(ex.reps, 10) : ex.reps;
    return {
        id: String(ex.id),
        name: String(ex.name),
        unit,
        targetSets: Math.max(1, Number(ex.sets) || 1),
        targetReps: Math.max(1, reps || 1),
        reps: Math.max(1, reps || 1), // reps (or seconds) the next set will log
        sets: []                       // completed sets: [{ reps }]
    };
}

// Starts a session and opens workout mode. Returns false (and says why) if one is already running.
export function startSession(type, title, exercises) {
    if (getActiveSession()) {
        showToast('Session in progress', 'Finish or discard your current workout first.', { icon: 'timer', tone: 'gold' });
        openWorkout();
        return false;
    }
    if (!Array.isArray(exercises) || exercises.length === 0) return false;

    state.data.activeSession = {
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        title,
        exercises: exercises.map(toSessionExercise),
        startedAt: Date.now(),
        elapsedBeforePauseMs: 0,
        pausedAt: null,
        rest: null
    };
    expandedIndex = null;
    saveState();
    hooks.onChange();
    openWorkout();
    return true;
}

export function startPreset(type) {
    const preset = presetWorkouts[type];
    if (!preset) return false;
    return startSession(type, preset.title, preset.exercises);
}

// Opens workout mode for the running session (or the summary right after finishing).
export function openWorkout() {
    if (!getActiveSession() && $('session-summary').classList.contains('hidden')) return;
    render();
    $('session-pill').classList.add('hidden');
    workoutModal.open();
}

// ---- Timers (timestamps, not counters, so they stay correct if the tab sleeps) ----

function elapsedMs(session, now = Date.now()) {
    const running = session.pausedAt === null ? now - session.startedAt : 0;
    return session.elapsedBeforePauseMs + running;
}

function togglePause() {
    const s = getActiveSession();
    if (!s) return;
    const now = Date.now();
    if (s.pausedAt === null) {
        s.elapsedBeforePauseMs += now - s.startedAt;
        s.pausedAt = now;
        if (s.rest) s.rest.remainingMs = Math.max(0, s.rest.endsAt - now); // freeze rest too
    } else {
        s.startedAt = now;
        s.pausedAt = null;
        if (s.rest && s.rest.remainingMs !== undefined) {
            s.rest.endsAt = now + s.rest.remainingMs;
            delete s.rest.remainingMs;
        }
    }
    saveState();
    render();
}

function startRest(seconds = REST_DEFAULT_SEC) {
    const s = getActiveSession();
    if (!s) return;
    s.rest = { endsAt: Date.now() + seconds * 1000, totalSec: seconds };
    restAlerted = false;
    saveState();
}

function adjustRest(deltaSec) {
    const s = getActiveSession();
    if (!s || !s.rest || s.pausedAt !== null) return;
    s.rest.endsAt += deltaSec * 1000;
    s.rest.totalSec = Math.max(1, s.rest.totalSec + deltaSec);
    saveState();
    updateTimers();
}

function skipRest() {
    const s = getActiveSession();
    if (!s) return;
    s.rest = null;
    saveState();
    updateTimers();
}

function updateTimers() {
    const s = getActiveSession();
    if (!s) return;
    const clock = formatClock(elapsedMs(s) / 1000);
    $('session-timer').textContent = clock;
    $('pill-timer').textContent = clock;

    const restBar = $('rest-timer');
    if (!s.rest) { restBar.classList.add('hidden'); return; }

    const remainingMs = s.rest.remainingMs !== undefined ? s.rest.remainingMs : s.rest.endsAt - Date.now();
    if (remainingMs <= 0) {
        s.rest = null;
        restBar.classList.add('hidden');
        saveState();
        if (!restAlerted) {
            restAlerted = true;
            showToast('Rest over', 'Next set when you are ready.', { icon: 'timer', tone: 'purple' });
        }
        return;
    }
    restBar.classList.remove('hidden');
    $('rest-time').textContent = formatClock(Math.ceil(remainingMs / 1000));
    $('rest-fill').style.width = `${Math.min(100, (remainingMs / (s.rest.totalSec * 1000)) * 100)}%`;
}

function startTicking() {
    stopTicking();
    updateTimers();
    tickHandle = setInterval(updateTimers, 250);
}

function stopTicking() {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
}

// ---- Set and rep tracking ----

function adjustReps(index, delta) {
    const s = getActiveSession();
    const ex = s && s.exercises[index];
    if (!ex) return;
    const step = ex.unit === 'sec' ? 5 * Math.sign(delta) : delta;
    ex.reps = Math.min(999, Math.max(1, ex.reps + step));
    saveState();
    renderExercises();
    $('exercise-list').querySelector(`[data-action="${delta > 0 ? 'reps-up' : 'reps-down'}"][data-index="${index}"]`)?.focus();
}

function floatXp(amount) {
    const el = document.createElement('span');
    el.className = 'xp-float';
    el.textContent = `+${amount} XP`;
    el.setAttribute('aria-hidden', 'true');
    $('active-session-panel').appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

function completeSet(index) {
    const s = getActiveSession();
    const ex = s && s.exercises[index];
    if (!ex || s.pausedAt !== null || ex.sets.length >= ex.targetSets) return;
    const set = { reps: ex.reps };
    ex.sets.push(set);
    const allDone = s.exercises.every(e => e.sets.length >= e.targetSets);
    if (allDone) s.rest = null;
    else startRest();
    expandedIndex = null; // follow the next unfinished exercise
    saveState();
    renderExercises(index);
    updateTimers();
    floatXp(xpForSet(ex, set));
    // After the last set of the workout the finish button is the next thing to reach for.
    if (allDone) $('complete-session-btn').focus();
    else $('exercise-list').querySelector('[data-action="complete-set"]:not(:disabled)')?.focus({ preventScroll: true });
}

function undoSet(index) {
    const s = getActiveSession();
    const ex = s && s.exercises[index];
    if (!ex || ex.sets.length === 0) return;
    ex.sets.pop();
    expandedIndex = index;
    saveState();
    renderExercises();
}

// ---- Finish and discard ----

// XP is granted exactly once: the history record is created and the active session is cleared
// in the same synchronous step, and a re-entrancy guard blocks double clicks.
export function finishSession() {
    if (finishing) return;
    const s = getActiveSession();
    if (!s) return;

    const totals = computeSessionTotals(s);
    if (totals.sets === 0) {
        showToast('Nothing logged', 'Complete at least one set, or discard the session.', { icon: 'timer', tone: 'gold' });
        return;
    }
    if (state.data.workoutHistory.some(h => h.id === s.id)) {
        state.data.activeSession = null; // already recorded (should not happen)
        saveState();
        render();
        return;
    }

    finishing = true;
    try {
        const before = getProgressSnapshot();
        const now = new Date();
        const record = {
            id: s.id,
            date: now.toISOString(),
            dateKey: dateKey(now),
            type: s.type,
            title: s.title,
            exercises: s.exercises.map(e => ({
                id: e.id, name: e.name, unit: e.unit, sets: e.sets.length, reps: e.sets.map(x => x.reps)
            })),
            stats: {
                sets: totals.sets,
                reps: totals.reps,
                xp: totals.xp,
                durationSec: Math.round(elapsedMs(s) / 1000)
            }
        };
        state.data.workoutHistory.push(record);
        state.data.activeSession = null;
        if (!saveState()) showToast('Not saved', 'Browser storage is unavailable. This workout will be lost on reload.', { icon: 'shield', tone: 'gold' });

        stopTicking();
        // The other workout types must be startable again as soon as this one is saved.
        updateSelectionState();
        showSummary(record, totals);
        // Verified events. The game layer settles quests, pays rewards and announces level-ups and ranks.
        record.exercises.forEach(exercise => emit(EVT.EXERCISE_COMPLETED, { record, exercise }));
        emit(EVT.WORKOUT_COMPLETED, { record, before });
        hooks.onChange();
    } finally {
        finishing = false;
    }
}

async function discardSession() {
    const s = getActiveSession();
    if (!s) return;
    const hasWork = s.exercises.some(e => e.sets.length > 0);
    if (hasWork) {
        const ok = await confirmDialog({
            title: 'Discard workout?',
            message: 'Logged sets will not be saved and no XP is awarded.',
            confirmLabel: 'Discard',
            danger: true
        });
        if (!ok || getActiveSession()?.id !== s.id) return;
    }
    state.data.activeSession = null;
    saveState();
    stopTicking();
    workoutModal.close();
    render();
    hooks.onChange();
    showToast('Session discarded', 'No XP was awarded.', { icon: 'x', tone: 'purple' });
}

function showSummary(record, totals) {
    $('summary-reps').textContent = record.stats.reps.toLocaleString();
    $('summary-sets').textContent = record.stats.sets;
    $('summary-time').textContent = formatClock(record.stats.durationSec);
    $('summary-note').textContent = totals.complete
        ? 'All sets complete. Bonus XP included.'
        : `${totals.sets} of ${totals.planned} planned sets done.`;
    const xpEl = $('summary-xp');
    xpEl.dataset.value = '0';
    countTo(xpEl, record.stats.xp, { duration: 900, format: v => `+${v} XP` });

    $('summary-quests')?.replaceChildren();
    $('summary-quests')?.classList.add('hidden');
    $('session-live').classList.add('hidden');
    $('session-summary').classList.remove('hidden');
    $('session-pill').classList.add('hidden');
    if ($('active-session-panel').classList.contains('hidden')) workoutModal.open();
    $('close-session-btn').focus();
}

function closeSummary() {
    $('session-summary').classList.add('hidden');
    $('session-live').classList.remove('hidden');
    workoutModal.close();
}

// ---- Rendering ----

function instructionsFor(name) {
    const lib = exerciseLibrary.find(e => e.name.toLowerCase() === name.toLowerCase());
    return lib ? lib.desc : '';
}

function renderExercises(justCompleted = -1) {
    const list = $('exercise-list');
    const s = getActiveSession();
    if (!list || !s) return;
    const paused = s.pausedAt !== null;
    const currentIdx = s.exercises.findIndex(e => e.sets.length < e.targetSets);
    const open = expandedIndex !== null ? expandedIndex : currentIdx;

    list.innerHTML = s.exercises.map((ex, i) => {
        const done = ex.sets.length;
        const finished = done >= ex.targetSets;
        const isOpen = i === open;
        const unitLabel = ex.unit === 'sec' ? 'seconds' : 'reps';
        const dots = Array.from({ length: ex.targetSets }, (_, n) =>
            `<span class="set-dot${n < done ? ' done' : ''}${i === justCompleted && n === done - 1 ? ' pop' : ''}" aria-hidden="true"></span>`).join('');
        const num = finished ? icon('check', { size: 16 }) : i + 1;
        const logged = ex.sets.map(x => x.reps).join(' · ');
        const help = instructionsFor(ex.name);
        const body = !isOpen ? '' : `
            <div class="ex-body">
                <p class="ex-target">${finished ? 'All sets done' : `Set ${done + 1} of ${ex.targetSets}`} · target ${ex.targetReps}${ex.unit === 'sec' ? ' s' : ' reps'}</p>
                ${finished ? '' : `
                <div class="stepper" role="group" aria-label="${unitLabel} for ${escapeHtml(ex.name)}">
                    <button type="button" class="stepper-btn" data-action="reps-down" data-index="${i}" aria-label="Decrease ${unitLabel}">${icon('minus', { size: 24 })}</button>
                    <div class="stepper-mid"><span class="stepper-val" aria-live="polite">${ex.reps}</span><span class="stepper-unit">${unitLabel}</span></div>
                    <button type="button" class="stepper-btn" data-action="reps-up" data-index="${i}" aria-label="Increase ${unitLabel}">${icon('plus', { size: 24 })}</button>
                </div>
                <button type="button" class="btn btn-primary btn-lg full" data-action="complete-set" data-index="${i}" ${paused ? 'disabled' : ''}>${icon('check', { size: 20 })}Complete set</button>`}
                <div class="ex-actions"><button type="button" class="link-btn" data-action="undo-set" data-index="${i}" ${done === 0 ? 'disabled' : ''}>Undo last set</button></div>
                ${logged ? `<p class="ex-logged">Logged: ${escapeHtml(logged)}</p>` : ''}
                ${help ? `<details class="ex-help"><summary>How to do it</summary><p>${escapeHtml(help)}</p></details>` : ''}
            </div>`;
        return `
            <div class="ex${isOpen ? ' current' : ''}${finished ? ' done' : ''}" data-index="${i}">
                <button type="button" class="ex-head" data-action="toggle" data-index="${i}" aria-expanded="${isOpen}">
                    <span class="ex-num">${num}</span>
                    <span class="ex-name">${escapeHtml(ex.name)}</span>
                    <span class="set-dots" role="img" aria-label="${done} of ${ex.targetSets} sets done">${dots}</span>
                    <span class="ex-sets">${done}/${ex.targetSets}</span>
                </button>
                ${body}
            </div>`;
    }).join('');

    updateHeader(s);
}

function updateHeader(s) {
    const totals = computeSessionTotals(s);
    const paused = s.pausedAt !== null;
    const pct = totals.planned ? Math.round((totals.sets / totals.planned) * 100) : 0;
    $('session-progress').textContent = `${totals.sets} / ${totals.planned} sets · ${totals.xp} XP`;
    $('workout-bar').setAttribute('aria-valuenow', String(pct));
    $('workout-bar-fill').style.width = `${pct}%`;
    const pauseBtn = $('pause-session-btn');
    pauseBtn.innerHTML = icon(paused ? 'play' : 'pause', { size: 20 });
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.setAttribute('aria-label', paused ? 'Resume workout' : 'Pause workout');
    $('session-timer').classList.toggle('paused', paused);
    $('session-pill').classList.toggle('paused', paused);
}

// Rebuilds everything from state. Safe at any time (also used after reload).
export function render() {
    const s = getActiveSession();
    const summaryOpen = !$('session-summary').classList.contains('hidden');

    if (!s) {
        stopTicking();
        $('session-pill').classList.add('hidden');
        if (!summaryOpen) {
            $('session-live').classList.remove('hidden');
            if (!$('active-session-panel').classList.contains('hidden')) workoutModal.close();
        }
        updateSelectionState();
        return;
    }

    $('session-title').textContent = s.title;
    $('pill-title').textContent = s.title;
    $('session-summary').classList.add('hidden');
    $('session-live').classList.remove('hidden');
    // Workout mode itself stays closed on load. The pill is the way back in.
    if ($('active-session-panel').classList.contains('hidden')) $('session-pill').classList.remove('hidden');
    renderExercises();
    startTicking();
    updateSelectionState();
}

function updateSelectionState() {
    const s = getActiveSession();
    document.querySelectorAll('.quick-card').forEach(c => {
        c.classList.toggle('active', !!s && c.dataset.type === s.type);
        c.setAttribute('aria-disabled', String(!!s && c.dataset.type !== s.type));
    });
}

function fillQuickStartMeta() {
    document.querySelectorAll('[data-meta]').forEach(el => {
        const preset = presetWorkouts[el.dataset.meta];
        if (!preset) return;
        const sets = preset.exercises.reduce((n, e) => n + (Number(e.sets) || 0), 0);
        el.textContent = `${preset.exercises.length} exercises · ${sets} sets`;
    });
}

// ---- Setup ----

export function initSession(options) {
    hooks = { ...hooks, ...options };

    workoutModal = setupModal($('active-session-panel'), {
        backdropClose: false,
        onClose: () => {
            // Minimising keeps the session. Closing the summary just returns to the page.
            $('session-summary').classList.add('hidden');
            $('session-live').classList.remove('hidden');
            if (getActiveSession()) $('session-pill').classList.remove('hidden');
        }
    });

    $('exercise-list').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || btn.disabled) return;
        const index = Number(btn.dataset.index);
        switch (btn.dataset.action) {
            case 'reps-up': adjustReps(index, 1); break;
            case 'reps-down': adjustReps(index, -1); break;
            case 'complete-set': completeSet(index); break;
            case 'undo-set': undoSet(index); break;
            case 'toggle': {
                const s = getActiveSession();
                const cur = s.exercises.findIndex(x => x.sets.length < x.targetSets);
                const isOpen = (expandedIndex !== null ? expandedIndex : cur) === index;
                expandedIndex = isOpen ? -1 : index;
                renderExercises();
                $('exercise-list').querySelector(`.ex-head[data-index="${index}"]`)?.focus({ preventScroll: true });
                break;
            }
        }
    });

    $('complete-session-btn').addEventListener('click', finishSession);
    $('discard-session-btn').addEventListener('click', discardSession);
    $('pause-session-btn').addEventListener('click', togglePause);
    $('close-session-btn').addEventListener('click', closeSummary);
    $('rest-skip').addEventListener('click', skipRest);
    $('rest-plus').addEventListener('click', () => adjustRest(REST_STEP_SEC));
    $('rest-minus').addEventListener('click', () => adjustRest(-REST_STEP_SEC));
    $('session-pill').addEventListener('click', openWorkout);

    document.querySelectorAll('.quick-card').forEach(card => {
        card.addEventListener('click', () => startPreset(card.dataset.type));
    });

    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTimers(); });

    fillQuickStartMeta();
    render();
}
