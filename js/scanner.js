/**
 * scanner.js — AI pose detection + rep counting
 * Uses TensorFlow.js MoveNet (window.poseDetection must be loaded globally)
 *
 * Rep-counting algorithm:
 *   - State machine: TOP → BOTTOM → TOP = 1 rep
 *   - Elbow angle for push-ups:  TOP > 160°, BOTTOM < 90°
 *   - Elbow angle for pull-ups:  BOTTOM > 160°, TOP < 90°
 *   - Angle smoothed over SMOOTH_WINDOW frames (jitter reduction)
 *   - Cooldown of COOLDOWN_MS after each accepted rep
 *   - Form check: body alignment + full ROM required
 *   - Confidence gate: key landmarks must score > MIN_CONFIDENCE
 */

import { showToast } from './utils.js';

// ---- Constants ----

const MIN_CONFIDENCE = 0.3;   // minimum keypoint score to trust a reading
const SMOOTH_WINDOW  = 5;     // frames to average for jitter reduction
const COOLDOWN_MS    = 400;   // minimum ms between reps

// Elbow angle thresholds — generous ranges
const TOP_ANGLE         = 150;  // "straight enough" / start/end position
const BOTTOM_ANGLE      = 100;  // "deep enough" / full rep
const BOTTOM_PARTIAL    = 115;  // "almost there" / partial rep (counts, shows hint)

// Body alignment — only block truly bad form
const BODY_STRAIGHT_MIN = 120;

// MoveNet keypoint indices
const KP = {
    NOSE:           0,
    LEFT_SHOULDER:  5,  RIGHT_SHOULDER: 6,
    LEFT_ELBOW:     7,  RIGHT_ELBOW:    8,
    LEFT_WRIST:     9,  RIGHT_WRIST:    10,
    LEFT_HIP:       11, RIGHT_HIP:      12,
    LEFT_KNEE:      13, RIGHT_KNEE:     14,
    LEFT_ANKLE:     15, RIGHT_ANKLE:    16
};

// ---- Module-level state ----

let detector      = null;
let stream        = null;
let animFrame     = null;
let active        = false;

// Rep state machine
// Phases:  'waiting_top' → 'at_top' → 'going_down' → 'at_bottom' → 'going_up'
// A rep is counted when we complete: at_top → at_bottom → at_top
let repPhase      = 'waiting_top';
let reachedBottom = false;        // ensures full ROM before counting
let repCount      = 0;
let repTarget     = 10;
let exerciseType  = 'pushup';
let lastRepTime   = 0;            // timestamp of last accepted rep

// Angle smoothing: circular buffer
const angleBuffer = [];

// For colour-coding skeleton on last rep result
let lastRepAccepted = null;       // true = green, false = red, null = neutral
let lastRepFlashAt  = 0;

let onRepFn      = null;
let onCompleteFn = null;

// ---- Public API ----

export async function startChallengeScanner(challenge, callbacks) {
    // Reset all state
    repCount      = 0;
    repPhase      = 'waiting_top';
    reachedBottom = false;
    lastRepTime   = 0;
    lastRepAccepted = null;
    angleBuffer.length = 0;

    repTarget       = challenge.target || 10;
    exerciseType    = detectExerciseType(challenge.title || '');
    lowestAngleSeen = 180;
    onRepFn         = callbacks.onRep;
    onCompleteFn    = callbacks.onComplete;

    showLoading(true);

    try {
        await initCamera();
        await initDetector();
        active = true;
        showLoading(false);
        detectLoop();
    } catch (err) {
        showLoading(false);
        console.error('Scanner error:', err);
        if (err.name === 'NotAllowedError') {
            showToast('Kamera nektet', 'Gi tillatelse til kamera i nettleseren og prøv igjen.');
        } else if (!window.poseDetection) {
            showToast('AI ikke lastet', 'Sjekk internettforbindelsen og last siden på nytt.');
        } else {
            showToast('Feil', 'Klarte ikke starte kamera-scanning.');
        }
        throw err;
    }
}

