import { state, saveState } from './state.js';

export function checkAuth() {
    return state.data.isOnboarded === true;
}

export function completeOnboarding(profileData) {
    state.data.isOnboarded = true;
    state.data.userProfile.name = profileData.name;
    state.data.userProfile.age = parseInt(profileData.age) || 20;
    state.data.userProfile.weightKg = parseFloat(profileData.weightKg) || 70;
    state.data.userProfile.heightCm = parseInt(profileData.heightCm) || 175;
    state.data.userProfile.goal = profileData.goal;
    state.data.userProfile.fitnessLevel = profileData.fitnessLevel;
    state.data.userProfile.trainingDays = parseInt(profileData.trainingDays) || 4;
    state.data.apiKey = profileData.apiKey || '';
    saveState();
}

export function updateProfile(profileData) {
    if (profileData.name !== undefined) state.data.userProfile.name = profileData.name;
    if (profileData.weightKg !== undefined) state.data.userProfile.weightKg = parseFloat(profileData.weightKg);
    if (profileData.heightCm !== undefined) state.data.userProfile.heightCm = parseInt(profileData.heightCm);
    if (profileData.goal !== undefined) state.data.userProfile.goal = profileData.goal;
    if (profileData.fitnessLevel !== undefined) state.data.userProfile.fitnessLevel = profileData.fitnessLevel;
    if (profileData.trainingDays !== undefined) state.data.userProfile.trainingDays = parseInt(profileData.trainingDays);
    if (profileData.apiKey !== undefined) state.data.apiKey = profileData.apiKey;
    saveState();
}

export function resetUser() {
    localStorage.removeItem('cala_state_v1');
    location.reload();
}
