// Exercise library and workout building. Pure data + logic, no DOM access.

// unit: 'reps' or 'sec'. Timed exercises store seconds per set instead of reps.
export const exerciseLibrary = [
    { id: 'push1', name: 'Push-ups', type: 'push', difficulty: 1, unit: 'reps', tags: ['Chest', 'Triceps'], desc: 'Hands under shoulders, body in one line. Lower until the chest is a fist from the floor, then press up.' },
    { id: 'push2', name: 'Dips', type: 'push', difficulty: 2, unit: 'reps', tags: ['Triceps', 'Chest'], desc: 'Support yourself on parallel bars. Lower until the upper arms are parallel to the ground, then press back up.' },
    { id: 'push3', name: 'Pike Push-ups', type: 'push', difficulty: 2, unit: 'reps', tags: ['Shoulders'], desc: 'Hips high in an inverted V. Bend the elbows to bring the head toward the floor between the hands.' },
    { id: 'push4', name: 'Archer Push-ups', type: 'push', difficulty: 3, unit: 'reps', tags: ['Chest', 'Core'], desc: 'Wide hand position. Shift your weight to one arm while the other stays straight, then switch sides.' },
    { id: 'push5', name: 'Diamond Push-ups', type: 'push', difficulty: 2, unit: 'reps', tags: ['Triceps'], desc: 'Form a diamond with the thumbs and index fingers. Keep the elbows close to the ribs.' },
    { id: 'push6', name: 'Pseudo Planche Push-ups', type: 'push', difficulty: 3, unit: 'reps', tags: ['Shoulders', 'Chest'], desc: 'Hands by the hips, fingers pointing back. Lean far forward past the hands and push up.' },
    { id: 'pull1', name: 'Pull-ups', type: 'pull', difficulty: 2, unit: 'reps', tags: ['Back', 'Biceps'], desc: 'Overhand grip, slightly wider than the shoulders. Pull until the chin clears the bar. Lower under control.' },
    { id: 'pull2', name: 'Chin-ups', type: 'pull', difficulty: 2, unit: 'reps', tags: ['Biceps', 'Back'], desc: 'Underhand grip at shoulder width. Pull the chest toward the bar.' },
    { id: 'pull3', name: 'Australian Pull-ups', type: 'pull', difficulty: 1, unit: 'reps', tags: ['Back'], desc: 'Hang under a low bar with the body straight. Pull the chest to the bar. Feet on the floor.' },
    { id: 'pull4', name: 'Muscle-up', type: 'pull', difficulty: 3, unit: 'reps', tags: ['Explosive'], desc: 'Explosive pull that transitions over the bar into a dip. Needs strong pull-ups and dips first.' },
    { id: 'pull5', name: 'Commando Pull-ups', type: 'pull', difficulty: 2, unit: 'reps', tags: ['Back', 'Biceps'], desc: 'Grip the bar side-on with one hand in front of the other. Pull the head to alternating sides.' },
    { id: 'pull6', name: 'High Pull-ups', type: 'pull', difficulty: 3, unit: 'reps', tags: ['Explosive'], desc: 'Pull powerfully so the chest or lower ribs reach the bar.' },
    { id: 'legs1', name: 'Squats', type: 'legs', difficulty: 1, unit: 'reps', tags: ['Quads', 'Glutes'], desc: 'Feet shoulder width. Sit back and down until the thighs are parallel, then stand tall.' },
    { id: 'legs2', name: 'Lunges', type: 'legs', difficulty: 1, unit: 'reps', tags: ['Legs'], desc: 'Step forward and lower the back knee toward the floor. Push back to the start.' },
    { id: 'legs3', name: 'Jump Squats', type: 'legs', difficulty: 2, unit: 'reps', tags: ['Explosive'], desc: 'Squat down, then jump as high as you can. Land softly and go straight into the next rep.' },
    { id: 'legs4', name: 'Pistol Squats', type: 'legs', difficulty: 3, unit: 'reps', tags: ['Balance'], desc: 'Single-leg squat with the other leg held out in front. Count reps per leg as one rep.' },
    { id: 'legs5', name: 'Bulgarian Split Squats', type: 'legs', difficulty: 2, unit: 'reps', tags: ['Legs'], desc: 'Rear foot on a bench. Lower the front leg until the thigh is parallel.' },
    { id: 'legs6', name: 'Calf Raises', type: 'legs', difficulty: 1, unit: 'reps', tags: ['Calves'], desc: 'Rise onto the toes, pause at the top, then lower slowly. Use a step for more range.' },
    { id: 'core1', name: 'Plank', type: 'core', difficulty: 1, unit: 'sec', tags: ['Abs'], desc: 'Forearms on the floor, body straight from head to heels. Squeeze the glutes and abs.' },
    { id: 'core2', name: 'Leg Raises', type: 'core', difficulty: 2, unit: 'reps', tags: ['Abs'], desc: 'Hang or lie flat. Raise straight legs to hip height without swinging.' },
    { id: 'core3', name: 'L-Sit', type: 'core', difficulty: 3, unit: 'sec', tags: ['Core'], desc: 'Support on parallettes or the floor. Hold the legs straight out in front, parallel to the ground.' },
    { id: 'core4', name: 'Russian Twists', type: 'core', difficulty: 1, unit: 'reps', tags: ['Obliques'], desc: 'Sit with the torso leaned back and feet raised. Rotate the shoulders from side to side.' },
    { id: 'skill1', name: 'Handstand Wall Hold', type: 'skill', difficulty: 2, unit: 'sec', tags: ['Balance'], desc: 'Kick up with the chest facing the wall. Keep the body straight and the shoulders pushed up.' },
    { id: 'skill2', name: 'L-Sit Prep', type: 'skill', difficulty: 2, unit: 'sec', tags: ['Core'], desc: 'Tuck one or both knees while supported. Build time before extending the legs.' },
    { id: 'skill3', name: 'Crow Pose', type: 'skill', difficulty: 2, unit: 'sec', tags: ['Balance'], desc: 'Knees on the backs of the upper arms. Lean forward until the feet leave the floor.' },
    { id: 'skill4', name: 'Skin the Cat', type: 'skill', difficulty: 2, unit: 'reps', tags: ['Mobility'], desc: 'Hang from the bar, pull the knees up and rotate backward through the arms, then return.' },
    { id: 'mob1', name: 'Cat-Cow', type: 'mobility', difficulty: 1, unit: 'sec', tags: ['Spine'], desc: 'On hands and knees. Round the back up, then drop the belly and lift the chest. Move slowly with the breath.' },
    { id: 'mob2', name: 'Deep Squat Hold', type: 'mobility', difficulty: 1, unit: 'sec', tags: ['Hips', 'Ankles'], desc: 'Sit in the lowest squat you can hold with heels down. Use a support in front if needed.' },
    { id: 'mob3', name: 'Hip Flexor Stretch', type: 'mobility', difficulty: 1, unit: 'sec', tags: ['Hips'], desc: 'Half-kneeling lunge. Tuck the pelvis and shift forward until you feel the front of the back hip open. Switch sides.' },
    { id: 'mob4', name: 'Thoracic Rotation', type: 'mobility', difficulty: 1, unit: 'sec', tags: ['Upper back'], desc: 'On hands and knees, one hand behind the head. Rotate the elbow toward the ceiling and back. Switch sides.' },
    { id: 'mob5', name: 'Shoulder Dislocates', type: 'mobility', difficulty: 1, unit: 'sec', tags: ['Shoulders'], desc: 'Hold a band or towel wide. Lift it over the head and behind the back with straight arms. Go slowly.' },
    { id: 'mob6', name: 'Hamstring Stretch', type: 'mobility', difficulty: 1, unit: 'sec', tags: ['Hamstrings'], desc: 'Sit with one leg straight. Hinge from the hips with a long spine until you feel a stretch. Switch sides.' }
];

