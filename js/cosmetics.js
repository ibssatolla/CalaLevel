// Cosmetic registry. Pure data plus two small functions. No DOM, no storage.
// Cosmetics change how the character looks. They never change XP, quests or any other game rule.

export const COSMETIC_CATEGORIES = [
    { id: 'avatar', label: 'Avatar' },
    { id: 'frame', label: 'Frame' },
    { id: 'background', label: 'Background' },
    { id: 'title', label: 'Title' },
    { id: 'badge', label: 'Rank badge' }
];

// requirement types: default | level | workouts | achievement | rank
// `icon` (avatars) is an icon name. `css` is a class suffix the stylesheet knows.
export const COSMETICS = [
    { id: 'avatar-user', category: 'avatar', name: 'Athlete', description: 'The starting avatar.', icon: 'user', requirement: { type: 'default' } },
    { id: 'avatar-flame', category: 'avatar', name: 'Flame', description: 'Always available.', icon: 'flame', requirement: { type: 'default' } },
    { id: 'avatar-bolt', category: 'avatar', name: 'Bolt', description: 'Always available.', icon: 'zap', requirement: { type: 'default' } },
    { id: 'avatar-target', category: 'avatar', name: 'Target', description: 'Finish your first workout.', icon: 'target', requirement: { type: 'achievement', key: 'first-steps' } },
    { id: 'avatar-shield', category: 'avatar', name: 'Shield', description: 'Reach level 3.', icon: 'shield', requirement: { type: 'level', value: 3 } },
    { id: 'avatar-crown', category: 'avatar', name: 'Crown', description: 'Reach the Elite rank.', icon: 'crown', requirement: { type: 'rank', rank: 'elite' } },

    { id: 'frame-plain', category: 'frame', name: 'Plain', description: 'The starting frame.', css: 'plain', requirement: { type: 'default' } },
    { id: 'frame-cyan', category: 'frame', name: 'Cyan ring', description: 'Finish 5 workouts.', css: 'cyan', requirement: { type: 'workouts', value: 5 } },
    { id: 'frame-violet', category: 'frame', name: 'Violet ring', description: 'Unlock the Rep Master achievement.', css: 'violet', requirement: { type: 'achievement', key: 'rep-master' } },
    { id: 'frame-gold', category: 'frame', name: 'Gold ring', description: 'Reach level 5.', css: 'gold', requirement: { type: 'level', value: 5 } },

    { id: 'bg-default', category: 'background', name: 'Night', description: 'The starting background.', css: 'night', requirement: { type: 'default' } },
    { id: 'bg-dusk', category: 'background', name: 'Dusk', description: 'Reach level 2.', css: 'dusk', requirement: { type: 'level', value: 2 } },
    { id: 'bg-grid', category: 'background', name: 'Grid', description: 'Finish 10 workouts.', css: 'grid', requirement: { type: 'workouts', value: 10 } },
    { id: 'bg-aurora', category: 'background', name: 'Aurora', description: 'Reach the Iron Athlete rank.', css: 'aurora', requirement: { type: 'rank', rank: 'iron-athlete' } },

    { id: 'title-newcomer', category: 'title', name: 'Newcomer', description: 'The starting title.', requirement: { type: 'default' } },
    { id: 'title-first-steps', category: 'title', name: 'First Steps', description: 'Unlock the First Steps achievement.', requirement: { type: 'achievement', key: 'first-steps' } },
    { id: 'title-steady', category: 'title', name: 'Steady', description: 'Unlock the Week Warrior achievement.', requirement: { type: 'achievement', key: 'week-warrior' } },
    { id: 'title-rep-master', category: 'title', name: 'Rep Master', description: 'Unlock the Rep Master achievement.', requirement: { type: 'achievement', key: 'rep-master' } },
    { id: 'title-street-warrior', category: 'title', name: 'Street Warrior', description: 'Reach the Street Warrior rank.', requirement: { type: 'rank', rank: 'street-warrior' } },

    { id: 'badge-standard', category: 'badge', name: 'Standard', description: 'The starting badge.', css: 'standard', requirement: { type: 'default' } },
    { id: 'badge-outline', category: 'badge', name: 'Outline', description: 'Reach level 4.', css: 'outline', requirement: { type: 'level', value: 4 } },
    { id: 'badge-gold', category: 'badge', name: 'Gold', description: 'Reach the Elite rank.', css: 'gold', requirement: { type: 'rank', rank: 'elite' } }
];

export const DEFAULT_SELECTION = {
    avatar: 'avatar-user', frame: 'frame-plain', background: 'bg-default', title: 'title-newcomer', badge: 'badge-standard'
};

export function getCosmetic(id) {
    return COSMETICS.find(c => c.id === id) || null;
}

export const isDefaultItem = item => item.requirement.type === 'default';

// ctx: { level, rankIndex, workouts, achievements: Set<string> }  (rankIndex = position in RANKS)
export function meetsRequirement(req, ctx, rankIndexOf) {
    switch (req.type) {
        case 'default': return true;
        case 'level': return ctx.level >= req.value;
        case 'workouts': return ctx.workouts >= req.value;
        case 'achievement': return ctx.achievements.has(req.key);
        case 'rank': return ctx.rankIndex >= rankIndexOf(req.rank);
        default: return false;
    }
}

// Items that are unlocked by ctx. Always includes the default items.
export function evaluateUnlocks(ctx, rankIndexOf) {
    return COSMETICS.filter(c => meetsRequirement(c.requirement, ctx, rankIndexOf)).map(c => c.id);
}