export function stopScanner() {
    active = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (stream)    { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (detector)  { try { detector.dispose?.(); } catch (_) {} detector = null; }
    const video = document.getElementById('scanner-video');
    if (video) video.srcObject = null;
}

// ---- Init ----

function detectExerciseType(title) {
    const t = title.toLowerCase();
    if (t.includes('push'))                               return 'pushup';
    if (t.includes('pull') || t.includes('chin') || t.includes('muscle')) return 'pullup';
    if (t.includes('dip'))                                return 'dip';
    return 'pushup';
}

async function initCamera() {
    const video = document.getElementById('scanner-video');
    if (!video) throw new Error('No #scanner-video element');
    stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
    });
    video.srcObject = stream;
    await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = rej; });
    await video.play();
}

async function initDetector() {
    if (!window.poseDetection) throw new Error('poseDetection not loaded');
    detector = await window.poseDetection.createDetector(
        window.poseDetection.SupportedModels.MoveNet,
        { modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
}

// ---- Detection loop ----

async function detectLoop() {
    if (!active || !detector) return;

    const video  = document.getElementById('scanner-video');
    const canvas = document.getElementById('scanner-canvas');
    if (!video || !canvas) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width  = video.videoWidth  || 640;
        canvas.height = video.videoHeight || 480;
    }

    try {
        const poses = await detector.estimatePoses(video);
        const ctx   = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (poses.length > 0 && hasEnoughConfidence(poses[0])) {
            const result = processFrame(poses[0]);
            drawSkeleton(poses[0], ctx, result.skeletonColor);
            drawAngleArc(poses[0], ctx, result.smoothedAngle);
        } else {
            drawLowConfidenceHint(canvas, ctx, poses.length === 0);
        }
    } catch (_) { /* skip frame on error */ }

    if (active) animFrame = requestAnimationFrame(detectLoop);
}

// ---- Confidence gate ----

function hasEnoughConfidence(pose) {
    // All key arm landmarks must be visible
    const required = [
        KP.LEFT_SHOULDER, KP.RIGHT_SHOULDER,
        KP.LEFT_ELBOW,    KP.RIGHT_ELBOW,
        KP.LEFT_WRIST,    KP.RIGHT_WRIST
    ];
    const visible = required.filter(i => {
        const k = pose.keypoints[i];
        return k && k.score >= MIN_CONFIDENCE;
    });
    if (visible.length < 4) {
        setFormHint('Juster kamera — armene er ikke synlige', 'warn');
        return false;
    }
    return true;
}

// ---- Angle helpers ----

function kp(pose, idx, minScore = MIN_CONFIDENCE) {
    const k = pose.keypoints[idx];
    return (k && k.score >= minScore) ? k : null;
}

function angleBetween(a, b, c) {
    if (!a || !b || !c) return null;
    const ba  = { x: a.x - b.x, y: a.y - b.y };
    const bc  = { x: c.x - b.x, y: c.y - b.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const mag = Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y);
    if (mag === 0) return null;
    return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI);
}

function smoothedElbowAngle(pose) {
    // Compute best elbow angle from both sides
    const lS = kp(pose, KP.LEFT_SHOULDER);
    const rS = kp(pose, KP.RIGHT_SHOULDER);
    const lE = kp(pose, KP.LEFT_ELBOW);
    const rE = kp(pose, KP.RIGHT_ELBOW);
    const lW = kp(pose, KP.LEFT_WRIST);
    const rW = kp(pose, KP.RIGHT_WRIST);

    const la = angleBetween(lS, lE, lW);
    const ra = angleBetween(rS, rE, rW);

    // Prefer the side with higher combined confidence; fall back to available side
    let raw = null;
    if (la !== null && ra !== null) {
        const lConf = (lS?.score ?? 0) + (lE?.score ?? 0) + (lW?.score ?? 0);
        const rConf = (rS?.score ?? 0) + (rE?.score ?? 0) + (rW?.score ?? 0);
        raw = lConf >= rConf ? la : ra;
    } else {
        raw = la ?? ra;
    }

    if (raw === null) return null;

    // Push into smoothing buffer
    angleBuffer.push(raw);
    if (angleBuffer.length > SMOOTH_WINDOW) angleBuffer.shift();

    // Return mean of buffer
    return angleBuffer.reduce((s, v) => s + v, 0) / angleBuffer.length;
}

