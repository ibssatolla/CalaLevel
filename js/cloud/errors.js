// Turns Supabase and database errors into short messages for people.
// The database raises short codes ('email_not_verified'). Auth errors carry a `code` or a message.

const DB = {
    not_authenticated: 'You are signed out. Log in again.',
    email_not_verified: 'Verify your email address first.',
    onboarding_incomplete: 'Finish setting up your character first.',
    invalid_name: 'Use 1 to 20 characters for the name. No < or > signs.',
    invalid_cosmetics: 'That look is not unlocked yet.',
    invalid_goal: 'Pick one main goal and up to three extra goals.',
    invalid_preferences: 'Check your answers and try again.',
    invalid_username: 'Use 3 to 24 letters, numbers or underscores.',
    username_taken: 'That username is taken.',
    character_required: 'Create your character first.',
    goals_required: 'Choose your goal first.',
    preferences_required: 'Answer the training questions first.',
    policies_not_accepted: 'Accept the terms and privacy policy to continue.',
    unknown_policy_version: 'The policy version is out of date. Reload the page.',
    daily_xp_cap: 'That workout was not counted: the daily XP limit is reached.',
    invalid_workout: 'That workout could not be stored.',
    account_not_empty: 'This account already has progress, so nothing was imported.',
    invalid_import: 'The old data could not be imported. Your data on this device is unchanged.'
};

export function isNetworkError(err) {
    if (!err) return false;
    const m = String(err.message || err);
    return err.name === 'AuthRetryableFetchError' || err.name === 'TypeError' || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(m)
        || err.status === 0 || (err.status >= 500 && err.status < 600) || err.code === 'injected';
}

export const isSessionError = err => !!err && (err.status === 401 || /jwt|refresh_token|not_authenticated|bad_jwt|session/i.test(`${err.code || ''} ${err.message || ''}`)
    && !/invalid login/i.test(err.message || ''));

export function dbCode(err) {
    const m = String(err?.message || '');
    return Object.keys(DB).find(k => m === k || m.includes(k)) || null;
}

export function describeError(err, fallback = 'Something went wrong. Try again.') {
    if (!err) return fallback;
    const code = err.code || err.error_code || '';
    const msg = String(err.message || err.msg || '');
    const known = dbCode(err);
    if (known) return DB[known];
    if (isNetworkError(err)) return 'No connection to the server. Check your internet and try again.';
    switch (code) {
        case 'invalid_credentials': return 'Wrong email or password.';
        case 'email_not_confirmed': return 'Your email is not verified yet. Open the link we sent you.';
        case 'over_email_send_rate_limit':
        case 'over_request_rate_limit': return 'Too many tries. Wait a few minutes and try again.';
        case 'weak_password': return 'Pick a stronger password: 8 or more characters with upper case, lower case and a number.';
        case 'same_password': return 'Pick a password you have not used on this account.';
        case 'user_already_exists':
        case 'email_exists': return 'An account with this email already exists. Log in instead.';
        case 'otp_expired':
        case 'flow_state_not_found':
        case 'bad_code_verifier': return 'That link has expired or was opened in another browser. Log in, or ask for a new link.';
        case 'user_not_found': return 'This account no longer exists.';
        case 'validation_failed': return 'Check the email address.';
        default: break;
    }
    if (/429|rate limit/i.test(`${err.status} ${msg}`)) return 'Too many tries. Wait a few minutes and try again.';
    return fallback;
}
