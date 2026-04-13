import { completeOnboarding } from './auth.js';
import { showToast } from './utils.js';

const steps = [
    {
        id: 'name',
        title: 'Hva heter du?',
        subtitle: 'La oss personalisere opplevelsen.',
        fields: [
            { id: 'ob-name', label: 'Navn', type: 'text', placeholder: 'F.eks. Alex' }
        ]
    },
    {
        id: 'body',
        title: 'Din kropp',
        subtitle: 'Brukes til å beregne fremgang og program.',
        fields: [
            { id: 'ob-age', label: 'Alder', type: 'number', placeholder: '20', min: 10, max: 80 },
            { id: 'ob-weight', label: 'Vekt (kg)', type: 'number', placeholder: '70', min: 30, max: 300 },
            { id: 'ob-height', label: 'Høyde (cm)', type: 'number', placeholder: '175', min: 100, max: 250 }
        ]
    },
    {
        id: 'goal',
        title: 'Hva er målet ditt?',
        subtitle: 'Velg det som passer best for deg nå.',
        options: [
            { value: 'strength', label: 'Styrke', icon: '💪', desc: 'Bli sterkere med kalistenikk' },
            { value: 'skill', label: 'Ferdigheter', icon: '🎯', desc: 'Lær front lever, planche og mer' },
            { value: 'endurance', label: 'Kondisjon', icon: '🏃', desc: 'Bygg utholdenhet og kondis' },
            { value: 'aesthetics', label: 'Estetikk', icon: '🔥', desc: 'Bygg kropp og definisjon' }
        ]
    },
    {
        id: 'level',
        title: 'Erfaringsnivå',
        subtitle: 'Vær ærlig – programmet tilpasses deg.',
        options: [
            { value: 'beginner', label: 'Nybegynner', icon: '🌱', desc: 'Under 6 måneder trening' },
            { value: 'intermediate', label: 'Mellomnivå', icon: '⚡', desc: '6 mnd – 2 år' },
            { value: 'advanced', label: 'Avansert', icon: '🔥', desc: 'Over 2 år' }
        ]
    },
    {
        id: 'days',
        title: 'Treningsdager per uke',
        subtitle: 'Velg et realistisk antall.',
        options: [
            { value: '2', label: '2 dager', icon: '😴', desc: 'Lett start' },
            { value: '3', label: '3 dager', icon: '💡', desc: 'Anbefalt for nybegynnere' },
            { value: '4', label: '4 dager', icon: '⚡', desc: 'Optimal fremgang' },
            { value: '5', label: '5 dager', icon: '🔥', desc: 'For dedikerte' }
        ]
    },
    {
        id: 'api',
        title: 'AI-treningscoach',
        subtitle: 'Skriv inn Anthropic API-nøkkel for personlig AI-program. Kan hoppes over.',
        fields: [
            { id: 'ob-apikey', label: 'API-nøkkel (valgfritt)', type: 'password', placeholder: 'sk-ant-...' }
        ]
    }
];

let currentStep = 0;
let answers = {};
let overlay = null;

export function initOnboarding(onComplete) {
    overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;

    renderStep();
    overlay.classList.remove('hidden');

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) return; // don't close on bg click
    });

    window._onboardingComplete = onComplete;
}

