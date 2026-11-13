// Screen router. CalaLevel is a set of screens, not one long page.
//
// Five main screens are reached from the bottom bar (and the header on wide screens):
//   home, quests, train, discover, profile.
// Discover opens three secondary screens: skills, arena (Battle Arena) and map. They show a back button.
//
// Rules:
// - Only one screen is in the layout at a time, so each screen scrolls on its own.
// - Each tab keeps its place: its last screen and the scroll position of every screen.
// - Secondary screens are pushed on the browser history, so the phone's back gesture and the app's back
//   button do the same thing. Main screens replace the current history entry.
// - Old hash links still work (#top, #training, #community, #programs, #features).
import { smoothScrollTo } from './utils.js';

const ALIASES = {
    top: 'home',
    training: 'train',
    community: 'arena',
    features: 'discover',
    programs: { route: 'train', anchor: 'programs' }
};

const screens = {};          // route -> element
const scrolls = {};          // route -> last scrollY
const lastInTab = {};        // tab -> last route shown in that tab
const listeners = new Set();
let guard = null;            // (route) => route to show instead, or null. Set by the app gate (js/auth/gate.js).
let wanted = null;           // the screen the URL asked for while the app was still loading
let current = null;
let currentTab = null;
let depth = 0;               // how many secondary screens sit on top of a main screen in the history