// Which kind of work an exercise name is. Used for quests and character attributes.
// Names come from the library first. Names that only exist in presets are matched by keyword.
const KEYWORDS = [
    [/cat-cow|stretch|mobility|dislocate|rotation|deep squat hold|hip flexor/i, 'mobility'],
    [/handstand|planche|crow|skin the cat|front lever|muscle/i, 'skill'],
    [/l-sit|plank|leg raise|twist/i, 'core'],
    [/push|dip/i, 'push'],
    [/pull|chin/i, 'pull'],
    [/squat|lunge|calf/i, 'legs']
];
const byName = new Map(exerciseLibrary.map(ex => [ex.name.toLowerCase(), ex]));

export function classifyExercise(name) {
    const key = String(name || '').toLowerCase();
    const hit = byName.get(key);
    if (hit) return hit.type;
    const kw = KEYWORDS.find(([re]) => re.test(key));
    return kw ? kw[1] : 'full';
}

// Quick-start presets used by the four cards in the Training section.
export const presetWorkouts = {
    push: {
        title: 'Push Day',
        exercises: [
            { id: 'p1', name: 'Push-ups', sets: 4, reps: 15, unit: 'reps' },
            { id: 'p2', name: 'Dips', sets: 3, reps: 10, unit: 'reps' },
            { id: 'p3', name: 'Pike Push-ups', sets: 3, reps: 8, unit: 'reps' },
            { id: 'p4', name: 'Diamond Push-ups', sets: 3, reps: 12, unit: 'reps' }
        ]
    },
    pull: {
        title: 'Pull Day',
        exercises: [
            { id: 'pu1', name: 'Pull-ups', sets: 4, reps: 8, unit: 'reps' },
            { id: 'pu2', name: 'Chin-ups', sets: 3, reps: 8, unit: 'reps' },
            { id: 'pu3', name: 'Australian Pull-ups', sets: 3, reps: 12, unit: 'reps' },
            { id: 'pu4', name: 'Commando Pull-ups', sets: 3, reps: 6, unit: 'reps' }
        ]
    },
    full: {
        title: 'Full Body',
        exercises: [
            { id: 'f1', name: 'Burpees', sets: 3, reps: 15, unit: 'reps' },
            { id: 'f2', name: 'Jump Squats', sets: 4, reps: 20, unit: 'reps' },
            { id: 'f3', name: 'Push-ups', sets: 3, reps: 15, unit: 'reps' },
            { id: 'f4', name: 'Lunges', sets: 3, reps: 12, unit: 'reps' }
        ]
    },
    mobility: {
        title: 'Mobility Flow',
        exercises: [
            { id: 'm1', name: 'Cat-Cow', sets: 2, reps: 45, unit: 'sec' },
            { id: 'm2', name: 'Deep Squat Hold', sets: 2, reps: 45, unit: 'sec' },
            { id: 'm3', name: 'Hip Flexor Stretch', sets: 2, reps: 45, unit: 'sec' },
            { id: 'm4', name: 'Thoracic Rotation', sets: 2, reps: 30, unit: 'sec' },
            { id: 'm5', name: 'Hamstring Stretch', sets: 2, reps: 45, unit: 'sec' }
        ]
    },
    skill: {
        title: 'Skill Practice',
        exercises: [
            { id: 's1', name: 'Handstand Hold', sets: 5, reps: 30, unit: 'sec' },
            { id: 's2', name: 'L-Sit Hold', sets: 4, reps: 15, unit: 'sec' },
            { id: 's3', name: 'Planche Lean', sets: 4, reps: 10, unit: 'sec' }
        ]
    }
};

