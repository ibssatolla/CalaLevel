import { initMap } from './js/map.js';
import { state, bootNotes, switchMode, isDemo } from './js/state.js';
import { initNav } from './js/nav.js';
import { initSession, openWorkout } from './js/session.js';
import { initPrograms, renderTodayPlan, startTodaysWorkout } from './js/programs.js';
import { initSkills, renderSkills } from './js/skills.js';
import { initBattles, renderBattles } from './js/battles.js';
import { initDashboard, renderDashboard } from './js/dashboard.js';
import { renderProfile, initProfile } from './js/profile.js';
import { getTotalXp, levelProgress } from './js/progression.js';
import { initGame, bootGame, runDailyCycle } from './js/game.js';
import { on, EVT } from './js/events.js';
import { initQuestsUi, renderQuestsUi } from './js/quests-ui.js';
import { initCharacterUi, renderCharacter } from './js/character-ui.js';
import { hydrateIcons } from './js/icons.js';
import { exerciseLibrary } from './js/exercises.js';
import { setupModal, showToast } from './js/utils.js';
import { navigate, onScreenChange, initRouter, startRouter, setGuard } from './js/router.js';
import { initGate, gate, routeGuard, onGateChange, captureAuthReturn } from './js/auth/gate.js';
import { initAuthUi } from './js/auth/ui.js';
import { initOnboardingUi } from './js/onboarding/ui.js';
import { initAccountUi, renderProfileAccountCard } from './js/auth/account-ui.js';
import { setSyncHooks } from './js/cloud/sync.js';

let refreshApp = null;   // set by startApp, used when the account data is reloaded