// ---- Form validation ----

// Form check — returns hint text only; never blocks the rep
function checkBodyForm(pose) {
    if (exerciseType !== 'pushup') return { ok: true, hint: '' };

    const lS = kp(pose, KP.LEFT_SHOULDER, 0.25);
    const lH = kp(pose, KP.LEFT_HIP,      0.25);
    const lK = kp(pose, KP.LEFT_KNEE,     0.25);
    const rS = kp(pose, KP.RIGHT_SHOULDER,0.25);
    const rH = kp(pose, KP.RIGHT_HIP,     0.25);
    const rK = kp(pose, KP.RIGHT_KNEE,    0.25);

    const la = angleBetween(lS, lH, lK);
    const ra = angleBetween(rS, rH, rK);
    const bodyAngle = (la !== null && ra !== null) ? (la + ra) / 2 : (la ?? ra);

    // Only flag truly bad form (< 120°)
    if (bodyAngle !== null && bodyAngle < BODY_STRAIGHT_MIN) {
        const hipY      = ((lH?.y ?? 0) + (rH?.y ?? 0)) / 2;
        const shoulderY = ((lS?.y ?? 0) + (rS?.y ?? 0)) / 2;
        const kneeY     = ((lK?.y ?? 0) + (rK?.y ?? 0)) / 2;
        const sag       = hipY - (shoulderY + kneeY) / 2;

        if (sag > 40)  return { ok: false, hint: 'Hofter henger — strekk kroppen' };
        if (sag < -40) return { ok: false, hint: 'Hofter for høyt — senk dem litt' };
        return { ok: false, hint: 'Hold kroppen rettere' };
    }

    return { ok: true, hint: '' };
}

// ---- Rep state machine ----

// Track lowest angle seen since leaving top — for partial rep detection
let lowestAngleSeen = 180;

function processFrame(pose) {
    const smoothed = smoothedElbowAngle(pose);
    if (smoothed === null) {
        setFormHint('Armene ikke synlige', 'warn');
        return { skeletonColor: 'neutral', smoothedAngle: null };
    }

    const isPushup = exerciseType === 'pushup';
    // push-up: TOP = arms straight (>TOP_ANGLE), BOTTOM = arms bent (<BOTTOM_ANGLE)
    // pull-up: TOP = arms bent (<BOTTOM_ANGLE),  BOTTOM = arms straight (>TOP_ANGLE)
    const isAtTop        = isPushup ? smoothed > TOP_ANGLE     : smoothed < BOTTOM_ANGLE;
    const isFullBottom   = isPushup ? smoothed < BOTTOM_ANGLE  : smoothed > TOP_ANGLE;
    const isPartialBottom= isPushup ? smoothed < BOTTOM_PARTIAL: smoothed > (TOP_ANGLE - 15);

    // Track deepest point reached since leaving top
    if (isPushup) {
        lowestAngleSeen = Math.min(lowestAngleSeen, smoothed);
    } else {
        lowestAngleSeen = Math.max(lowestAngleSeen, smoothed);
    }

    updatePhaseHUD(smoothed, isAtTop, isFullBottom);

    // ---- Soft state machine ----
    // States: 'waiting_top' | 'at_top' | 'descending' | 'ascending'

    if (repPhase === 'waiting_top') {
        if (isAtTop) {
            repPhase = 'at_top';
            lowestAngleSeen = isPushup ? 180 : 0;
        }

    } else if (repPhase === 'at_top') {
        if (!isAtTop) {
            repPhase = 'descending';
            lowestAngleSeen = smoothed;
        }

    } else if (repPhase === 'descending') {
        if (isPushup) {
            lowestAngleSeen = Math.min(lowestAngleSeen, smoothed);
        } else {
            lowestAngleSeen = Math.max(lowestAngleSeen, smoothed);
        }
        // Once they start coming back up, switch to ascending
        const reversingUp = isPushup
            ? smoothed > lowestAngleSeen + 8
            : smoothed < lowestAngleSeen - 8;
        if (reversingUp) {
            repPhase = 'ascending';
        }

    } else if (repPhase === 'ascending') {
        if (isAtTop) {
            repPhase = 'at_top';

            const now        = performance.now();
            const cooldownOk = (now - lastRepTime) >= COOLDOWN_MS;

            if (!cooldownOk) {
                // Still in cooldown — silently ignore, reset
                lowestAngleSeen = isPushup ? 180 : 0;
                return { skeletonColor: 'neutral', smoothedAngle: smoothed };
            }

            // Determine rep quality
            const fullRep    = isPushup ? lowestAngleSeen < BOTTOM_ANGLE   : lowestAngleSeen > TOP_ANGLE;
            const partialRep = isPushup ? lowestAngleSeen < BOTTOM_PARTIAL : lowestAngleSeen > (TOP_ANGLE - 15);
            const formCheck  = checkBodyForm(pose);

            lowestAngleSeen = isPushup ? 180 : 0;

            if (fullRep || partialRep) {
                lastRepTime     = now;
                lastRepAccepted = true;
                lastRepFlashAt  = now;

                if (!fullRep) {
                    setFormHint('Gå litt lavere neste gang', 'warn');
                } else if (!formCheck.ok) {
                    setFormHint(formCheck.hint, 'warn'); // warn but still count
                } else {
                    setFormHint('Rep godkjent ✓', 'ok');
                }
                acceptRep();
                return { skeletonColor: 'green', smoothedAngle: smoothed };
            } else {
                // No meaningful movement detected
                lastRepAccepted = false;
                lastRepFlashAt  = now;
                setFormHint(isPushup ? 'Gå mye lavere' : 'Strekk armene helt ut', 'bad');
                return { skeletonColor: 'red', smoothedAngle: smoothed };
            }
        }
    }

    // Fade skeleton colour back to neutral after 600ms
    const skeletonColor = (performance.now() - lastRepFlashAt < 600 && lastRepAccepted !== null)
        ? (lastRepAccepted ? 'green' : 'red')
        : 'neutral';

    return { skeletonColor, smoothedAngle: smoothed };
}

