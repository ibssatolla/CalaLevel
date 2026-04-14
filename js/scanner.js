/**
 * scanner.js — AI pose detection + rep counting
 * Uses TensorFlow.js MoveNet (loaded as global window.poseDetection)
 */

import { showToast } from './utils.js';

// MoveNet keypoint indices
const KP = {
    NOSE: 0,
    LEFT_SHOULDER: 5,  RIGHT_SHOULDER: 6,
    LEFT_ELBOW:    7,  RIGHT_ELBOW:    8,
    LEFT_WRIST:    9,  RIGHT_WRIST:    10,
    LEFT_HIP:      11, RIGHT_HIP:      12,
    LEFT_KNEE:     13, RIGHT_KNEE:     14,
    LEFT_ANKLE:    15, RIGHT_ANKLE:    16
};

// Module-level state
let detector     = null;
let stream       = null;
let animFrame    = null;
let active       = false;

let repCount     = 0;
let repTarget    = 10;
let repPhase     = 'neutral'; // 'up' | 'down' | 'neutral'
let exerciseType = 'pushup';  // 'pushup' | 'pullup' | 'dip'

let onRepFn      = null;
let onCompleteFn = null;

// ---- Public API ----

export async function startChallengeScanner(challenge, callbacks) {
    repCount     = 0;
    repPhase     = 'neutral';
    repTarget    = challenge.target  || 10;
    exerciseType = detectExerciseType(challenge.title || '');
    onRepFn      = callbacks.onRep;
    onCompleteFn = callbacks.onComplete;

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
    if (animFrame)  { cancelAnimationFrame(animFrame); animFrame = null; }
    if (stream)     { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (detector)   { try { detector.dispose?.(); } catch (_) {} detector = null; }
    const video = document.getElementById('scanner-video');
    if (video) video.srcObject = null;
}

// ---- Init ----

function detectExerciseType(title) {
    const t = title.toLowerCase();
    if (t.includes('push'))              return 'pushup';
    if (t.includes('pull') || t.includes('chin') || t.includes('muscle')) return 'pullup';
    if (t.includes('dip'))               return 'dip';
    if (t.includes('squat'))             return 'squat';
    return 'pushup';
}

async function initCamera() {
    const video = document.getElementById('scanner-video');
    if (!video) throw new Error('No #scanner-video element found');

    stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
    });
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror      = reject;
    });
    await video.play();
}

async function initDetector() {
    if (!window.poseDetection) throw new Error('poseDetection library not loaded');
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

        if (poses.length > 0) {
            drawSkeleton(poses[0], ctx);
            processReps(poses[0]);
        } else {
            drawNoPersonHint(ctx, canvas);
        }
    } catch (_) { /* frame error — skip */ }

    if (active) animFrame = requestAnimationFrame(detectLoop);
}

// ---- Rep counting ----

function kp(pose, idx) {
    const k = pose.keypoints[idx];
    return (k && k.score > 0.3) ? k : null;
}

function angle(a, b, c) {
    if (!a || !b || !c) return 180;
    const ba  = { x: a.x - b.x, y: a.y - b.y };
    const bc  = { x: c.x - b.x, y: c.y - b.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const mag = Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y);
    return Math.acos(Math.max(-1, Math.min(1, dot / (mag || 1)))) * (180 / Math.PI);
}

function processReps(pose) {
    const lS  = kp(pose, KP.LEFT_SHOULDER);
    const rS  = kp(pose, KP.RIGHT_SHOULDER);
    const lE  = kp(pose, KP.LEFT_ELBOW);
    const rE  = kp(pose, KP.RIGHT_ELBOW);
    const lW  = kp(pose, KP.LEFT_WRIST);
    const rW  = kp(pose, KP.RIGHT_WRIST);

    // Use best-visible side's elbow angle
    const la = angle(lS, lE, lW);
    const ra = angle(rS, rE, rW);
    const elbowAngle = Math.min(la, ra); // smallest = most bent

    const BENT    = 100; // elbows bent → "up" position for pullup, "down" for pushup
    const STRAIGHT = 155; // elbows straight → "down" hanging or "up" lockout

    if (exerciseType === 'pushup') {
        // Down: elbows bent (<BENT), Up: elbows straight (>STRAIGHT)
        if (elbowAngle < BENT && repPhase !== 'down') {
            repPhase = 'down';
            setPhaseLabel('Ned ✓');
        } else if (elbowAngle > STRAIGHT && repPhase === 'down') {
            repPhase = 'up';
            setPhaseLabel('Opp ✓');
            registerRep();
        }
    } else {
        // Pull-up / dip: Up: elbows bent, Down: elbows straight
        if (elbowAngle < BENT && repPhase !== 'up') {
            repPhase = 'up';
            setPhaseLabel('Opp ✓');
            registerRep();
        } else if (elbowAngle > STRAIGHT && repPhase === 'up') {
            repPhase = 'down';
            setPhaseLabel('Ned ✓');
        }
    }

    updateFormHint(elbowAngle);
}

function registerRep() {
    repCount++;

    // Flash rep indicator
    const flash = document.getElementById('scanner-rep-flash');
    if (flash) {
        flash.textContent = `+1`;
        flash.classList.add('flash-active');
        setTimeout(() => flash.classList.remove('flash-active'), 600);
    }

    // Vibrate on mobile
    if (navigator.vibrate) navigator.vibrate(80);

    if (onRepFn) onRepFn(repCount, repTarget);

    // Update counter
    const countEl = document.getElementById('scanner-count');
    if (countEl) countEl.textContent = repCount;

    // Update progress bar
    const bar = document.getElementById('scanner-progress-fill');
    if (bar) bar.style.width = Math.min(100, (repCount / repTarget) * 100) + '%';

    if (repCount >= repTarget) {
        stopScanner();
        if (onCompleteFn) onCompleteFn(repCount);
    }
}

function setPhaseLabel(text) {
    const el = document.getElementById('scanner-phase');
    if (el) el.textContent = text;
}

function updateFormHint(elbowAngle) {
    const hint = document.getElementById('scanner-form-hint');
    if (!hint) return;
    const type = exerciseType;
    if (type === 'pushup') {
        hint.textContent = elbowAngle < 80 ? 'Full dybde!' : elbowAngle > 160 ? 'Rett opp og start' : 'Beveger seg...';
    } else {
        hint.textContent = elbowAngle < 80 ? 'Full høyde!' : elbowAngle > 160 ? 'Heng og start' : 'Beveger seg...';
    }
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

function drawSkeleton(pose, ctx) {
    ctx.strokeStyle = 'rgba(0,242,255,0.85)';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';

    CONNECTIONS.forEach(([i, j]) => {
        const a = kp(pose, i);
        const b = kp(pose, j);
        if (!a || !b) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    });

    pose.keypoints.forEach(k => {
        if (k.score < 0.3) return;
        ctx.beginPath();
        ctx.arc(k.x, k.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,242,255,1)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    });
}

function drawNoPersonHint(ctx, canvas) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Ingen person oppdaget — gå litt tilbake', canvas.width / 2, canvas.height / 2);
}

// ---- Loading state ----

function showLoading(show) {
    const el = document.getElementById('scanner-loading');
    if (el) el.classList.toggle('hidden', !show);
}