function renderStep() {
    const step = steps[currentStep];
    const container = document.getElementById('onboarding-content');
    if (!container) return;

    const progressPercent = ((currentStep) / steps.length) * 100;

    let html = `
        <div class="ob-progress-bar">
            <div class="ob-progress-fill" style="width: ${progressPercent}%"></div>
        </div>
        <div class="ob-step-counter">${currentStep + 1} / ${steps.length}</div>
        <h2 class="ob-title">${step.title}</h2>
        <p class="ob-subtitle">${step.subtitle}</p>
    `;

    if (step.fields) {
        html += `<div class="ob-fields">`;
        step.fields.forEach(field => {
            const val = answers[field.id] || '';
            html += `
                <div class="ob-field">
                    <label for="${field.id}">${field.label}</label>
                    <input
                        id="${field.id}"
                        type="${field.type}"
                        placeholder="${field.placeholder}"
                        value="${val}"
                        ${field.min !== undefined ? `min="${field.min}"` : ''}
                        ${field.max !== undefined ? `max="${field.max}"` : ''}
                    />
                </div>
            `;
        });
        html += `</div>`;
    }

    if (step.options) {
        html += `<div class="ob-options">`;
        step.options.forEach(opt => {
            const selected = answers[step.id] === opt.value ? 'selected' : '';
            html += `
                <div class="ob-option ${selected}" data-value="${opt.value}" data-step="${step.id}">
                    <span class="ob-option-icon">${opt.icon}</span>
                    <div class="ob-option-text">
                        <strong>${opt.label}</strong>
                        <span>${opt.desc}</span>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }

    const isLast = currentStep === steps.length - 1;
    html += `
        <div class="ob-nav">
            ${currentStep > 0 ? `<button class="cta-button secondary small" id="ob-back-btn">Tilbake</button>` : `<div></div>`}
            <button class="cta-button primary" id="ob-next-btn">
                ${isLast ? '🚀 Kom i gang!' : 'Neste →'}
            </button>
        </div>
    `;

    container.innerHTML = html;

    // Option selection
    container.querySelectorAll('.ob-option').forEach(opt => {
        opt.addEventListener('click', () => {
            container.querySelectorAll('.ob-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            const stepId = opt.getAttribute('data-step');
            answers[stepId] = opt.getAttribute('data-value');
        });
    });

    // Back
    const backBtn = container.querySelector('#ob-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            currentStep--;
            renderStep();
        });
    }

    // Next
    const nextBtn = container.querySelector('#ob-next-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (!validateStep()) return;
            collectFields();

            if (currentStep === steps.length - 1) {
                finishOnboarding();
            } else {
                currentStep++;
                renderStep();
            }
        });
    }
}

function validateStep() {
    const step = steps[currentStep];

    if (step.fields && step.id !== 'api') {
        for (const field of step.fields) {
            const input = document.getElementById(field.id);
            if (input && !input.value.trim()) {
                showToast('Mangler info', `Fyll inn ${field.label}`);
                input.focus();
                return false;
            }
        }
    }

    if (step.options && !answers[step.id]) {
        showToast('Velg et alternativ', 'Trykk på et av valgene.');
        return false;
    }

    return true;
}

function collectFields() {
    const step = steps[currentStep];
    if (!step.fields) return;
    step.fields.forEach(field => {
        const input = document.getElementById(field.id);
        if (input) answers[field.id] = input.value.trim();
    });
}

async function finishOnboarding() {
    collectFields();

    const profileData = {
        name: answers['ob-name'] || 'Atlet',
        age: answers['ob-age'] || 20,
        weightKg: answers['ob-weight'] || 70,
        heightCm: answers['ob-height'] || 175,
        goal: answers['goal'] || 'strength',
        fitnessLevel: answers['level'] || 'beginner',
        trainingDays: answers['days'] || 4,
        apiKey: answers['ob-apikey'] || ''
    };

    completeOnboarding(profileData);

    if (profileData.apiKey) {
        await generateAIProgram(profileData);
    } else {
        hideOnboarding();
        if (window._onboardingComplete) window._onboardingComplete(profileData);
    }
}

async function generateAIProgram(profileData) {
    const container = document.getElementById('onboarding-content');
    if (container) {
        container.innerHTML = `
            <div class="ai-loading">
                <div class="ai-spinner"></div>
                <h3>AI genererer din plan...</h3>
                <p>Claude analyserer ditt nivå og mål</p>
            </div>
        `;
    }

    try {
        const prompt = buildPrompt(profileData);
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': profileData.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) throw new Error(`API feil: ${response.status}`);

        const data = await response.json();
        const text = data.content?.[0]?.text || '';

        // Show result briefly
        if (container) {
            container.innerHTML = `
                <div class="ai-result">
                    <div class="ai-result-icon">🤖</div>
                    <h3>Program klart!</h3>
                    <p class="ai-result-text">${text.slice(0, 300)}...</p>
                    <button class="cta-button primary" id="ob-done-btn" style="margin-top: 1.5rem;">Kom i gang! 🚀</button>
                </div>
            `;
            document.getElementById('ob-done-btn')?.addEventListener('click', () => {
                hideOnboarding();
                if (window._onboardingComplete) window._onboardingComplete(profileData);
            });
        }

        // Store AI response in state
        import('./state.js').then(({ state, saveState }) => {
            state.data.aiCoachMessage = text;
            saveState();
        });

    } catch (err) {
        console.warn('AI program generation failed:', err);
        showToast('AI ikke tilgjengelig', 'Starter med standard program.');
        hideOnboarding();
        if (window._onboardingComplete) window._onboardingComplete(profileData);
    }
}

function buildPrompt(p) {
    const goalLabels = { strength: 'styrke', skill: 'ferdigheter', endurance: 'kondisjon', aesthetics: 'estetikk' };
    const levelLabels = { beginner: 'nybegynner', intermediate: 'mellomnivå', advanced: 'avansert' };
    return `Du er en kalistenikk-coach. Lag en kort ukentlig treningsplan for:
- Navn: ${p.name}
- Alder: ${p.age} år, ${p.weightKg}kg, ${p.heightCm}cm
- Mål: ${goalLabels[p.goal] || p.goal}
- Nivå: ${levelLabels[p.fitnessLevel] || p.fitnessLevel}
- Dager per uke: ${p.trainingDays}

Gi en konkret 1-ukes plan med øvelser og sett/reps. Hold det kort og motiverende. Svar på norsk.`;
}

function hideOnboarding() {
    if (overlay) overlay.classList.add('hidden');
}
