// Weekly schedule, program generator, exercise library, history modal, "today's plan" card.
import { state, saveState } from './state.js';
import { exerciseLibrary, buildWorkout, SESSION_TYPES } from './exercises.js';
import { startSession, getActiveSession, openWorkout } from './session.js';
import { icon } from './icons.js';
import { escapeHtml, capitalize, showToast, setupModal, formatClock } from './utils.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LIBRARY_FILTERS = ['all', 'push', 'pull', 'legs', 'core', 'skill', 'mobility'];

let libraryFilter = 'all';
let historyModal = null;
let exerciseModal = null;

const $ = id => document.getElementById(id);

function todayIndex() {
    const name = DAY_NAMES[new Date().getDay()];
    return state.data.weeklySchedule.findIndex(d => d.day === name);
}

// Fill in exercises for any training day that has none (fresh state or older saves).
function ensureScheduleExercises() {
    let changed = false;
    state.data.weeklySchedule.forEach(day => {
        if (day.type !== 'rest' && day.exercises.length === 0) {
            day.exercises = buildWorkout(day.type);
            changed = true;
        }
    });
    if (changed) saveState();
}

// ---- Weekly schedule ----

export function renderWeeklySchedule() {
    const grid = $('weekly-schedule');
    if (!grid) return;
    const today = todayIndex();

    grid.innerHTML = state.data.weeklySchedule.map((day, i) => {
        const rest = day.type === 'rest';
        const isToday = i === today;
        const count = day.exercises.length;
        return `
            <button type="button" role="listitem" class="day-card${rest ? ' rest-day' : ''}${isToday ? ' active-day' : ''}" data-day-index="${i}"
                aria-label="${escapeHtml(day.day)}${isToday ? ' (today)' : ''}: ${escapeHtml(day.title)}${rest ? '' : `, ${count} exercises`}">
                <span class="day-name">${escapeHtml(day.day)}${isToday ? ' · Today' : ''}</span>
                <span class="workout-type">${escapeHtml(day.title)}</span>
                <span class="workout-duration">${rest ? 'Relax' : `${count} exercises`}</span>
            </button>`;
    }).join('');
}

function startScheduledDay(index) {
    const day = state.data.weeklySchedule[index];
    if (!day) return false;
    if (day.type === 'rest') {
        showToast('Rest day', 'Recovery builds strength. Pick a workout below if you want to train.', { icon: 'activity', tone: 'purple' });
        return false;
    }
    return startSession(day.type, day.title, day.exercises);
}

// Public: used by the "Start Training" buttons.
export function startTodaysWorkout() {
    const index = todayIndex();
    return index >= 0 ? startScheduledDay(index) : false;
}

export function renderTodayPlan() {
    const box = $('today-plan');
    if (!box) return;
    const index = todayIndex();
    const day = state.data.weeklySchedule[index];
    const active = getActiveSession();

    const head = (kicker, title, sub) => `
        <p class="eyebrow">${kicker}</p>
        <h2 class="today-title">${escapeHtml(title)}</h2>
        <p class="today-sub">${sub}</p>`;

    if (active) {
        const done = active.exercises.reduce((n, e) => n + e.sets.length, 0);
        const planned = active.exercises.reduce((n, e) => n + e.targetSets, 0);
        box.innerHTML = `${head('In progress', active.title, `${done} of ${planned} sets done`)}
            <button type="button" class="btn btn-primary btn-lg full" data-today-action="resume">${icon('play', { size: 20 })}Resume workout</button>`;
    } else if (!day || day.type === 'rest') {
        box.innerHTML = `${head("Today's objective", 'Rest day', 'Recovery counts. You can still pick any workout in Training.')}
            <button type="button" class="btn btn-ghost btn-lg full" data-scroll-target="training">${icon('dumbbell', { size: 20 })}Choose a workout</button>`;
    } else {
        const list = day.exercises.slice(0, 4).map(e =>
            `<li>${escapeHtml(e.name)}<span>${e.sets} × ${e.reps}${e.unit === 'sec' ? 's' : ''}</span></li>`).join('');
        const more = day.exercises.length > 4 ? `<li class="muted">+${day.exercises.length - 4} more<span></span></li>` : '';
        box.innerHTML = `${head("Today's objective", day.title, `${day.exercises.length} exercises`)}
            <ul class="today-list">${list}${more}</ul>
            <button type="button" class="btn btn-primary btn-lg full" id="start-today-btn" data-today-action="start">${icon('play', { size: 20 })}Start workout</button>`;
    }
}

// ---- Generator ----

function generateNewSchedule() {
    if (getActiveSession()) {
        showToast('Session in progress', 'Finish your workout before changing the plan.');
        return;
    }
    const schedule = state.data.weeklySchedule;
    let lastType = null;

    schedule.forEach(day => {
        if (day.day === 'Sun') {
            Object.assign(day, { type: 'rest', title: 'Rest Day', exercises: [] });
            lastType = 'rest';
            return;
        }
        if (Math.random() < 0.2 && lastType !== 'rest') {
            Object.assign(day, { type: 'rest', title: 'Active Recovery', exercises: [] });
            lastType = 'rest';
            return;
        }
        const options = SESSION_TYPES.filter(t => t !== lastType);
        const type = options[Math.floor(Math.random() * options.length)];

        // Avoid exercises from the last session of this type.
        const last = [...state.data.workoutHistory].reverse().find(h => h.type === type);
        const avoid = last ? last.exercises.map(e => e.id) : [];

        Object.assign(day, { type, title: `${capitalize(type)} Session`, exercises: buildWorkout(type, avoid) });
        lastType = type;
    });

    // Guarantee a usable week: at least 3 training days.
    const training = () => schedule.filter(d => d.type !== 'rest').length;
    for (const day of schedule) {
        if (training() >= 3) break;
        if (day.type === 'rest' && day.day !== 'Sun') {
            const type = SESSION_TYPES[Math.floor(Math.random() * SESSION_TYPES.length)];
            Object.assign(day, { type, title: `${capitalize(type)} Session`, exercises: buildWorkout(type) });
        }
    }

    saveState();
    renderWeeklySchedule();
    renderTodayPlan();
    showToast('New Program Generated', 'Your weekly schedule has been updated!');
}