const $ = id => document.getElementById(id);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resolve(hash) {
    const id = String(hash || '').replace(/^#\/?/, '');
    if (!id) return { route: 'home' };
    const alias = ALIASES[id];
    if (alias) return typeof alias === 'string' ? { route: alias } : { route: alias.route, anchor: alias.anchor };
    return screens[id] ? { route: id } : null;
}

const isSecondary = route => !!screens[route]?.dataset.parent;
const isFlow = route => !!screens[route]?.dataset.flow;   // sign-in, onboarding and legal screens: no header, no tab bar
const tabOf = route => screens[route].dataset.tab;
const guarded = route => { const g = guard && guard(route); return g && screens[g] ? g : route; };

function setChrome(route) {
    const el = screens[route];
    const flow = isFlow(route);
    document.body.classList.toggle('in-flow', flow);
    if (flow) {
        document.querySelectorAll('a[data-tab]').forEach(a => { a.classList.remove('active'); a.removeAttribute('aria-current'); });
        document.title = `${el.dataset.title} · CalaLevel`;
        return;
    }
    const tab = tabOf(route);
    document.querySelectorAll('a[data-tab]').forEach(a => {
        const active = a.dataset.tab === tab;
        a.classList.toggle('active', active);
        if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const header = $('site-header');
    const secondary = isSecondary(route);
    header.classList.toggle('is-secondary', secondary);
    $('nav-back').classList.toggle('hidden', !secondary);
    $('nav-title').classList.toggle('hidden', !secondary);
    $('nav-title').textContent = secondary ? el.dataset.title : '';
    if (secondary) {
        const parent = screens[el.dataset.parent];
        $('nav-back').setAttribute('aria-label', `Back to ${parent ? parent.dataset.title : 'Home'}`);
    }
    document.title = `${el.dataset.title} · CalaLevel`;
}

function showScreen(route, { dir = 'fade', anchor = null, initial = false } = {}) {
    const el = screens[route];
    if (!el) return;
    if (current === route) {
        if (anchor) scrollToAnchor(anchor);
        return;
    }
    if (current) {
        scrolls[current] = window.scrollY;
        screens[current].hidden = true;
    } else {
        Object.values(screens).forEach(other => { if (other !== el) other.hidden = true; }); // first screen: hide the boot splash
    }
    el.hidden = false;
    if (!initial) {
        el.classList.remove('enter-fade', 'enter-push', 'enter-pop');
        void el.offsetWidth; // restart the animation
        el.classList.add(`enter-${dir}`);
        el.addEventListener('animationend', () => el.classList.remove('enter-fade', 'enter-push', 'enter-pop'), { once: true });
    }
    // Back to where the user left this screen (top the first time).
    window.scrollTo({ top: anchor ? 0 : scrolls[route] || 0, behavior: 'instant' });
    if (route !== 'boot') wanted = null;
    current = route;
    currentTab = isFlow(route) ? null : tabOf(route);
    if (currentTab) lastInTab[currentTab] = route;
    setChrome(route);
    if (anchor) requestAnimationFrame(() => scrollToAnchor(anchor));
    if (!initial) {
        const heading = el.querySelector('h1, h2');
        if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
        $('screen-announcer').textContent = el.dataset.title;
    }
    listeners.forEach(fn => { try { fn({ route, tab: currentTab, secondary: isSecondary(route), flow: isFlow(route) }); } catch (e) { console.warn(e); } });
}

function scrollToAnchor(id) {
    const el = $(id);
    if (el) smoothScrollTo(el);
}

// Go to a screen. Secondary screens are pushed on the history, main screens replace the current entry.
export function navigate(target, { replace = false, dir } = {}) {
    let r = typeof target === 'string' ? resolve(target) : target;
    if (!r || !screens[r.route]) return false;
    const allowed = guarded(r.route);
    if (allowed !== r.route) { r = { route: allowed }; replace = true; }
    const secondary = isSecondary(r.route);
    const push = secondary && !replace && current !== r.route;
    if (push) depth += 1;
    else if (replace || !secondary) { if (!secondary) depth = 0; }
    try {
        const state = { cala: 1, d: depth };
        if (push) history.pushState(state, '', `#${r.route}`);
        else history.replaceState(state, '', `#${r.route}`);
    } catch (e) { /* history can be blocked in some embedded views */ }
    showScreen(r.route, { dir: dir || (push ? 'push' : 'fade'), anchor: r.anchor });
    return true;
}

// The app's back button. Same result as the phone's back gesture.
export function goBack() {
    if (!current) return;
    if (history.state && history.state.cala && history.state.d > 0) { history.back(); return; }
    const parent = screens[current].dataset.parent || (isFlow(current) ? 'welcome' : 'home');
    navigate(parent, { replace: true, dir: 'pop' });
}

export const currentRoute = () => current;
export const setGuard = fn => { guard = fn; };
// Call when the app status changes (login, logout, onboarding step): moves away from a screen that is no longer allowed.
export function revalidate() {
    if (!current) return;
    if (wanted && current === 'boot') {                  // loading is over: go where the URL pointed, if the user may
        const target = guarded(wanted.route);
        if (target !== 'boot') { const w = wanted; wanted = null; navigate(w, { replace: true }); return; }
    }
    const allowed = guarded(current);
    if (allowed !== current) navigate(allowed, { replace: true });
}
export const onScreenChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

function tapTab(tab) {
    if (!currentTab && !tab) return;
    if (tab === currentTab) {
        if (isSecondary(current)) navigate(tab, { replace: true, dir: 'pop' });
        else window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        return;
    }
    navigate(lastInTab[tab] || tab);
}

export function initRouter() {
    document.querySelectorAll('[data-screen]').forEach(el => { screens[el.dataset.screen] = el; });

    document.addEventListener('click', e => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const tab = e.target.closest('a[data-tab]');
        if (tab) { e.preventDefault(); tapTab(tab.dataset.tab); return; }
        const anchor = e.target.closest('a[href^="#"]');
        if (anchor) {
            if (anchor.hasAttribute('data-skip')) {
                e.preventDefault();
                const heading = screens[current]?.querySelector('h1, h2');
                if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
                return;
            }
            const r = resolve(anchor.getAttribute('href'));
            if (r) { e.preventDefault(); navigate(r); }
            return;
        }
        const btn = e.target.closest('[data-scroll-target]');
        if (btn) { const r = resolve(btn.dataset.scrollTarget); if (r) navigate(r); }
    });
    $('nav-back').addEventListener('click', goBack);

    window.addEventListener('popstate', e => {
        let r = resolve(location.hash) || { route: 'home' };
        const allowedRoute = guarded(r.route);
        if (allowedRoute !== r.route) r = { route: allowedRoute };
        const stamped = e.state && e.state.cala;
        const d = stamped ? e.state.d : (isSecondary(r.route) ? depth + 1 : 0);
        const dir = d < depth ? 'pop' : (isSecondary(r.route) && d > depth ? 'push' : 'fade');
        depth = d;
        if (!stamped || location.hash !== `#${r.route}`) { try { history.replaceState({ cala: 1, d }, '', `#${r.route}`); } catch (err) { /* ignore */ } }
        showScreen(r.route, { dir, anchor: r.anchor });
    });

}

// Shows the first screen. Call once, after the app gate knows who the user is.
export function startRouter() {
    let first = resolve(location.hash) || { route: 'home' };
    wanted = first;
    const allowed = guarded(first.route);
    if (allowed !== first.route) first = { route: allowed };
    // A secondary screen opened by URL has nothing behind it, so it starts at depth 0 and "back" goes to its parent.
    try { history.replaceState({ cala: 1, d: 0 }, '', `#${first.route}`); } catch (e) { /* ignore */ }
    showScreen(first.route, { initial: true, anchor: first.anchor });
}
