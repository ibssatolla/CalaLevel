// Shared UI helpers.
import { icon } from './icons.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escape any value before it is placed into an HTML template string.
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

export function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

let toastRegion = null;

function getToastRegion() {
    if (toastRegion && document.body.contains(toastRegion)) return toastRegion;
    toastRegion = document.createElement('div');
    toastRegion.className = 'toast-region';
    toastRegion.setAttribute('role', 'status');
    toastRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRegion);
    return toastRegion;
}

// Toasts are built with textContent, so titles and messages can never inject markup.
// options: { icon: icon name, tone: 'primary' | 'gold' | 'success' | 'purple' }
export function showToast(title, message, { icon: iconName = 'zap', tone = 'primary' } = {}) {
    const toast = document.createElement('div');
    toast.className = `toast-notification tone-${tone}`;

    const iconBox = document.createElement('div');
    iconBox.className = 'toast-icon';
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.innerHTML = icon(iconName, { size: 18 });

    const content = document.createElement('div');
    content.className = 'toast-content';
    const titleEl = document.createElement('span');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;
    const msgEl = document.createElement('span');
    msgEl.className = 'toast-message';
    msgEl.textContent = message;
    content.append(titleEl, msgEl);

    toast.append(iconBox, content);
    getToastRegion().appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 50);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3800);
}

// "YYYY-MM-DD" in the user's local time zone.
export function dateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function addDays(key, delta) {
    const [y, m, d] = key.split('-').map(Number);
    return dateKey(new Date(y, m - 1, d + delta));
}

// 75 -> "01:15", 3725 -> "1:02:05"
export function formatClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function smoothScrollTo(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

// Accessible modal: focus moves in on open, Escape and backdrop click close it, focus returns on close.
export function setupModal(modal, { onClose, backdropClose = true } = {}) {
    let lastFocus = null;

    function open() {
        lastFocus = document.activeElement;
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        const focusTarget = modal.querySelector('[data-autofocus], .close-btn, button');
        if (focusTarget) focusTarget.focus();
    }

    function close() {
        if (modal.classList.contains('hidden')) return;
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        if (onClose) onClose();
    }

    modal.addEventListener('click', e => { if (backdropClose && e.target === modal) close(); });
    modal.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', close));
    modal.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
        if (e.key !== 'Tab') return;
        // Keep Tab inside the dialog.
        const focusable = [...modal.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')]
            .filter(el => !el.disabled && el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    return { open, close };
}

// Promise-based replacement for window.confirm. Resolves true on confirm, false on cancel, Escape or backdrop.
let confirmHandle = null;
let confirmResolve = null;

export function confirmDialog({ title = 'Confirm', message = '', confirmLabel = 'Confirm', danger = false } = {}) {
    const modal = document.getElementById('confirm-modal');
    if (!modal) return Promise.resolve(window.confirm(message));
    if (!confirmHandle) {
        confirmHandle = setupModal(modal, {
            onClose: () => { if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(false); } }
        });
        document.getElementById('confirm-ok').addEventListener('click', () => {
            const r = confirmResolve;
            confirmResolve = null;
            confirmHandle.close();
            if (r) r(true);
        });
    }
    if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(false); }
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const ok = document.getElementById('confirm-ok');
    ok.textContent = confirmLabel;
    ok.classList.toggle('btn-danger', danger);
    return new Promise(resolve => { confirmResolve = resolve; confirmHandle.open(); });
}

// Count a number up to its new value. Respects reduced motion. Remembers the last shown value per element.
export function countTo(el, value, { duration = 700, format = v => v.toLocaleString() } = {}) {
    if (!el) return;
    const from = Number(el.dataset.value ?? 0);
    el.dataset.value = String(value);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from === value || !el.isConnected) { el.textContent = format(value); return; }
    const start = performance.now();
    const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = format(Math.round(from + (value - from) * eased));
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// Player-chosen text: no control characters or angle brackets, one space between words, limited length.
export function cleanText(value, max = 20) {
    // eslint-disable-next-line no-control-regex
    return String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
