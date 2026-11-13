// Thin wrappers around the database functions (see supabase/migrations). Every write to an account goes through here.
// Each call returns the function result or throws an error that describeError() understands.
import { getClient } from './client.js';

async function rpc(name, args = {}) {
    const c = await getClient();
    const { data, error } = await c.rpc(name, args);
    if (error) throw error;
    return data;
}

export const getProgress = () => rpc('get_progress');
export const acceptPolicies = (terms, privacy) => rpc('accept_policies', { p_terms: terms, p_privacy: privacy });
export const saveCharacter = ({ name, avatar, options }) => rpc('save_character', { p_name: name, p_avatar: avatar, p_options: options || {} });
export const saveGoals = ({ primary, secondary }) => rpc('save_goals', { p_primary: primary, p_secondary: secondary || [] });
export const savePreferences = p => rpc('save_preferences', {
    p_experience: p.experience, p_environment: p.environment, p_equipment: p.equipment, p_frequency: p.frequency, p_duration: p.duration
});
export const completeOnboarding = () => rpc('complete_onboarding');
export const setUsername = name => rpc('set_username', { p_username: name });
export const recordWorkout = w => rpc('record_workout', {
    p_client_id: w.id, p_type: w.type, p_title: w.title, p_exercises: w.exercises, p_duration: w.duration,
    p_completed_at: w.completedAt, p_complete: w.complete, p_details: w.details
});
export const syncQuests = quests => rpc('sync_quests', { p_quests: quests });
export const syncUnlocks = (achievements, cosmetics) => rpc('sync_unlocks', { p_achievements: achievements, p_cosmetics: cosmetics });
export const saveAppState = data => rpc('save_app_state', { p_data: data });
export const importLocalProgress = payload => rpc('import_local_progress', { p_data: payload });
export const deleteMyAccount = () => rpc('delete_my_account');
