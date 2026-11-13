// Quest templates. Data only. To add a quest, add an entry here. Nothing else needs to change.
//
// slot:     main | side | optional   (which part of the day it can fill)
// category: strength | skill | mobility | consistency   (endurance, exploration and others can be added later)
// metric:   how progress is measured from logged workouts
//   best_workout_sets  the most sets in one workout that day
//   reps               logged reps of the named exercises
//   seconds            logged hold time of the named exercises, or of every exercise of a pattern
//   active_seconds     logged session time
// targets:  goal per tier. null (or missing) = not offered at that tier.
// pattern:  movement pattern. Used to rest a pattern that was trained hard recently.
// requires: equipment ids the player has set up, and a skill that must be owned.

const dur = s => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);

export const QUEST_TEMPLATES = [
    // ---- Main ----
    {
        id: 'main-workout', slot: 'main', category: 'strength', pattern: 'full',
        metric: { kind: 'best_workout_sets' }, targets: { beginner: 1, intermediate: 8, advanced: 14 },
        title: (t, tier) => (tier === 'beginner' ? 'Complete one workout' : tier === 'intermediate' ? `Complete a workout of ${t}+ sets` : `Complete a strength session of ${t}+ sets`),
        description: (t, tier) => (tier === 'beginner' ? 'Any workout counts. Log at least one set.' : `Finish one workout with at least ${t} logged sets.`)
    },
    {
        id: 'main-recovery', slot: 'main', category: 'mobility', pattern: 'mobility', restDay: true,
        metric: { kind: 'seconds', pattern: 'mobility' }, targets: { beginner: 300, intermediate: 300, advanced: 360 },
        title: t => `Active recovery: ${dur(t)} of mobility`,
        description: () => 'A rest day is part of training. Log a short mobility flow if you feel like it.'
    },

    // ---- Side: strength ----
    {
        id: 'side-pushups', slot: 'side', category: 'strength', pattern: 'push',
        metric: { kind: 'reps', names: ['Push-ups'] }, targets: { beginner: 15, intermediate: 30, advanced: 50 },
        title: t => `Complete ${t} push-ups`, description: () => 'Count every rep you log, across as many sets as you like.'
    },
    {
        id: 'side-squats', slot: 'side', category: 'strength', pattern: 'legs',
        metric: { kind: 'reps', names: ['Squats'] }, targets: { beginner: 20, intermediate: 40, advanced: 60 },
        title: t => `Complete ${t} squats`, description: () => 'Bodyweight squats, any number of sets.'
    },
    {
        id: 'side-aus-pullups', slot: 'side', category: 'strength', pattern: 'pull', requires: { equipment: ['bar'] },
        metric: { kind: 'reps', names: ['Australian Pull-ups'] }, targets: { beginner: 8, intermediate: 15 },
        title: t => `Complete ${t} Australian pull-ups`, description: () => 'Low bar, body straight, feet on the floor.'
    },
    {
        id: 'side-pullups', slot: 'side', category: 'strength', pattern: 'pull', requires: { equipment: ['bar'], skill: 'pullup' },
        metric: { kind: 'reps', names: ['Pull-ups', 'Chin-ups'] }, targets: { intermediate: 5, advanced: 12 },
        title: t => `Complete ${t} pull-ups`, description: () => 'Pull-ups or chin-ups count. Rest between sets.'
    },
    {
        id: 'side-dips', slot: 'side', category: 'strength', pattern: 'push', requires: { equipment: ['parallel'], skill: 'dips' },
        metric: { kind: 'reps', names: ['Dips'] }, targets: { intermediate: 10, advanced: 20 },
        title: t => `Complete ${t} dips`, description: () => 'Full range, controlled. Stop before form breaks.'
    },
    {
        id: 'side-legraises', slot: 'side', category: 'strength', pattern: 'core',
        metric: { kind: 'reps', names: ['Leg Raises'] }, targets: { intermediate: 15, advanced: 25 },
        title: t => `Complete ${t} leg raises`, description: () => 'Straight legs, no swinging.'
    },

    // ---- Side: skill ----
    {
        id: 'skill-plank', slot: 'side', category: 'skill', pattern: 'core',
        metric: { kind: 'seconds', names: ['Plank'] }, targets: { beginner: 60, intermediate: 120, advanced: 180 },
        title: t => `Hold a plank for ${dur(t)} in total`, description: () => 'Split it into sets. Foundation for the L-sit.'
    },
    {
        id: 'skill-lsit-prep', slot: 'side', category: 'skill', pattern: 'core',
        metric: { kind: 'seconds', names: ['L-Sit Prep'] }, targets: { intermediate: 40 },
        title: t => `Practice L-sit progression: ${t} s total`, description: () => 'Tuck one or both knees. Build time before you extend the legs.'
    },
    {
        id: 'skill-lsit', slot: 'side', category: 'skill', pattern: 'core', requires: { equipment: ['parallel'] },
        metric: { kind: 'seconds', names: ['L-Sit', 'L-Sit Hold'] }, targets: { advanced: 45 },
        title: t => `Hold an L-sit for ${t} s in total`, description: () => 'Several short holds with full rest are better than one long grind.'
    },
    {
        id: 'skill-handstand', slot: 'side', category: 'skill', pattern: 'skill',
        metric: { kind: 'seconds', names: ['Handstand Wall Hold', 'Handstand Hold'] }, targets: { intermediate: 60, advanced: 120 },
        title: t => `Practice handstand: ${dur(t)} total`, description: () => 'Wall holds count. Keep the shoulders pushed up.'
    },

    // ---- Optional: recovery and consistency ----
    {
        id: 'rec-mobility', slot: 'optional', category: 'mobility', pattern: 'mobility', recovery: true,
        metric: { kind: 'seconds', pattern: 'mobility' }, targets: { beginner: 180, intermediate: 300, advanced: 300 },
        title: t => `Complete ${dur(t)} of mobility`, description: () => 'Cat-cow, hips, shoulders. Slow and easy.'
    },
    {
        id: 'cons-minutes', slot: 'optional', category: 'consistency', pattern: 'full',
        metric: { kind: 'active_seconds' }, targets: { beginner: 300, intermediate: 600, advanced: 900 },
        title: t => `Move for ${dur(t)} today`, description: () => 'Any logged session time counts. Short is fine.'
    }
];

export const getTemplate = id => QUEST_TEMPLATES.find(t => t.id === id) || null;
