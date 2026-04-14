// Default Hardcoded Data (Initial State)
const defaultState = {
    isOnboarded: false,
    apiKey: '',
    aiCoachMessage: '',
    bodyLog: [],
    exerciseLog: {},
    weeklySchedule: [
        { day: 'Mon', type: 'push', title: 'Push Strength', exercises: [] },
        { day: 'Tue', type: 'pull', title: 'Pull Power', exercises: [] },
        { day: 'Wed', type: 'rest', title: 'Active Recovery', exercises: [] },
        { day: 'Thu', type: 'legs', title: 'Legs & Core', exercises: [] },
        { day: 'Fri', type: 'skill', title: 'Skill Day', exercises: [] },
        { day: 'Sat', type: 'full', title: 'Full Body', exercises: [] },
        { day: 'Sun', type: 'rest', title: 'Rest Day', exercises: [] }
    ],
    workoutHistory: [],
    myPrograms: [],
    exerciseHistory: {},
    personalRecords: {},
    userProfile: {
        name: 'Atlet',
        age: 20,
        weightKg: 70,
        heightCm: 175,
        goal: 'strength',
        fitnessLevel: 'beginner',
        trainingDays: 4,
        level: 0,
        rankTitle: 'Nybegynner',
        xp: 0,
        nextLevelXp: 300,
        stats: {
            workouts: 0,
            reps: 0,
            streak: 0,
            rank: 999
        },
        activity: [],
        achievements: [
            { id: 'first_workout', name: 'Første steg', icon: '👟', desc: 'Fullførte første økt', unlocked: false },
            { id: 'ten_workouts', name: 'Dedikert', icon: '🏅', desc: 'Fullførte 10 økter', unlocked: false },
            { id: 'streak_7', name: 'Streak Warrior', icon: '🔥', desc: '7 dager i strekk', unlocked: false },
            { id: 'reps_1000', name: 'Rep Maskin', icon: '💪', desc: '1 000 totale reps', unlocked: false },
            { id: 'reps_10000', name: 'Rep Legenden', icon: '🦾', desc: '10 000 totale reps', unlocked: false },
            { id: 'skill_dips', name: 'Iron Pusher', icon: '🪜', desc: 'Ulåste Dips i skill tree', unlocked: false },
            { id: 'skill_pullup', name: 'Bar Puller', icon: '🧗', desc: 'Ulåste Pull Up i skill tree', unlocked: false },
            { id: 'skill_muscleup', name: 'Muscle Up King', icon: '👑', desc: 'Ulåste Muscle Up — elite nivå', unlocked: false },
            { id: 'skill_frontlever', name: 'Front Lever', icon: '⚖️', desc: 'Ulåste Front Lever — masters only', unlocked: false },
            { id: 'skill_planche', name: 'Planche God', icon: '🤸', desc: 'Ulåste Planche — legendarisk', unlocked: false }
        ]
    },
    skills: [
        { id: 'pushup',     name: 'Push Up',     level: 1, status: 'mastered', cost: 0,     x: 50, y: 8,  parents: [] },
        { id: 'dips',       name: 'Dips',         level: 2, status: 'locked',   cost: 500,   x: 28, y: 30, parents: ['pushup'] },
        { id: 'pullup',     name: 'Pull Up',      level: 2, status: 'locked',   cost: 500,   x: 72, y: 30, parents: ['pushup'] },
        { id: 'muscleup',   name: 'Muscle Up',    level: 3, status: 'locked',   cost: 3000,  x: 50, y: 52, parents: ['dips', 'pullup'] },
        { id: 'frontlever', name: 'Front Lever',  level: 4, status: 'locked',   cost: 7000,  x: 78, y: 74, parents: ['pullup'] },
        { id: 'planche',    name: 'Planche',      level: 4, status: 'locked',   cost: 10000, x: 22, y: 74, parents: ['dips'] }
    ],
    challenges: [
        { id: 1, title: 'Push-up Blitz',  type: 'Rep Battle', opponent: 'AlexStr',  status: 'Open', target: 20 },
        { id: 2, title: 'Pull-up Battle', type: 'Rep Battle', opponent: 'GymRat99', status: 'Open', target: 10 },
        { id: 3, title: 'Dip Challenge',  type: 'Rep Battle', opponent: 'BarStar',  status: 'Open', target: 15 }
    ],
    leaderboard: [
        { rank: 1, name: 'SarahGains', xp: 15400 },
        { rank: 2, name: 'IronMike', xp: 14200 },
        { rank: 3, name: 'CalisthenicsKing', xp: 13800 },
        { rank: 4, name: 'You', xp: 0 },
        { rank: 5, name: 'NewbieJoe', xp: 800 }
    ]
};

export const state = {
    data: { ...defaultState }
};

export function initState() {
    loadUserState();
}

export function loadUserState() {
    const saved = localStorage.getItem('cala_state_v1');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.data = { ...defaultState, ...parsed };
            if (!state.data.skills) state.data.skills = defaultState.skills;
            if (!state.data.challenges) state.data.challenges = defaultState.challenges;
            if (!state.data.leaderboard) state.data.leaderboard = defaultState.leaderboard;
            if (!state.data.bodyLog) state.data.bodyLog = [];
            if (!state.data.exerciseLog) state.data.exerciseLog = {};
            if (!state.data.myPrograms)       state.data.myPrograms = [];
            if (!state.data.exerciseHistory)  state.data.exerciseHistory = {};
            if (!state.data.personalRecords)  state.data.personalRecords = {};
            if (state.data.userProfile && !state.data.userProfile.achievements) {
                state.data.userProfile.achievements = defaultState.userProfile.achievements;
            }
            state.data.userProfile = { ...defaultState.userProfile, ...parsed.userProfile };
            // Ensure new achievement entries exist (for users with old saves)
            const defaultIds = defaultState.userProfile.achievements.map(a => a.id);
            const existingIds = state.data.userProfile.achievements.map(a => a.id);
            defaultIds.forEach(id => {
                if (!existingIds.includes(id)) {
                    state.data.userProfile.achievements.push(
                        defaultState.userProfile.achievements.find(a => a.id === id)
                    );
                }
            });
        } catch (e) {
            console.error('Failed to parse state, resetting to default', e);
            state.data = { ...defaultState };
        }
    }
}

export function saveState() {
    try {
        localStorage.setItem('cala_state_v1', JSON.stringify(state.data));
    } catch (e) {
        console.error('Failed to save state', e);
    }
}