// ---- Exercise library ----

export function renderLibrary() {
    const filters = $('library-filters');
    const grid = $('library-grid');
    if (!grid) return;

    if (filters) {
        filters.innerHTML = LIBRARY_FILTERS.map(f => `
            <button type="button" class="chip${f === libraryFilter ? ' active' : ''}" data-library-filter="${f}" aria-pressed="${f === libraryFilter}">${capitalize(f)}</button>`).join('');
    }

    const items = exerciseLibrary.filter(ex => libraryFilter === 'all' || ex.type === libraryFilter);
    grid.innerHTML = items.map(ex => `
        <button type="button" class="exercise-card" data-exercise-id="${escapeHtml(ex.id)}" aria-label="${escapeHtml(ex.name)}, level ${ex.difficulty}. Open details">
            <div class="exercise-thumb" aria-hidden="true">${icon(ex.type === 'legs' ? 'footprints' : (ex.type === 'core' || ex.type === 'mobility') ? 'activity' : ex.type === 'skill' ? 'target' : 'dumbbell', { size: 32 })}</div>
            <div class="exercise-body">
                <h4>${escapeHtml(ex.name)}</h4>
                <div class="exercise-tags">
                    <span class="badge">${escapeHtml(capitalize(ex.type))}</span>
                    <span class="badge">Lvl ${ex.difficulty}</span>
                </div>
            </div>
        </button>`).join('');
}

function openExercise(id) {
    const ex = exerciseLibrary.find(e => e.id === id);
    if (!ex) return;
    $('modal-exercise-title').textContent = ex.name;
    $('modal-description').textContent = ex.desc;
    const tags = $('modal-tags');
    tags.replaceChildren(...[capitalize(ex.type), ...ex.tags, ex.unit === 'sec' ? 'Timed hold' : 'Reps'].map(t => {
        const span = document.createElement('span');
        span.className = 'badge';
        span.textContent = t;
        return span;
    }));
    $('modal-stars').textContent = '★'.repeat(ex.difficulty) + '☆'.repeat(3 - ex.difficulty);
    $('modal-stars').setAttribute('aria-label', `${ex.difficulty} of 3`);
    exerciseModal.open();
}

// ---- History ----

function renderHistory() {
    const list = $('history-list');
    if (!list) return;
    const history = state.data.workoutHistory;
    if (history.length === 0) {
        list.innerHTML = '<div class="empty">No completed workouts yet. Finish a session and it shows up here.</div>';
        return;
    }
    const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
    list.innerHTML = sorted.map(h => {
        const date = new Date(h.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const names = h.exercises.map(e => escapeHtml(e.name)).join(', ');
        return `
            <div class="history-item">
                <div class="history-top">
                    <span>${escapeHtml(h.title || `${capitalize(h.type)} Session`)}</span>
                    <span class="history-date">${escapeHtml(date)}</span>
                </div>
                ${names ? `<p class="history-exercises">${names}</p>` : ''}
                <div class="history-stats">
                    <span>${h.stats.sets} Sets</span>
                    <span>${h.stats.reps} Reps</span>
                    ${h.stats.durationSec ? `<span>${formatClock(h.stats.durationSec)}</span>` : ''}
                    <span class="xp-gain">+${h.stats.xp} XP</span>
                </div>
            </div>`;
    }).join('');
}

// ---- Setup ----

export function initPrograms() {
    ensureScheduleExercises();

    historyModal = setupModal($('history-modal'));
    exerciseModal = setupModal($('exercise-modal'));

    $('weekly-schedule')?.addEventListener('click', e => {
        const card = e.target.closest('.day-card');
        if (card) startScheduledDay(Number(card.dataset.dayIndex));
    });

    $('generate-program-btn')?.addEventListener('click', generateNewSchedule);

    $('view-history-btn')?.addEventListener('click', () => {
        renderHistory();
        historyModal.open();
    });

    $('library-filters')?.addEventListener('click', e => {
        const chip = e.target.closest('[data-library-filter]');
        if (!chip) return;
        libraryFilter = chip.dataset.libraryFilter;
        renderLibrary();
        $('library-filters').querySelector('.chip.active')?.focus();
    });

    $('library-grid')?.addEventListener('click', e => {
        const card = e.target.closest('[data-exercise-id]');
        if (card) openExercise(card.dataset.exerciseId);
    });

    $('today-plan')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-today-action]');
        if (!btn) return;
        if (btn.dataset.todayAction === 'start') startTodaysWorkout();
        else if (btn.dataset.todayAction === 'resume') openWorkout();
    });

    renderWeeklySchedule();
    renderTodayPlan();
    renderLibrary();
}