// The main app. Starts once, and only when the user may see it: a finished account (ready) or demo mode.
// Quests are created here (bootGame), so a new account gets none until its setup is complete.
function startApp() {
    if (!bootNotes.storageOk) setTimeout(() => showToast('Progress cannot be saved', 'Browser storage is blocked (private mode?). Your progress will be lost when you close the page.', { icon: 'shield', tone: 'gold' }), 600);
    if (bootNotes.recovered) setTimeout(() => showToast('Saved data was unreadable', 'A copy was kept in your browser. You are starting fresh.', { icon: 'shield', tone: 'gold' }), 900);
    if (bootNotes.movedToDemo) setTimeout(() => showToast('Your account now starts at zero', 'The sample progress from before is kept in demo mode. Nothing was deleted.', { icon: 'sparkles', tone: 'purple' }), 900);

    // 3D core (Spline). Optional, desktop only, and loaded only when the card is close to the screen.
    // Without it (small screen, reduced motion, data saver, slow load) a light CSS orb is shown instead.
    let splineRequested = false;
    function loadSpline() {
        const stage = document.getElementById('core-stage');
        if (splineRequested || !stage) return;
        splineRequested = true;
        document.getElementById('core-load-btn')?.classList.add('hidden');
        const script = document.createElement('script');
        script.type = 'module';
        script.src = 'https://unpkg.com/@splinetool/viewer@1.9.59/build/spline-viewer.js';
        script.onerror = () => { splineRequested = false; };
        document.head.appendChild(script);
        const viewer = document.createElement('spline-viewer');
        viewer.setAttribute('url', 'https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode');
        viewer.setAttribute('aria-hidden', 'true');
        viewer.addEventListener('load-complete', () => {
            document.getElementById('core-fallback')?.classList.add('hidden');
            update3DCore();
        }, { once: true });
        stage.appendChild(viewer);
    }
    const wide = window.matchMedia('(min-width: 1024px)');
    const prefersLess = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
        || window.matchMedia('(prefers-reduced-data: reduce)').matches
        || navigator.connection?.saveData === true;
    let coreNear = false;
    function maybeLoadSpline() {
        const btn = document.getElementById('core-load-btn');
        if (!wide.matches) return;
        if (prefersLess()) { btn?.classList.toggle('hidden', splineRequested); return; } // opt in with the button
        if (coreNear) loadSpline();
    }
    wide.addEventListener('change', maybeLoadSpline);
    document.getElementById('core-load-btn')?.addEventListener('click', loadSpline);
    const coreCard = document.getElementById('core-card');
    if (coreCard && 'IntersectionObserver' in window) {
        new IntersectionObserver(entries => {
            coreNear = entries.some(e => e.isIntersecting);
            if (coreNear) maybeLoadSpline();
        }, { rootMargin: '300px' }).observe(coreCard);
    }

    function update3DCore() {
        const viewer = document.querySelector('spline-viewer');
        if (!viewer || typeof viewer.setVariable !== 'function') return;
        try {
            const xp = getTotalXp();
            viewer.setVariable('Level', levelProgress(xp).level);
            viewer.setVariable('XP', xp);
        } catch (e) {
            console.warn('Spline variable update failed:', e);
        }
    }

    // Discover hub: short status lines from real data only.
    function renderDiscover() {
        const skills = state.data.skills;
        const open = skills.filter(k => k.status === 'unlocked' || k.status === 'mastered').length;
        const sk = document.getElementById('disc-skills-status');
        if (sk) sk.textContent = `${open} of ${skills.length} skills unlocked`;
        const ar = document.getElementById('disc-arena-status');
        if (ar) {
            const n = state.data.challenges.filter(c => c.status === 'Open').length;
            ar.textContent = n ? `${n} open ${n === 1 ? 'challenge' : 'challenges'}` : 'No open challenges yet';
        }
    }

    function renderTrainHub() {
        const el = document.getElementById('train-library-status');
        if (el) el.textContent = `${exerciseLibrary.length} exercises`;
    }

    // One refresh. Anything that changes progress calls this, so every part of the page reads the same state.
    function refreshAll() {
        renderDashboard();
        renderQuestsUi();
        renderCharacter();
        renderProfile();
        renderBattles();
        renderSkills();
        renderTodayPlan();
        renderDiscover();
        renderTrainHub();
        update3DCore();
        const lvl = document.getElementById('core-level');
        if (lvl) lvl.textContent = levelProgress(getTotalXp()).level;
        document.getElementById('welcome-note')?.classList.toggle('hidden', state.data.workoutHistory.length > 0 || state.data.userProfile.baseline.workouts > 0);
    }

    // The map libraries (and tile requests) load only when the map is about to be seen.
    function loadAsset(tag, attrs) {
        return new Promise((resolve, reject) => {
            const el = document.createElement(tag);
            Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
            el.onload = resolve;
            el.onerror = () => reject(new Error(`Could not load ${attrs.src || attrs.href}`));
            document.head.appendChild(el);
        });
    }
    let mapStarted = false;
    async function startMap() {
        if (mapStarted) return;
        mapStarted = true;
        try {
            await Promise.all([
                loadAsset('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=', crossorigin: '' }),
                loadAsset('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css' })
            ]);
            await loadAsset('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=', crossorigin: '' });
            await loadAsset('script', { src: 'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js' }).catch(() => {}); // only needed for routes
            initMap();
        } catch (err) {
            console.warn(err);
            mapStarted = false;
            document.getElementById('map-skeleton')?.remove();
            const box = document.getElementById('map-container');
            box.innerHTML = '<div class="map-retry"><p>The map could not be loaded. Check your connection.</p><button type="button" class="btn btn-primary btn-sm" id="map-retry-btn">Try again</button></div>';
            document.getElementById('map-retry-btn').addEventListener('click', () => { box.innerHTML = ''; startMap(); });
        }
    }
    function setupLazyMap() {
        const wrap = document.querySelector('.map-wrap');
        if (!wrap || !('IntersectionObserver' in window)) { startMap(); return; }
        const io = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) { io.disconnect(); startMap(); }
        }, { rootMargin: '500px' });
        io.observe(wrap);
    }

    // Demo mode banner and switch
    const banner = document.getElementById('demo-banner');
    banner.classList.toggle('hidden', !isDemo());
    document.getElementById('exit-demo-btn').addEventListener('click', () => switchMode('live'));

    // Level-up celebration
    const levelUpModal = setupModal(document.getElementById('levelup-modal'));
    const confetti = document.getElementById('confetti');
    function burstConfetti() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const colors = ['#22e1ee', '#7c3aed', '#fbbf24', '#b9a2ff', '#4ade80'];
        confetti.replaceChildren(...Array.from({ length: 40 }, (_, i) => {
            const piece = document.createElement('i');
            piece.style.cssText = `left:${Math.random() * 100}%;--c:${colors[i % colors.length]};--x:${Math.round(Math.random() * 120 - 60)}px;--d:${(1.8 + Math.random() * 1.4).toFixed(2)}s;--delay:${(Math.random() * 0.4).toFixed(2)}s`;
            return piece;
        }));
    }
    function showLevelUp(level, rank) {
        document.getElementById('levelup-title').textContent = `Level ${level}`;
        document.getElementById('levelup-rank').textContent = rank;
        const p = levelProgress(getTotalXp());
        document.getElementById('levelup-xp').textContent = `${p.toNext.toLocaleString()} XP to level ${level + 1}`;
        burstConfetti();
        levelUpModal.open();
    }

    // "Start workout" buttons: resume a running session, start today's plan, or open the Train screen on a rest day.
    function startTrainingFlow() {
        if (state.data.activeSession) { openWorkout(); return; }
        if (startTodaysWorkout()) return;
        navigate('train');
    }

    // Game layer: listeners first, then the first daily cycle (gives existing players a character and today's quests).
    initGame();
    initQuestsUi({ onChange: refreshAll });
    on(EVT.LEVEL_UP, ({ level, rank }) => showLevelUp(level, rank.title));
    on(EVT.RANK_UNLOCKED, ({ rank }) => showToast('New rank', rank.title, { icon: 'award', tone: 'gold' }));
    bootGame();
    if (bootNotes.upgraded) setTimeout(() => showToast('Upgraded to the new version', 'Your XP, history and skills are kept. A backup copy is stored in your browser.', { icon: 'shield', tone: 'purple' }), 1200);

    // A new local day while the page is open: settle yesterday, create today's quests.
    function scheduleDailyCheck() {
        const next = new Date();
        next.setHours(24, 0, 1, 0);
        setTimeout(() => { runDailyCycle(); refreshAll(); scheduleDailyCheck(); }, Math.max(1000, next - Date.now()));
    }
    scheduleDailyCheck();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { runDailyCycle(); refreshAll(); } });

    initNav({ onStartTraining: startTrainingFlow });
    refreshApp = refreshAll;
    if (!isDemo()) setSyncHooks({ onHydrated: refreshAll, onSessionLost: () => showToast('Session expired', 'Log in again to send your changes. They are kept on this device.', { icon: 'shield', tone: 'gold' }), onRejected: ({ code }) => showToast('Workout not counted', code === 'daily_xp_cap' ? 'The daily XP limit was reached.' : 'The server could not accept that workout.', { icon: 'shield', tone: 'gold' }) });
    // The map needs a size check when its screen is shown again (Leaflet listens for window resize).
    onScreenChange(({ route }) => { if (route === 'map') window.dispatchEvent(new Event('resize')); });
    setupLazyMap();
    initSkills({ onChange: refreshAll });
    initBattles();
    initSession({ onChange: refreshAll, onLevelUp: showLevelUp });
    initPrograms();
    initDashboard({ onChange: refreshAll });
    initProfile({ onChange: refreshAll });
    initCharacterUi({ onChange: refreshAll });
    refreshAll();
    renderProfileAccountCard();
    maybeLoadSpline();

    // Sections fade in once as they scroll into view. Without IntersectionObserver they are simply shown.
    const reveals = [...document.querySelectorAll('.screen > .section, .dash-grid > .card')];
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(entries => entries.forEach(entry => {
            if (entry.isIntersecting) { entry.target.classList.add('in-view'); io.unobserve(entry.target); }
        }), { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
        reveals.forEach(el => { el.classList.add('reveal'); io.observe(el); });
    }
}

document.documentElement.classList.add('js');

// Start-up order: icons and screens, then the gate (who is the user?), then the app, then the first screen.
document.addEventListener('DOMContentLoaded', async () => {
    hydrateIcons(document);
    initRouter();
    setGuard(routeGuard);
    initAuthUi();
    initOnboardingUi();
    initAccountUi();
    let started = false;
    const ensureApp = () => {
        if (!started && (gate.status === 'ready' || gate.status === 'demo')) { started = true; startApp(); }
        else if (started && (gate.status === 'ready' || gate.status === 'demo') && refreshApp) { refreshApp(); renderProfileAccountCard(); }
        else if (started && gate.status === 'guest') location.reload();   // signed out elsewhere: drop everything held in memory
    };
    onGateChange(ensureApp);
    captureAuthReturn();                 // reads ?code= / ?error= from an email link before any screen is chosen
    startRouter();                       // shows the loading screen while the gate works
    await initGate();
    ensureApp();
});