function updatePhaseHUD(angle, isAtTop, isAtBottom) {
    const isPushup = exerciseType === 'pushup';
    let phase = '', hint = '';

    if (isAtTop) {
        phase = isPushup ? 'Topp ↓' : 'Topp ✓';
        hint  = isPushup ? 'Gå ned' : 'Heng ned for å starte';
    } else if (isAtBottom) {
        phase = isPushup ? 'Bunn ✓' : 'Opp!';
        hint  = isPushup ? 'Push opp!' : 'Full høyde!';
    } else {
        const pct = isPushup
            ? Math.round(((angle - BOTTOM_ANGLE) / (TOP_ANGLE - BOTTOM_ANGLE)) * 100)
            : Math.round(((TOP_ANGLE - angle) / (TOP_ANGLE - BOTTOM_ANGLE)) * 100);
        phase = `${Math.max(0, Math.min(100, pct))}%`;
        hint  = isPushup ? 'Gå lavere for å telle' : 'Strekk armene fullstendig';
    }

    const phaseEl = document.getElementById('scanner-phase');
    if (phaseEl) phaseEl.textContent = phase;
    setFormHint(hint, 'ok');
}

function setFormHint(text, type = 'ok') {
    const el = document.getElementById('scanner-form-hint');
    if (!el) return;
    el.textContent = text;
    el.className = 'scanner-form-hint hint-' + type;
}

// ---- Rep accepted ----

function acceptRep() {
    repCount++;

    const countEl = document.getElementById('scanner-count');
    if (countEl) {
        countEl.textContent = repCount;
        countEl.classList.add('rep-pop');
        setTimeout(() => countEl.classList.remove('rep-pop'), 300);
    }

    const flash = document.getElementById('scanner-rep-flash');
    if (flash) {
        flash.textContent = '+1';
        flash.classList.remove('flash-active');
        void flash.offsetWidth; // reflow to restart animation
        flash.classList.add('flash-active');
        setTimeout(() => flash.classList.remove('flash-active'), 600);
    }

    const bar = document.getElementById('scanner-progress-fill');
    if (bar) bar.style.width = Math.min(100, (repCount / repTarget) * 100) + '%';

    if (navigator.vibrate) navigator.vibrate(80);
    playRepTone();

    if (onRepFn) onRepFn(repCount, repTarget);

    if (repCount >= repTarget) {
        stopScanner();
        if (onCompleteFn) onCompleteFn(repCount);
    }
}