export const SESSION_TYPES = ['push', 'pull', 'legs', 'skill', 'full'];

function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function poolFor(types) {
    return exerciseLibrary.filter(ex => types.includes(ex.type));
}

function toPlanned(ex) {
    const d = ex.difficulty;
    const reps = ex.unit === 'sec' ? (d === 3 ? 15 : d === 2 ? 20 : 30) : (d === 3 ? 5 : d === 2 ? 8 : 12);
    return { id: ex.id, name: ex.name, sets: 3, reps, unit: ex.unit };
}

// Builds 4 exercises for a session type. Exercises in avoidIds are skipped when enough others exist.
export function buildWorkout(type, avoidIds = []) {
    if (type === 'rest') return [];

    if (type === 'full') {
        // One exercise from each main group so a full body session is actually balanced.
        return ['push', 'pull', 'legs', 'core'].map(group => {
            const all = poolFor([group]);
            const fresh = all.filter(ex => !avoidIds.includes(ex.id));
            return toPlanned(shuffle(fresh.length ? fresh : all)[0]);
        });
    }

    const types = type === 'legs' ? ['legs', 'core'] : [type];
    const all = poolFor(types);
    let pool = all.filter(ex => !avoidIds.includes(ex.id));
    if (pool.length < 3) pool = all;
    return shuffle(pool).slice(0, 4).map(toPlanned);
}
