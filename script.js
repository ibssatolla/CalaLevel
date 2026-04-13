import { initMap, invalidateMapSize } from './js/map.js';
import { showToast, capitalize } from './js/utils.js';
import { state, initState, saveState } from './js/state.js';
import { checkAuth } from './js/auth.js';
import { initOnboarding } from './js/onboarding.js';
import { logExerciseSet, renderBodyLogger, renderProfileSettings } from './js/logger.js';
import { checkAndUpdatePR, saveExerciseSession, getLastSession, renderProgressPage } from './js/progression.js';

// ---- Page Navigation ----
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-link').forEach(a => {
        a.classList.toggle('active', a.getAttribute('data-page') === pageId);
    });

    if (pageId === 'map') setTimeout(invalidateMapSize, 150);
    if (pageId === 'progress') renderProgressPage();
}
window.showPage = showPage;

document.addEventListener('DOMContentLoaded', () => {
    console.log('CalaLevel initialized');

    // Wire up all [data-page] elements (nav links, buttons, logo)
    document.querySelectorAll('[data-page]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            showPage(el.getAttribute('data-page'));
        });
    });

    // Initialize State
    initState();

    // Auth Check — show onboarding if not done yet
    if (!checkAuth()) {
        initOnboarding((profileData) => {
            // After onboarding complete, re-render everything with new data
            renderProfile();
            renderWeeklySchedule();
            renderBodyLogger('body-logger-container');
            renderProfileSettings('profile-settings-container');
            showToast(`Velkommen, ${profileData.name}! 🚀`, 'Din plan er klar.');
        });
    }

    // Simple interaction for buttons
    const buttons = document.querySelectorAll('.cta-button');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Button clicked:', btn.textContent);
        });
    });

    // XP Bar Animation Simulation
    const xpBar = document.querySelector('.xp-bar');
    if (xpBar) {
        setTimeout(() => {
            xpBar.style.transition = 'width 1s ease-out';
            xpBar.style.width = '75%';
        }, 500);
    }

    // Skill Tree Implementation
    // Skill Tree Implementation
    const skillContainer = document.getElementById('skill-tree-container');

    function renderSkillTree() {
        if (!skillContainer) return;

        // Clear existing nodes but keep connections layer if easy, or just rebuild all
        skillContainer.innerHTML = '';

        const skills = state.data.skills;

        skills.forEach(skill => {
            // Create Node
            const node = document.createElement('div');
            node.classList.add('skill-node', skill.status);
            node.style.left = `${skill.x}%`;
            node.style.top = `${skill.y}%`;
            node.innerHTML = `
                <div class="skill-icon">${getSkillIcon(skill.id)}</div>
                <span class="skill-name">${skill.name}</span>
                ${skill.status === 'locked' ? `<span class="skill-cost-label">${skill.cost.toLocaleString()} XP</span>` : ''}
            `;

            // Interaction
            node.addEventListener('click', () => {
                handleSkillClick(skill);
            });

            skillContainer.appendChild(node);

            // Create Connections (Lines)
            skill.parents.forEach(parentId => {
                const parent = skills.find(s => s.id === parentId);
                if (parent) {
                    createConnection(parent, skill);
                }
            });
        });
    }

    // XP thresholds per level (total XP needed to REACH that level)
    const levelThresholds = [0, 300, 900, 2200, 4500, 8000, 13000, 20000, 30000, 42000];
    const rankTitles = [
        'Nybegynner',   // 0
        'Utøver',       // 1
        'Klatrer',      // 2
        'Streetworker', // 3
        'Bar Athlete',  // 4
        'Bar Star',     // 5
        'Elite',        // 6
        'Legenden',     // 7
        'Myte',         // 8
        'Udødelig'      // 9+
    ];

    function checkLevelUp() {
        const profile = state.data.userProfile;
        let leveled = false;
        while (
            profile.level < levelThresholds.length - 1 &&
            profile.xp >= levelThresholds[profile.level + 1]
        ) {
            profile.level += 1;
            profile.rankTitle = rankTitles[Math.min(profile.level, rankTitles.length - 1)];
            profile.nextLevelXp = levelThresholds[Math.min(profile.level + 1, levelThresholds.length - 1)];
            leveled = true;
        }
        if (leveled) {
            showToast(`Level ${profile.level}!`, `Du er nå ${profile.rankTitle} 🏆`);
        }
        return leveled;
    }

    function unlockAchievement(id) {
        const badge = state.data.userProfile.achievements.find(a => a.id === id);
        if (badge && !badge.unlocked) {
            badge.unlocked = true;
            showToast(`Badge: ${badge.name}`, badge.desc + ' ' + badge.icon);
        }
    }

    function handleSkillClick(skill) {
        if (skill.status === 'mastered') {
            showToast('Mestret', `Du har mestret ${skill.name}!`);
            return;
        }

        if (skill.status === 'unlocked') {
            showToast('Ulåst', `${skill.name} er klar for trening.`);
            return;
        }

        if (skill.status === 'locked') {
            const parents = skill.parents.map(pid => state.data.skills.find(s => s.id === pid));
            const allParentsUnlocked = parents.every(p => p.status === 'mastered' || p.status === 'unlocked');

            if (!allParentsUnlocked) {
                showToast('Låst', 'Lås opp forrige skills først!');
                return;
            }

            if (state.data.userProfile.xp >= skill.cost) {
                if (confirm(`Lås opp ${skill.name} for ${skill.cost.toLocaleString()} XP?\n\nDette krever ekte dedikasjon — er du klar?`)) {
                    unlockSkill(skill);
                }
            } else {
                const missing = (skill.cost - state.data.userProfile.xp).toLocaleString();
                showToast('Ikke nok XP', `Du mangler ${missing} XP for å låse opp ${skill.name}.`);
            }
        }
    }

    function unlockSkill(skill) {
        state.data.userProfile.xp -= skill.cost;

        const skillIndex = state.data.skills.findIndex(s => s.id === skill.id);
        if (skillIndex !== -1) {
            state.data.skills[skillIndex].status = 'unlocked';
        }

        // Award matching badge
        unlockAchievement('skill_' + skill.id);

        saveState();
        renderSkillTree();
        renderProfile();
        update3DCore();
        showToast('Skill ulåst!', `${skill.name} er nå en del av arsenalet ditt.`);
    }

    function getSkillIcon(id) {
        const icons = {
            'pushup': '💪',
            'dips': '🪜',
            'pullup': '🧗',
            'muscleup': '🔥',
            'frontlever': '⚖️',
            'planche': '🤸'
        };
        return icons[id] || '❓';
    }

    function createConnection(parent, child) {
        let svg = skillContainer.querySelector('svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('skill-connections-layer');
            skillContainer.prepend(svg);
        }

        const x1 = parent.x;
        const y1 = parent.y;
        const x2 = child.x;
        const y2 = child.y;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        path.setAttribute('x1', `${x1}%`);
        path.setAttribute('y1', `${y1}%`);
        path.setAttribute('x2', `${x2}%`);
        path.setAttribute('y2', `${y2}%`);
        path.setAttribute('stroke', 'rgba(255,255,255,0.2)');
        path.setAttribute('stroke-width', '2');

        if (child.status !== 'locked') {
            path.setAttribute('stroke', 'var(--primary)');
        }

        svg.appendChild(path);
    }

    renderSkillTree();

    // Initialize Map Module
    initMap();


    // Battles Implementation
    function renderBattles() {
        const challengesList = document.getElementById('challenges-list');
        const leaderboardList = document.getElementById('leaderboard-list');

        if (challengesList) {
            challengesList.innerHTML = '';
            state.data.challenges.forEach(challenge => {
                const card = document.createElement('div');
                card.classList.add('challenge-card');
                card.innerHTML = `
                    <div class="challenge-info">
                        <h4>${challenge.title}</h4>
                        <div class="challenge-meta">
                            <span>${challenge.type}</span>
                            <span class="vs-badge">VS ${challenge.opponent}</span>
                        </div>
                    </div>
                    ${challenge.status === 'Open' ?
                        `<button class="cta-button small secondary" onclick="acceptChallenge(${challenge.id})">Accept</button>` :
                        `<span class="challenge-accepted">Accepted</span>`
                    }
                `;
                challengesList.appendChild(card);
            });
        }

        if (leaderboardList) {
            // Update "You" score in leaderboard if present
            const myRank = state.data.leaderboard.find(p => p.name === 'You');
            if (myRank) myRank.xp = state.data.userProfile.xp;

            // Re-sort
            const sortedLeaderboard = [...state.data.leaderboard].sort((a, b) => b.xp - a.xp);

            leaderboardList.innerHTML = '';
            sortedLeaderboard.forEach((item, index) => {
                const rank = index + 1;
                const isMe = item.name === 'You';
                const row = document.createElement('div');
                row.classList.add('leaderboard-item');
                if (isMe) row.classList.add('highlight-me');

                row.innerHTML = `
                    <span class="rank rank-${rank}">${rank}</span>
                    <span class="athlete-name">${item.name}</span>
                    <span class="athlete-xp">${item.xp.toLocaleString()} XP</span>
                `;
                leaderboardList.appendChild(row);
            });
        }
    }

    window.acceptChallenge = function (id) {
        const challenge = state.data.challenges.find(c => c.id === id);
        if (challenge) {
            challenge.status = 'In Progress';
            saveState();
            renderBattles();
            showToast('Challenge Accepted', `Beat ${challenge.opponent} in ${challenge.title}!`);
        }
    };

    renderBattles();

    // User Profile Implementation
    // Using state.data.userProfile which is loaded or default

    function renderProfile() {
        const userProfile = state.data.userProfile;

        // Render Header
        const rankTitleEl = document.getElementById('profile-rank-title');
        if (rankTitleEl) {
            rankTitleEl.textContent = userProfile.name ? `${userProfile.name} · ${userProfile.rankTitle}` : userProfile.rankTitle;

            const currentLevelXp = levelThresholds[Math.min(userProfile.level, levelThresholds.length - 1)];
            const nextLvlXp = levelThresholds[Math.min(userProfile.level + 1, levelThresholds.length - 1)];
            const xpIntoLevel = userProfile.xp - currentLevelXp;
            const xpNeeded = nextLvlXp - currentLevelXp;
            const xpPercent = userProfile.level >= levelThresholds.length - 1 ? 100 : Math.min(100, (xpIntoLevel / xpNeeded) * 100);

            document.getElementById('profile-xp-text').textContent = `${userProfile.xp.toLocaleString()} / ${nextLvlXp.toLocaleString()} XP`;
            document.getElementById('profile-xp-bar').style.width = `${xpPercent}%`;

            // Update level badge circle
            const levelBadge = document.querySelector('.level-badge-circle');
            if (levelBadge) levelBadge.textContent = userProfile.level;

            // Update XP info line
            const xpInfoSpans = document.querySelectorAll('.xp-info span');
            if (xpInfoSpans.length >= 1) xpInfoSpans[0].textContent = `Level ${userProfile.level}`;

            // Render Stats
            document.getElementById('stat-workouts').textContent = userProfile.stats.workouts;
            document.getElementById('stat-reps').textContent = userProfile.stats.reps.toLocaleString();
            document.getElementById('stat-streak').textContent = userProfile.stats.streak;
            document.getElementById('stat-rank').textContent = `#${userProfile.stats.rank}`;

            // Render Activity
            const activityList = document.getElementById('activity-list');
            if (activityList) {
                activityList.innerHTML = userProfile.activity.map(item => `
                    <div class="activity-item">
                        <div class="activity-main">
                            <span class="activity-icon">${item.icon}</span>
                            <div class="activity-details">
                                <h4>${item.title}</h4>
                                <span class="activity-date">${item.date}</span>
                            </div>
                        </div>
                        <span class="activity-xp">+${item.xp} XP</span>
                    </div>
                `).join('');
            }

            // Render Achievements
            const achievementsGrid = document.getElementById('achievements-grid');
            if (achievementsGrid) {
                achievementsGrid.innerHTML = userProfile.achievements.map(badge => {
                    const isSkillBadge = String(badge.id).startsWith('skill_');
                    return `
                    <div class="achievement-badge ${badge.unlocked ? '' : 'locked'}"
                         data-desc="${badge.desc}"
                         ${isSkillBadge ? 'data-skill="true"' : ''}
                         title="${badge.desc}">
                        <span class="badge-icon">${badge.icon}</span>
                        <span class="badge-name">${badge.name}</span>
                    </div>`;
                }).join('');
            }
        }
    }

    // Initialize Profile
    renderProfile();
    renderBodyLogger('body-logger-container');
    renderProfileSettings('profile-settings-container');



    // Programs & Generator Implementation
    const exerciseLibrary = [
        { id: 'push1', name: 'Push-ups', type: 'push', difficulty: 1, videoUrl: '#', tags: ['Chest', 'Triceps'] },
        { id: 'push2', name: 'Dips', type: 'push', difficulty: 2, videoUrl: '#', tags: ['Triceps', 'Chest'] },
        { id: 'push3', name: 'Pike Push-ups', type: 'push', difficulty: 2, videoUrl: '#', tags: ['Shoulders'] },
        { id: 'push4', name: 'Archer Push-ups', type: 'push', difficulty: 3, videoUrl: '#', tags: ['Chest', 'Core'] },
        { id: 'push5', name: 'Diamond Push-ups', type: 'push', difficulty: 2, videoUrl: '#', tags: ['Triceps'] },
        { id: 'push6', name: 'Pseudo Planche Push-ups', type: 'push', difficulty: 3, videoUrl: '#', tags: ['Shoulders', 'Chest'] },
        { id: 'pull1', name: 'Pull-ups', type: 'pull', difficulty: 2, videoUrl: '#', tags: ['Back', 'Biceps'] },
        { id: 'pull2', name: 'Chin-ups', type: 'pull', difficulty: 2, videoUrl: '#', tags: ['Biceps', 'Back'] },
        { id: 'pull3', name: 'Australian Pull-ups', type: 'pull', difficulty: 1, videoUrl: '#', tags: ['Back'] },
        { id: 'pull4', name: 'Muscle-up', type: 'pull', difficulty: 3, videoUrl: '#', tags: ['Explosive'] },
        { id: 'pull5', name: 'Commando Pull-ups', type: 'pull', difficulty: 2, videoUrl: '#', tags: ['Back', 'Biceps'] },
        { id: 'pull6', name: 'High Pull-ups', type: 'pull', difficulty: 3, videoUrl: '#', tags: ['Explosive'] },
        { id: 'legs1', name: 'Squats', type: 'legs', difficulty: 1, videoUrl: '#', tags: ['Quads', 'Glutes'] },
        { id: 'legs2', name: 'Lunges', type: 'legs', difficulty: 1, videoUrl: '#', tags: ['Legs'] },
        { id: 'legs3', name: 'Jump Squats', type: 'legs', difficulty: 2, videoUrl: '#', tags: ['Explosive'] },
        { id: 'legs4', name: 'Pistol Squats', type: 'legs', difficulty: 3, videoUrl: '#', tags: ['Balance'] },
        { id: 'legs5', name: 'Bulgarian Split Squats', type: 'legs', difficulty: 2, videoUrl: '#', tags: ['Legs'] },
        { id: 'legs6', name: 'Calf Raises', type: 'legs', difficulty: 1, videoUrl: '#', tags: ['Calves'] },
        { id: 'core1', name: 'Plank', type: 'core', difficulty: 1, videoUrl: '#', tags: ['Abs'] },
        { id: 'core2', name: 'Leg Raises', type: 'core', difficulty: 2, videoUrl: '#', tags: ['Abs'] },
        { id: 'core3', name: 'L-Sit', type: 'core', difficulty: 3, videoUrl: '#', tags: ['Core'] },
        { id: 'core4', name: 'Russian Twists', type: 'core', difficulty: 1, videoUrl: '#', tags: ['Obliques'] },
        { id: 'skill1', name: 'Handstand Wall Hold', type: 'skill', difficulty: 2, videoUrl: '#', tags: ['Balance'] },
        { id: 'skill2', name: 'L-Sit Prep', type: 'skill', difficulty: 2, videoUrl: '#', tags: ['Core'] },
        { id: 'skill3', name: 'Crow Pose', type: 'skill', difficulty: 2, videoUrl: '#', tags: ['Balance'] },
        { id: 'skill4', name: 'Skin the Cat', type: 'skill', difficulty: 2, videoUrl: '#', tags: ['Mobility'] }
    ];

    // Helper to build a workout from library
    function buildWorkout(type, avoidExercises = []) {
        if (type === 'rest') return [];

        // Filter pool: match type AND exclude avoided exercises
        let pool = exerciseLibrary.filter(ex => {
            const isTypeMatch = ex.type === type || (type === 'full' && ['push', 'pull', 'legs'].includes(ex.type));
            const isNotAvoided = !avoidExercises.includes(ex.id);
            return isTypeMatch && isNotAvoided;
        });

        // If pool is too small (e.g. we avoided everything), reset and use full pool
        if (pool.length < 3) {
            pool = exerciseLibrary.filter(ex => ex.type === type || (type === 'full' && ['push', 'pull', 'legs'].includes(ex.type)));
        }

        // Shuffle pool
        pool = pool.sort(() => 0.5 - Math.random());

        // Select 3-5 exercises
        const selected = pool.slice(0, 4).map(ex => ({
            id: ex.id,
            name: ex.name,
            sets: 3,
            reps: ex.difficulty === 3 ? 5 : (ex.difficulty === 2 ? 8 : 12)
        }));

        return selected;
    }

    // Initial Population of Exercises if empty (for new users/cleared cache)
    // Only if the state was fresh default and has no exercises populated
    state.data.weeklySchedule.forEach(day => {
        if (day.type !== 'rest' && (!day.exercises || day.exercises.length === 0)) {
            day.exercises = buildWorkout(day.type);
        }
    });

    function renderWeeklySchedule() {
        const grid = document.getElementById('weekly-schedule');
        if (!grid) return;

        grid.innerHTML = state.data.weeklySchedule.map((day, index) => `
            <div class="day-card ${day.type === 'rest' ? 'rest-day' : ''}" onclick="loadGeneratedWorkout(${index})">
                <span class="day-name">${day.day}</span>
                <span class="workout-type">${day.title}</span>
                <span class="workout-duration">${day.type === 'rest' ? 'Relax' : '45-60 min'}</span>
            </div>
        `).join('');
    }

    // Global function to load a workout from the schedule
    window.loadGeneratedWorkout = function (index) {
        const day = state.data.weeklySchedule[index];
        if (day.type === 'rest') {
            showToast('Rest Day', 'Take it easy today! 🧘‍♂️');
            return;
        }

        // Use the new startSession with custom exercises
        startSession(day.type, JSON.parse(JSON.stringify(day.exercises)));
        showPage('train');
    };

    let currentLibFilter = 'all';

    function renderLibrary() {
        const grid = document.getElementById('library-grid');
        if (!grid) return;

        const filtered = currentLibFilter === 'all'
            ? exerciseLibrary
            : exerciseLibrary.filter(ex => ex.type === currentLibFilter);

        const inBuilder = builderExercises.map(e => e.id);

        grid.innerHTML = filtered.map(ex => {
            const added = inBuilder.includes(ex.id);
            return `
            <div class="exercise-card ${added ? 'ex-added' : ''}">
                <div class="exercise-details">
                    <h4>${ex.name}</h4>
                    <div class="exercise-tags">
                        <span class="ex-tag">${ex.type.toUpperCase()}</span>
                        <span class="ex-tag">Lvl ${ex.difficulty}</span>
                        ${ex.tags.map(t => `<span class="ex-tag secondary">${t}</span>`).join('')}
                    </div>
                </div>
                <button class="add-to-program-btn ${added ? 'added' : ''}"
                    onclick="toggleExerciseInBuilder('${ex.id}')"
                    title="${added ? 'Fjern fra program' : 'Legg til program'}">
                    ${added ? '✓' : '+'}
                </button>
            </div>`;
        }).join('');
    }

    // Library filter buttons
    document.querySelectorAll('.lib-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.lib-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentLibFilter = btn.getAttribute('data-filter');
            renderLibrary();
        });
    });

    // Generator Logic
    const generateBtn = document.getElementById('generate-program-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', () => {
            generateNewSchedule();
        });
    }

    function generateNewSchedule() {
        const types = ['push', 'pull', 'legs', 'skill', 'full'];
        let lastType = null;

        state.data.weeklySchedule.forEach(day => {
            if (day.day === 'Sun') {
                day.type = 'rest';
                day.title = 'Rest Day';
                day.exercises = [];
                return;
            }

            // 20% chance of rest day if not already rest
            if (Math.random() < 0.2 && lastType !== 'rest') {
                day.type = 'rest';
                day.title = 'Active Recovery';
                day.exercises = [];
                lastType = 'rest';
                return;
            }

            let availableTypes = types.filter(t => t !== lastType);
            const randomType = availableTypes[Math.floor(Math.random() * availableTypes.length)];

            // Smart Logic: Find last session of this type in history
            const lastSession = [...state.data.workoutHistory].reverse().find(s => s.type === randomType);
            const avoidIds = lastSession ? lastSession.exercises.map(e => e.id) : [];

            day.type = randomType;
            day.title = capitalize(randomType) + ' Session';
            day.exercises = buildWorkout(randomType, avoidIds);
            lastType = randomType;
        });

        saveState(); // Persist new schedule
        renderWeeklySchedule();
        showToast('New Program Generated', 'Your weekly schedule has been updated!');
    }

    // ---- Train tabs (Treningsøkt / Program) ----
    document.querySelectorAll('.train-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.train-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.train-tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('train-tab-' + btn.getAttribute('data-train-tab')).classList.add('active');
        });
    });

    // ---- Program sub-tabs (Mine programmer / Program-forslag) ----
    document.querySelectorAll('.program-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.program-subtab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.program-subtab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('subtab-' + btn.getAttribute('data-subtab')).classList.add('active');
        });
    });

    // ---- AI Coach Box (Program-forslag) ----
    function renderAICoachBox() {
        const box = document.getElementById('ai-coach-box');
        const txt = document.getElementById('ai-coach-text');
        const msg = state.data.aiCoachMessage;
        if (box && txt && msg) {
            txt.textContent = msg;
            box.classList.remove('hidden');
        }
    }
    renderAICoachBox();

    // ---- Mine programmer (My Programs) ----
    let builderExercises = [];
    let builderActive = false;

    const createProgramBtn = document.getElementById('create-program-btn');
    const programBuilder   = document.getElementById('program-builder');
    const saveProgramBtn   = document.getElementById('save-program-btn');
    const cancelProgramBtn = document.getElementById('cancel-program-btn');

    if (createProgramBtn) {
        createProgramBtn.addEventListener('click', () => {
            builderActive = true;
            builderExercises = [];
            document.getElementById('program-name-input').value = '';
            programBuilder.classList.remove('hidden');
            renderBuilderSelected();
            renderLibrary();
        });
    }

    if (cancelProgramBtn) {
        cancelProgramBtn.addEventListener('click', () => {
            builderActive = false;
            builderExercises = [];
            programBuilder.classList.add('hidden');
            renderLibrary();
        });
    }

    if (saveProgramBtn) {
        saveProgramBtn.addEventListener('click', () => {
            const name = document.getElementById('program-name-input').value.trim();
            if (!name) { showToast('Mangler navn', 'Gi programmet et navn.'); return; }
            if (builderExercises.length === 0) { showToast('Tomt program', 'Legg til minst én øvelse.'); return; }

            if (!state.data.myPrograms) state.data.myPrograms = [];
            state.data.myPrograms.push({
                id: Date.now(),
                name,
                exercises: JSON.parse(JSON.stringify(builderExercises))
            });
            saveState();

            builderActive = false;
            builderExercises = [];
            programBuilder.classList.add('hidden');
            renderSavedPrograms();
            renderLibrary();
            showToast('Program lagret!', `"${name}" er klar til bruk.`);
        });
    }

    window.toggleExerciseInBuilder = function (exId) {
        if (!builderActive) return;
        const ex = exerciseLibrary.find(e => e.id === exId);
        if (!ex) return;
        const idx = builderExercises.findIndex(e => e.id === exId);
        if (idx === -1) {
            builderExercises.push({ id: ex.id, name: ex.name, sets: 3, reps: ex.difficulty === 3 ? 5 : (ex.difficulty === 2 ? 8 : 12) });
        } else {
            builderExercises.splice(idx, 1);
        }
        renderBuilderSelected();
        renderLibrary();
    };

    function renderBuilderSelected() {
        const el = document.getElementById('builder-selected');
        if (!el) return;
        if (builderExercises.length === 0) {
            el.innerHTML = '<p class="builder-empty-hint">Legg til øvelser fra biblioteket nedenfor</p>';
            return;
        }
        el.innerHTML = builderExercises.map((ex, i) => `
            <div class="builder-ex-row">
                <span class="builder-ex-name">${ex.name}</span>
                <span class="builder-ex-meta">${ex.sets} sett × ${ex.reps} reps</span>
                <button class="remove-ex-btn" onclick="removeFromBuilder(${i})">✕</button>
            </div>
        `).join('');
    }

    window.removeFromBuilder = function (i) {
        builderExercises.splice(i, 1);
        renderBuilderSelected();
        renderLibrary();
    };

    function renderSavedPrograms() {
        const list = document.getElementById('saved-programs-list');
        if (!list) return;
        const programs = state.data.myPrograms || [];
        if (programs.length === 0) {
            list.innerHTML = '<p class="empty-hint">Ingen programmer ennå. Lag ditt første!</p>';
            return;
        }
        list.innerHTML = programs.map((prog, i) => `
            <div class="saved-program-card glass-card">
                <div class="saved-program-info">
                    <h4>${prog.name}</h4>
                    <span class="saved-program-meta">${prog.exercises.length} øvelser</span>
                </div>
                <div class="saved-program-actions">
                    <button class="cta-button primary small" onclick="startSavedProgram(${i})">Start</button>
                    <button class="cta-button secondary small" onclick="deleteSavedProgram(${i})">Slett</button>
                </div>
            </div>
        `).join('');
    }

    window.startSavedProgram = function (i) {
        const prog = (state.data.myPrograms || [])[i];
        if (!prog) return;
        startSession('custom', JSON.parse(JSON.stringify(prog.exercises)));
        // Switch to Treningsøkt tab
        document.querySelectorAll('.train-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.train-tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('[data-train-tab="session"]').classList.add('active');
        document.getElementById('train-tab-session').classList.add('active');
        showToast('Program startet', prog.name);
    };

    window.deleteSavedProgram = function (i) {
        if (!confirm('Slett dette programmet?')) return;
        state.data.myPrograms.splice(i, 1);
        saveState();
        renderSavedPrograms();
    };

    // Initialize Programs
    renderWeeklySchedule();
    renderLibrary();
    renderSavedPrograms();

    // Training Flow Implementation
    const workoutData = {
        push: {
            title: 'Push Day',
            exercises: [
                { id: 'p1', name: 'Push-ups', sets: 4, reps: 15 },
                { id: 'p2', name: 'Dips', sets: 3, reps: 10 },
                { id: 'p3', name: 'Pike Push-ups', sets: 3, reps: 8 },
                { id: 'p4', name: 'Tricep Extensions', sets: 3, reps: 12 }
            ]
        },
        pull: {
            title: 'Pull Day',
            exercises: [
                { id: 'pu1', name: 'Pull-ups', sets: 4, reps: 8 },
                { id: 'pu2', name: 'Chin-ups', sets: 3, reps: 8 },
                { id: 'pu3', name: 'Australian Pull-ups', sets: 3, reps: 12 },
                { id: 'pu4', name: 'Face Pulls', sets: 3, reps: 15 }
            ]
        },
        full: {
            title: 'Full Body',
            exercises: [
                { id: 'f1', name: 'Burpees', sets: 3, reps: 15 },
                { id: 'f2', name: 'Jump Squats', sets: 4, reps: 20 },
                { id: 'f3', name: 'Push-ups', sets: 3, reps: 15 },
                { id: 'f4', name: 'Lunges', sets: 3, reps: 12 }
            ]
        },
        skill: {
            title: 'Skill Practice',
            exercises: [
                { id: 's1', name: 'Handstand Hold', sets: 5, reps: '30s' },
                { id: 's2', name: 'L-Sit Hold', sets: 4, reps: '15s' },
                { id: 's3', name: 'Planche Lean', sets: 4, reps: '10s' }
            ]
        }
    };

    let currentSession = {
        active: false,
        type: null,
        startTime: null,
        exercises: {}
    };

    // Workout Selection Logic
    const workoutCards = document.querySelectorAll('.workout-card');
    const activePanel = document.getElementById('active-session-panel');
    const exerciseList = document.getElementById('exercise-list');
    const sessionTitle = document.getElementById('session-title');

    workoutCards.forEach(card => {
        card.addEventListener('click', () => {
            // Visual Selection
            workoutCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            // Start Session
            const type = card.getAttribute('data-type');
            startSession(type);
        });
    });

    // Initialize Default Workout (Today's Plan) if no session active
    function initDefaultWorkout() {
        if (currentSession.active) return;

        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const todayName = days[new Date().getDay()];
        const todayPlan = state.data.weeklySchedule.find(d => d.day === todayName);

        if (todayPlan && todayPlan.type !== 'rest') {
            // Pre-load today's workout but don't start it yet (user must click start or we can show it as "Recommended")
            // For now, let's just make it the default if they click a generic "Start Training" or similar
            // Or we can auto-select the card if it matches
        }
    }

    function toSetData(ex) {
        // Convert old flat format { sets, reps, weightKg } to setData array
        if (ex.setData) return ex;
        const count = typeof ex.sets === 'number' ? ex.sets : 3;
        const reps  = typeof ex.reps === 'number' ? ex.reps : ex.reps;
        const kg    = ex.weightKg || 0;
        ex.setData = Array.from({ length: count }, () => ({ reps, kg }));
        return ex;
    }

    function startSession(type, customExercises = null) {
        let exercises = [];
        let title = '';

        if (customExercises) {
            exercises = customExercises;
            title = capitalize(type) + ' Session';
        } else {
            const data = workoutData[type];
            if (!data) return;
            exercises = JSON.parse(JSON.stringify(data.exercises));
            title = data.title;
        }

        // Convert every exercise to setData format
        exercises = exercises.map(ex => toSetData(JSON.parse(JSON.stringify(ex))));

        currentSession = {
            active: true,
            type: type,
            startTime: new Date(),
            exercises: exercises
        };

        if (sessionTitle) sessionTitle.textContent = title;
        renderExercises();

        if (activePanel) {
            activePanel.classList.remove('hidden');
            // Reset UI state for new session
            document.getElementById('session-summary').classList.add('hidden');
            document.getElementById('complete-session-btn').classList.remove('hidden');
            document.getElementById('exercise-list').classList.remove('hidden');

            activePanel.scrollTop = 0;
        }
    }

    // Tracks which exercises are expanded
    const expandedExercises = new Set();

    function renderExercises() {
        if (!exerciseList) return;

        exerciseList.innerHTML = currentSession.exercises.map((ex, ei) => {
            const isOpen = expandedExercises.has(ei);
            const doneSets = ex.setData.filter(s => s.done).length;
            const allDone = doneSets === ex.setData.length;
            const lastSession = getLastSession(ex.id || ex.name);

            const setRows = ex.setData.map((s, si) => {
                const prev = lastSession?.sets?.[si];
                const prevHint = prev
                    ? `<span class="prev-hint" title="Forrige økt">${prev.reps} reps${prev.kg > 0 ? ` @ ${prev.kg}kg` : ''}</span>`
                    : '';
                return `
                <div class="set-row ${s.done ? 'set-done' : ''}">
                    <span class="set-num">${si + 1}</span>
                    <div class="counter-ui small">
                        <button class="counter-btn" onclick="updateSetReps(${ei},${si},-1)" ${s.done ? 'disabled' : ''}>−</button>
                        <span class="counter-val">${s.reps}</span>
                        <button class="counter-btn" onclick="updateSetReps(${ei},${si},1)" ${s.done ? 'disabled' : ''}>+</button>
                    </div>
                    <input
                        type="number"
                        class="kg-input set-kg"
                        data-ei="${ei}" data-si="${si}"
                        value="${s.kg}"
                        min="0" max="500" step="0.5"
                        placeholder="0"
                        ${s.done ? 'disabled' : ''}
                    />
                    ${prevHint}
                    <button class="set-done-btn ${s.done ? 'done' : ''}"
                        onclick="markSetDone(${ei},${si})"
                        title="${s.done ? 'Angre' : 'Marker sett ferdig'}">
                        ${s.done ? '✓' : 'Ferdig'}
                    </button>
                    <button class="remove-set-btn" onclick="removeSet(${ei},${si})" ${s.done ? 'disabled' : ''} title="Slett sett">✕</button>
                </div>`;
            }).join('');

            return `
            <div class="exercise-item ${allDone ? 'exercise-done' : ''} ${isOpen ? 'exercise-open' : ''}">
                <div class="exercise-header" onclick="toggleExercise(${ei})">
                    <div class="exercise-info">
                        <h4>${ex.name}</h4>
                        <span class="exercise-meta">${doneSets}/${ex.setData.length} sett</span>
                    </div>
                    <div class="exercise-header-right">
                        ${allDone ? '<span class="exercise-complete-badge">✓ Ferdig</span>' : ''}
                        <span class="exercise-chevron">${isOpen ? '▲' : '▼'}</span>
                    </div>
                </div>
                <div class="exercise-body ${isOpen ? '' : 'hidden'}">
                    <div class="set-rows">
                        <div class="set-row-header">
                            <span>Sett</span><span>Reps</span><span>Kg</span>
                            ${lastSession ? '<span class="prev-col">Forrige</span>' : '<span></span>'}
                            <span></span><span></span>
                        </div>
                        ${setRows}
                    </div>
                    <button class="add-set-btn" onclick="addSet(${ei})" ${allDone ? 'disabled' : ''}>+ Legg til sett</button>
                </div>
            </div>`;
        }).join('');

        // Sync kg inputs live
        exerciseList.querySelectorAll('.set-kg').forEach(input => {
            input.addEventListener('input', (e) => {
                const ei = parseInt(e.target.getAttribute('data-ei'));
                const si = parseInt(e.target.getAttribute('data-si'));
                currentSession.exercises[ei].setData[si].kg = parseFloat(e.target.value) || 0;
            });
        });
    }

    window.toggleExercise = function (ei) {
        if (expandedExercises.has(ei)) {
            expandedExercises.delete(ei);
        } else {
            expandedExercises.add(ei);
        }
        renderExercises();
    };

    window.markSetDone = function (ei, si) {
        const ex = currentSession.exercises[ei];
        const s  = ex.setData[si];
        const wasAlreadyDone = s.done;
        s.done = !s.done;

        if (s.done) {
            // +3 XP per sett
            state.data.userProfile.xp += 3;

            // PR-sjekk
            const exId = ex.id || ex.name;
            const isPR = checkAndUpdatePR(exId, ex.name, s.reps, s.kg || 0);
            if (isPR) {
                state.data.userProfile.xp += 25;
                showToast('Ny rekord! 🏆', `${ex.name} — ${s.reps} reps${s.kg > 0 ? ` @ ${s.kg}kg` : ''}`);
            }

            checkLevelUp();
            saveState();
            renderProfile();
        } else if (wasAlreadyDone) {
            // Angret — trekk tilbake XP (uten PR-endring)
            state.data.userProfile.xp = Math.max(0, state.data.userProfile.xp - 3);
            saveState();
            renderProfile();
        }

        // Auto-sett øvelse ferdig når alle sett er done
        ex.done = ex.setData.every(set => set.done);
        if (!ex.done) expandedExercises.add(ei);
        renderExercises();
    };

    window.updateSetReps = function (ei, si, delta) {
        const s = currentSession.exercises[ei].setData[si];
        s.reps = Math.max(0, (typeof s.reps === 'number' ? s.reps : 0) + delta);
        renderExercises();
    };

    window.addSet = function (ei) {
        const ex = currentSession.exercises[ei];
        const last = ex.setData[ex.setData.length - 1] || { reps: 8, kg: 0 };
        ex.setData.push({ reps: last.reps, kg: last.kg });
        renderExercises();
    };

    window.removeSet = function (ei, si) {
        const ex = currentSession.exercises[ei];
        if (ex.setData.length <= 1) return;
        ex.setData.splice(si, 1);
        renderExercises();
    };

    // Legacy — kept so old inline references don't crash
    window.updateSessionStat = function () {};

    // Complete Session Logic
    const completeBtn = document.getElementById('complete-session-btn');
    const summaryCard = document.getElementById('session-summary');
    const closeSessionBtn = document.getElementById('close-session-btn');

    if (completeBtn) {
        completeBtn.addEventListener('click', () => {
            finishSession();
        });
    }

    if (closeSessionBtn) {
        closeSessionBtn.addEventListener('click', () => {
            resetSessionUI();
        });
    }

    function finishSession() {
        let totalReps = 0;
        let totalSets = 0;
        let doneSets = 0;
        let doneExercises = 0;

        currentSession.exercises.forEach(ex => {
            const sets = ex.setData || [];
            totalSets += sets.length;
            sets.forEach(s => {
                if (typeof s.reps === 'number') totalReps += s.reps;
            });
            if (ex.done) {
                doneExercises += 1;
                doneSets += sets.length;
            }
        });

        const allDone = doneExercises === currentSession.exercises.length;
        // XP per sett er allerede gitt i markSetDone — her gir vi kun session-bonus
        const sessionBonus = allDone ? 50 : Math.max(5, doneExercises * 5);
        const xpEarned = sessionBonus;

        // Lagre per-øvelse historikk + logg
        currentSession.exercises.forEach(ex => {
            const sets = ex.setData || [];
            const exId = ex.id || ex.name;
            // Detaljert historikk (brukes av progression-siden)
            if (sets.some(s => s.done)) {
                saveExerciseSession(exId, ex.name, sets.filter(s => s.done));
            }
            // Legacy logg
            const avgKg   = sets.length ? sets.reduce((sum, s) => sum + (s.kg || 0), 0) / sets.length : 0;
            const avgReps = sets.length ? sets.reduce((sum, s) => sum + (typeof s.reps === 'number' ? s.reps : 0), 0) / sets.length : 0;
            logExerciseSet(exId, ex.name, sets.length, Math.round(avgReps), avgKg);
        });

        // Show Summary
        document.getElementById('summary-reps').textContent = totalReps;
        document.getElementById('summary-sets').textContent = totalSets;
        document.getElementById('summary-xp').textContent = `+${xpEarned} XP`;

        completeBtn.classList.add('hidden');
        summaryCard.classList.remove('hidden');
        exerciseList.classList.add('hidden');

        // Update Profile Data
        state.data.userProfile.xp += xpEarned;
        state.data.userProfile.stats.workouts += 1;
        state.data.userProfile.stats.reps += totalReps;

        // Check level-up
        checkLevelUp();

        // Check general achievements
        const stats = state.data.userProfile.stats;
        if (stats.workouts === 1) unlockAchievement('first_workout');
        if (stats.workouts >= 10) unlockAchievement('ten_workouts');
        if (stats.reps >= 1000) unlockAchievement('reps_1000');
        if (stats.reps >= 10000) unlockAchievement('reps_10000');

        // Add to Recent Activity
        const newActivity = {
            id: Date.now(),
            title: capitalize(currentSession.type) + ' Session',
            date: 'Akkurat nå',
            xp: xpEarned,
            icon: '🔥'
        };
        state.data.userProfile.activity.unshift(newActivity);
        if (state.data.userProfile.activity.length > 10) {
            state.data.userProfile.activity = state.data.userProfile.activity.slice(0, 10);
        }

        // Save to History
        const sessionRecord = {
            date: new Date().toISOString(),
            type: currentSession.type,
            exercises: currentSession.exercises,
            stats: { sets: totalSets, reps: totalReps, xp: xpEarned }
        };
        state.data.workoutHistory.push(sessionRecord);
        saveState();

        // Re-render Profile
        renderProfile();

        showToast('Økt fullført!', `Du tjente ${xpEarned} XP`);

        // Update 3D Core
        update3DCore();
    }

    // ---- Cinematic Hero Visual ----
    const exercises = ['PUSH-UPS', 'PULL-UPS', 'DIPS', 'MUSCLE-UP', 'L-SIT', 'HANDSTAND'];
    let cinExIdx = 0;

    function cycleCinematicExercise() {
        const items = document.querySelectorAll('.cin-ex');
        if (!items.length) return;

        const current = items[cinExIdx % items.length];
        current.classList.add('exit');
        setTimeout(() => {
            current.classList.remove('active', 'exit');
            cinExIdx = (cinExIdx + 1) % items.length;
            const next = items[cinExIdx];
            next.classList.add('active');
        }, 500);
    }

    function update3DCore() {
        const p = state.data.userProfile;

        // Reps counter — count up to actual value
        const cinReps  = document.getElementById('cin-reps');
        const cinXP    = document.getElementById('cin-xp');
        const cinLevel = document.getElementById('cin-level');
        const cinBar   = document.getElementById('cin-xp-bar');
        const streak   = document.getElementById('cin-streak');

        if (cinReps)  animateCount(cinReps,  0, p.stats?.reps || 0,  1200);
        if (cinXP)    cinXP.textContent    = `+${p.xp?.toLocaleString() || 0}`;
        if (cinLevel) cinLevel.textContent = `LVL ${p.level || 1}`;
        if (streak)   animateCount(streak,   0, p.stats?.streak || 0, 800);

        if (cinBar) {
            const levelThresholds = [0, 300, 900, 2200, 4500, 8000, 13000, 20000, 30000, 42000];
            const lvl  = p.level || 0;
            const curr = levelThresholds[Math.min(lvl, levelThresholds.length - 1)];
            const next = levelThresholds[Math.min(lvl + 1, levelThresholds.length - 1)];
            const pct  = lvl >= levelThresholds.length - 1 ? 100 : Math.min(100, ((p.xp - curr) / (next - curr)) * 100);
            setTimeout(() => { cinBar.style.width = pct + '%'; }, 400);
        }
    }

    function animateCount(el, from, to, duration) {
        if (to === 0) { el.textContent = '0'; return; }
        const start = performance.now();
        function step(now) {
            const t = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(from + (to - from) * ease).toLocaleString();
            if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    // Start exercise cycle
    const firstEx = document.querySelector('.cin-ex');
    if (firstEx) firstEx.classList.add('active');
    setInterval(cycleCinematicExercise, 2200);

    // Initialize cinematic stats
    update3DCore();

    // History UI Logic
    const historyBtn = document.getElementById('view-history-btn');
    const historyModal = document.getElementById('history-modal');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const historyList = document.getElementById('history-list');

    if (historyBtn) {
        historyBtn.addEventListener('click', () => {
            renderHistory();
            historyModal.classList.remove('hidden');
        });
    }

    if (closeHistoryBtn) {
        closeHistoryBtn.addEventListener('click', () => {
            historyModal.classList.add('hidden');
        });
    }

    function renderHistory() {
        if (!historyList) return;

        if (state.data.workoutHistory.length === 0) {
            historyList.innerHTML = '<div class="empty-state">No completed workouts yet.</div>';
            return;
        }

        // Sort by newest first
        const sortedHistory = [...state.data.workoutHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

        historyList.innerHTML = sortedHistory.map(session => {
            const date = new Date(session.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            return `
                <div class="history-item glass-card">
                    <div class="history-header">
                        <span class="history-date">${date}</span>
                        <span class="history-type">${capitalize(session.type)}</span>
                    </div>
                    <div class="history-stats">
                        <span>${session.stats.sets} Sets</span>
                        <span>${session.stats.reps} Reps</span>
                        <span class="xp-gain">+${session.stats.xp} XP</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    function resetSessionUI() {
        activePanel.classList.add('hidden');
        summaryCard.classList.add('hidden');
        exerciseList.classList.remove('hidden');
        completeBtn.classList.remove('hidden');
        workoutCards.forEach(c => c.classList.remove('active'));
        currentSession.active = false;

        // Scroll back to top of train page
        const trainingPage = document.getElementById('train');
        if (trainingPage) trainingPage.scrollTop = 0;
    }
});