function playRepTone() {
    try {
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const osc  = actx.createOscillator();
        const gain = actx.createGain();
        osc.connect(gain); gain.connect(actx.destination);
        osc.frequency.value = 880; osc.type = 'sine';
        gain.gain.setValueAtTime(0.12, actx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.15);
        osc.start(); osc.stop(actx.currentTime + 0.15);
    } catch (_) {}
}

// ---- Drawing ----

const CONNECTIONS = [
    [KP.LEFT_SHOULDER,  KP.RIGHT_SHOULDER],
    [KP.LEFT_SHOULDER,  KP.LEFT_ELBOW],
    [KP.LEFT_ELBOW,     KP.LEFT_WRIST],
    [KP.RIGHT_SHOULDER, KP.RIGHT_ELBOW],
    [KP.RIGHT_ELBOW,    KP.RIGHT_WRIST],
    [KP.LEFT_SHOULDER,  KP.LEFT_HIP],
    [KP.RIGHT_SHOULDER, KP.RIGHT_HIP],
    [KP.LEFT_HIP,       KP.RIGHT_HIP],
    [KP.LEFT_HIP,       KP.LEFT_KNEE],
    [KP.RIGHT_HIP,      KP.RIGHT_KNEE],
    [KP.LEFT_KNEE,      KP.LEFT_ANKLE],
    [KP.RIGHT_KNEE,     KP.RIGHT_ANKLE],
];

const SKELETON_COLORS = {
    neutral: 'rgba(0,242,255,0.85)',
    green:   'rgba(0,255,128,0.95)',
    red:     'rgba(255,80,80,0.95)'
};
const DOT_COLORS = {
    neutral: 'rgba(0,242,255,1)',
    green:   'rgba(0,255,128,1)',
    red:     'rgba(255,80,80,1)'
};

function drawSkeleton(pose, ctx, color = 'neutral') {
    const lineColor = SKELETON_COLORS[color] || SKELETON_COLORS.neutral;
    const dotColor  = DOT_COLORS[color]  || DOT_COLORS.neutral;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';

    CONNECTIONS.forEach(([i, j]) => {
        const a = kp(pose, i, 0.2);
        const b = kp(pose, j, 0.2);
        if (!a || !b) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    });

    pose.keypoints.forEach(k => {
        if (k.score < 0.2) return;
        ctx.beginPath();
        ctx.arc(k.x, k.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    });
}

// Draw small angle arc at the elbow for live feedback
function drawAngleArc(pose, ctx, smoothedAngle) {
    if (smoothedAngle === null) return;

    // Find best elbow to annotate
    const lE = kp(pose, KP.LEFT_ELBOW, 0.4);
    const rE = kp(pose, KP.RIGHT_ELBOW, 0.4);
    const elbow = lE || rE;
    if (!elbow) return;

    const radius = 22;
    const pct    = Math.round(smoothedAngle);

    // Arc fill based on angle vs target
    const isPushup = exerciseType === 'pushup';
    const atBottom = isPushup ? smoothedAngle < BOTTOM_ANGLE : smoothedAngle > TOP_ANGLE;
    const arcColor = atBottom ? 'rgba(0,255,128,0.9)' : 'rgba(0,242,255,0.6)';

    ctx.beginPath();
    ctx.arc(elbow.x, elbow.y, radius, 0, (pct / 180) * Math.PI);
    ctx.strokeStyle = arcColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Angle label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${pct}°`, elbow.x, elbow.y - radius - 5);
}

function drawLowConfidenceHint(canvas, ctx, noPerson) {
    ctx.fillStyle = 'rgba(255,200,0,0.7)';
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    const msg = noPerson
        ? 'Ingen person oppdaget — gå litt tilbake'
        : 'Lavt kamera-signal — juster belysning eller avstand';
    ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
}

// ---- Loading ----

function showLoading(show) {
    const el = document.getElementById('scanner-loading');
    if (el) el.classList.toggle('hidden', !show);
}
