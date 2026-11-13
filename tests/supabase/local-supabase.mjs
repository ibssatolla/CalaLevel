// A small local stand-in for Supabase, for tests only. It is NOT Supabase.
//   - Auth (GoTrue subset): signup, email confirm, password login, PKCE code exchange, refresh, recover, update password, logout.
//   - Data (PostgREST subset): /rest/v1/rpc/<function> and plain table read/insert/update/delete.
// Every data call runs against a real local PostgreSQL that has the real migrations applied, with the real API role
// (anon or authenticated) and the JWT claims set, so RLS, grants and functions behave as they do on Supabase.
// What it does not cover: real email delivery, real rate limits, real JWT keys, real token lifetimes, Supabase dashboard settings.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { freshDatabase, applyMigrations } from './db.mjs';

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const SECRET = 'local-test-secret-not-a-real-key';
const sign = payload => {
    const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
    return `${head}.${crypto.createHmac('sha256', SECRET).update(head).digest('base64url')}`;
};
function verify(token) {
    const [h, p, s] = String(token || '').split('.');
    if (!h || !p || !s) return null;
    const good = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
    if (good !== s) return null;
    try { return JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
}
const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
const checkHash = (pw, stored) => stored && hash(pw, stored.split(':')[0]) === stored;
const IDENT = /^[a-z_][a-z0-9_]*$/;

export async function startLocalSupabase({ dbName = 'cala_e2e' } = {}) {
    const admin = await freshDatabase(dbName);
    await applyMigrations(admin);
    await admin.end();
    const pool = new pg.Pool({ host: process.env.PGHOST || '/tmp', port: Number(process.env.PGPORT || 54329), user: process.env.PGUSER || 'postgres', database: dbName, max: 10 });

    const refreshTokens = new Map();   // token -> user id
    const authCodes = new Map();       // code -> { userId, challenge, method }
    const pending = new Map();         // email token -> { userId, type, redirectTo, challenge, method }
    const lastEmailAt = new Map();     // email -> ms
    const emails = [];                 // every email "sent"
    const config = { emailRateLimitMs: 0, latencyMs: 0, failNext: [], passwordPolicy: true, requestLog: true };
    const log = [];                    // { method, path }
    let base = '';

    const anonKey = sign({ iss: 'local-supabase', role: 'anon', exp: 4102444800 });
    const userJson = row => ({
        id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email, email_confirmed_at: row.email_confirmed_at,
        phone: '', created_at: row.created_at, updated_at: row.created_at,
        app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: row.raw_user_meta_data || {},
        identities: [{ identity_id: crypto.randomUUID(), id: row.id, user_id: row.id, identity_data: { email: row.email, sub: row.id }, provider: 'email' }]
    });
    const getUserByEmail = async email => (await pool.query('select * from auth.users where lower(email) = lower($1)', [email])).rows[0];
    const getUserById = async id => (await pool.query('select * from auth.users where id = $1', [id])).rows[0];

    function issueSession(user, { ttl = 3600 } = {}) {
        const now = Math.floor(Date.now() / 1000);
        const access = sign({
            iss: `${base}/auth/v1`, sub: user.id, aud: 'authenticated', exp: now + ttl, iat: now, email: user.email, phone: '',
            app_metadata: { provider: 'email' }, user_metadata: user.raw_user_meta_data || {}, role: 'authenticated', aal: 'aal1', session_id: crypto.randomUUID()
        });
        const refresh = crypto.randomBytes(12).toString('hex');
        refreshTokens.set(refresh, user.id);
        return { access_token: access, token_type: 'bearer', expires_in: ttl, expires_at: now + ttl, refresh_token: refresh, user: userJson(user) };
    }

    function queueEmail(user, type, redirectTo, challenge, method) {
        const token = crypto.randomBytes(10).toString('hex');
        pending.set(token, { userId: user.id, type, redirectTo, challenge, method });
        const link = `${base}/auth/v1/verify?token=${token}&type=${type}&redirect_to=${encodeURIComponent(redirectTo || '')}`;
        emails.push({ to: user.email, type, token, link, at: Date.now() });
        lastEmailAt.set(user.email.toLowerCase(), Date.now());
    }
    const rateLimited = email => config.emailRateLimitMs > 0 && Date.now() - (lastEmailAt.get(email.toLowerCase()) || 0) < config.emailRateLimitMs;

    const passwordProblem = pw => {
        if (typeof pw !== 'string' || pw.length < 8) return 'Password should be at least 8 characters.';
        if (config.passwordPolicy && !(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw))) return 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.';
        return null;
    };

    // ---- RPC metadata ----
    const fnMeta = new Map();
    {
        const r = await pool.query(`select p.proname, p.proargnames names, array(select format_type(t, null) from unnest(p.proargtypes) t) types
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`);
        r.rows.forEach(row => fnMeta.set(row.proname, row));
    }

    async function asRole(role, claims, fn) {
        const c = await pool.connect();
        try {
            await c.query('begin');
            await c.query(`set local role ${role}`);
            await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
            const out = await fn(c);
            await c.query('commit');
            return out;
        } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
    }

    const send = (res, status, body, headers = {}) => {
        const data = body === undefined ? '' : JSON.stringify(body);
        res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', ...headers });
        res.end(data);
    };
    const authErr = (res, status, code, msg, extra = {}) => send(res, status, { code: status, error_code: code, msg, message: msg, ...extra });
    const readBody = req => new Promise(resolve => {
        let d = ''; req.on('data', c => { d += c; }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    });
    const bearer = req => (String(req.headers.authorization || '').match(/^Bearer (.+)$/) || [])[1];

    function pgToHttp(e, res) {
        const status = e.code === '42501' ? 403 : e.code === '23505' ? 409 : 400;
        send(res, status, { code: e.code, details: e.detail || null, hint: e.hint || null, message: e.message });
    }

    async function handleAuth(req, res, url, body) {
        const p = url.pathname.replace('/auth/v1', '');
        const q = url.searchParams;
        if (p === '/signup' && req.method === 'POST') {
            const { email, password, data = {}, code_challenge: challenge, code_challenge_method: method } = body;
            if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authErr(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
            const problem = passwordProblem(password);
            if (problem) return authErr(res, 422, 'weak_password', problem, { weak_password: { reasons: ['length'] } });
            const existing = await getUserByEmail(email);
            if (existing) {
                // Like Supabase with "Confirm email" on: no error, a user object without identities.
                if (!existing.email_confirmed_at) { if (!rateLimited(email)) queueEmail(existing, 'signup', q.get('redirect_to'), challenge, method); }
                return send(res, 200, { ...userJson(existing), identities: [], email_confirmed_at: undefined });
            }
            const row = (await pool.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning *`, [email, hash(password), JSON.stringify(data)])).rows[0];
            queueEmail(row, 'signup', q.get('redirect_to'), challenge, method);
            return send(res, 200, { ...userJson(row), email_confirmed_at: undefined });
        }
        if (p === '/resend' && req.method === 'POST') {
            const user = await getUserByEmail(body.email || '');
            if (user && rateLimited(user.email)) return authErr(res, 429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 60 seconds.');
            if (user && !user.email_confirmed_at) queueEmail(user, 'signup', q.get('redirect_to'), undefined, undefined);
            return send(res, 200, { message_id: crypto.randomUUID() });
        }
        if (p === '/verify' && req.method === 'GET') {
            const t = pending.get(q.get('token'));
            if (!t) return authErr(res, 403, 'otp_expired', 'Email link is invalid or has expired');
            pending.delete(q.get('token'));
            await pool.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [t.userId]);
            const code = crypto.randomBytes(10).toString('hex');
            authCodes.set(code, { userId: t.userId, challenge: t.challenge, method: t.method, recovery: t.type === 'recovery' });
            const to = new URL(t.redirectTo || q.get('redirect_to') || base);
            to.searchParams.set('code', code);
            res.writeHead(303, { location: to.toString(), 'access-control-allow-origin': '*' });
            return res.end();
        }
        if (p === '/token' && req.method === 'POST') {
            const grant = q.get('grant_type');
            if (grant === 'password') {
                const user = await getUserByEmail(body.email || '');
                if (!user || !checkHash(body.password || '', user.encrypted_password)) return authErr(res, 400, 'invalid_credentials', 'Invalid login credentials');
                if (!user.email_confirmed_at) return authErr(res, 400, 'email_not_confirmed', 'Email not confirmed');
                return send(res, 200, issueSession(user));
            }
            if (grant === 'refresh_token') {
                const uid = refreshTokens.get(body.refresh_token);
                const user = uid && await getUserById(uid);
                if (!user) return authErr(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
                refreshTokens.delete(body.refresh_token);
                return send(res, 200, issueSession(user));
            }
            if (grant === 'pkce') {
                const rec = authCodes.get(body.auth_code);
                if (!rec) return authErr(res, 400, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
                const expected = rec.method === 's256' || rec.method === 'S256' ? crypto.createHash('sha256').update(body.code_verifier || '').digest('base64url') : body.code_verifier;
                if (rec.challenge && expected !== rec.challenge) return authErr(res, 400, 'bad_code_verifier', 'code challenge does not match previously saved code verifier');
                authCodes.delete(body.auth_code);
                const user = await getUserById(rec.userId);
                return send(res, 200, { ...issueSession(user), ...(rec.recovery ? { redirect_type: 'recovery' } : {}) });
            }
            return authErr(res, 400, 'unsupported_grant_type', 'unsupported grant type');
        }
        if (p === '/recover' && req.method === 'POST') {
            const user = await getUserByEmail(body.email || '');
            if (user && rateLimited(user.email)) return authErr(res, 429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 60 seconds.');
            if (user) queueEmail(user, 'recovery', q.get('redirect_to'), body.code_challenge, body.code_challenge_method);
            return send(res, 200, {});
        }
        if (p === '/user') {
            const claims = verify(bearer(req));
            if (!claims || claims.role !== 'authenticated' || claims.exp < Date.now() / 1000) return authErr(res, 401, 'bad_jwt', 'invalid JWT: token is expired or invalid');
            const user = await getUserById(claims.sub);
            if (!user) return authErr(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist');
            if (req.method === 'GET') return send(res, 200, userJson(user));
            if (req.method === 'PUT') {
                if (body.password !== undefined) {
                    const problem = passwordProblem(body.password);
                    if (problem) return authErr(res, 422, 'weak_password', problem);
                    if (checkHash(body.password, user.encrypted_password)) return authErr(res, 422, 'same_password', 'New password should be different from the old password.');
                    await pool.query('update auth.users set encrypted_password = $2 where id = $1', [user.id, hash(body.password)]);
                }
                return send(res, 200, userJson(await getUserById(user.id)));
            }
        }
        if (p === '/logout') return send(res, 204);
        return authErr(res, 404, 'not_found', `no auth route ${p}`);
    }

    async function handleRest(req, res, url, body) {
        const p = url.pathname.replace('/rest/v1/', '');
        const claims = verify(bearer(req));
        if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid', details: null, hint: null });
        if (claims.exp && claims.exp < Date.now() / 1000) return send(res, 401, { code: 'PGRST303', message: 'JWT expired', details: null, hint: null });
        const role = claims.role === 'authenticated' ? 'authenticated' : 'anon';
        if (role === 'authenticated' && !(await getUserById(claims.sub))) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid (user deleted)', details: null, hint: null });
        try {
            if (p.startsWith('rpc/')) {
                const name = p.slice(4);
                const meta = fnMeta.get(name);
                if (!meta) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${name}`, details: null, hint: null });
                const keys = Object.keys(body);
                if (keys.some(k => !meta.names.includes(k))) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${name}(${keys.join(', ')})`, details: null, hint: null });
                const args = keys.map((k, i) => `${k} => $${i + 1}::${meta.types[meta.names.indexOf(k)]}`).join(', ');
                const values = keys.map(k => {
                    const type = meta.types[meta.names.indexOf(k)];
                    const isJson = /^jsonb?$/.test(type);
                    if (body[k] !== null && typeof body[k] === 'object' && (isJson || !Array.isArray(body[k]))) return JSON.stringify(body[k]);   // jsonb arrays must stay JSON, text[] arrays stay arrays
                    return body[k];
                });
                const r = await asRole(role, claims, c => c.query(`select public.${name}(${args}) as r`, values));
                return send(res, 200, r.rows[0].r);
            }
            const table = p.split('?')[0];
            if (!IDENT.test(table)) return send(res, 404, { code: 'PGRST205', message: 'unknown table', details: null, hint: null });
            const where = []; const vals = [];
            for (const [k, v] of url.searchParams) {
                if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k) || !IDENT.test(k)) continue;
                const m = /^eq\.(.*)$/.exec(v);
                if (m) { vals.push(m[1]); where.push(`${k}::text = $${vals.length}`); }
            }
            const w = where.length ? ` where ${where.join(' and ')}` : '';
            if (req.method === 'GET') {
                const sel = (url.searchParams.get('select') || '*').split(',').map(s => s.trim());
                if (!sel.every(s => s === '*' || IDENT.test(s))) return send(res, 400, { code: 'PGRST100', message: 'bad select', details: null, hint: null });
                const order = url.searchParams.get('order');
                const om = order && /^([a-z_][a-z0-9_]*)\.(asc|desc)$/.exec(order);
                const lim = Number(url.searchParams.get('limit')) || 1000;
                const r = await asRole(role, claims, c => c.query(`select ${sel.join(', ')} from public.${table}${w}${om ? ` order by ${om[1]} ${om[2]}` : ''} limit ${lim}`, vals));
                return send(res, 200, r.rows);
            }
            if (req.method === 'POST') {
                const rows = Array.isArray(body) ? body : [body];
                const cols = Object.keys(rows[0] || {});
                if (!cols.every(c => IDENT.test(c))) return send(res, 400, { code: 'PGRST100', message: 'bad column', details: null, hint: null });
                await asRole(role, claims, async c => { for (const row of rows) await c.query(`insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map(k => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]))); });
                return send(res, 201);
            }
            if (req.method === 'PATCH') {
                const cols = Object.keys(body);
                if (!cols.length || !cols.every(c => IDENT.test(c))) return send(res, 400, { code: 'PGRST100', message: 'bad column', details: null, hint: null });
                const sets = cols.map((c, i) => `${c} = $${vals.length + i + 1}`).join(', ');
                await asRole(role, claims, c => c.query(`update public.${table} set ${sets}${w}`, [...vals, ...cols.map(k => (body[k] !== null && typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]))]));
                return send(res, 204);
            }
            if (req.method === 'DELETE') {
                await asRole(role, claims, c => c.query(`delete from public.${table}${w}`, vals));
                return send(res, 204);
            }
        } catch (e) { return pgToHttp(e, res); }
        return send(res, 405, { message: 'method not allowed' });
    }

    const server = http.createServer(async (req, res) => {
        try {
            if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-max-age': '600' }); return res.end(); }
            const url = new URL(req.url, base || 'http://localhost');
            const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
            if (config.requestLog) log.push({ method: req.method, path: url.pathname, at: Date.now() });
            if (config.latencyMs) await new Promise(r => setTimeout(r, config.latencyMs));
            const failAt = config.failNext.findIndex(f => url.pathname.includes(f.match));
            if (failAt >= 0) {
                const f = config.failNext[failAt];
                if (--f.times <= 0) config.failNext.splice(failAt, 1);
                if (f.status === 'drop') return req.socket.destroy();
                return send(res, f.status, { code: 'injected', message: 'injected failure', msg: 'injected failure' });
            }
            if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url, body);
            if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url, body);
            send(res, 404, { message: 'not found' });
        } catch (e) { console.error('local-supabase error', e); send(res, 500, { message: String(e.message) }); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;

    const api = {
        url: base, anonKey, emails, config, log, pool,
        query: async (sql, params = []) => (await pool.query(sql, params)).rows,
        // Throw away every user and all data. Reference data (policy versions, catalogs) stays.
        async reset() {
            await pool.query('truncate auth.users cascade');
            refreshTokens.clear(); authCodes.clear(); pending.clear(); lastEmailAt.clear(); emails.length = 0; log.length = 0;
            config.emailRateLimitMs = 0; config.latencyMs = 0; config.failNext = []; config.passwordPolicy = true;
        },
        // Clicking the link in an email (what the browser would do). Returns the URL the app is sent to.
        async followEmailLink(email, type = 'signup') {
            const mail = [...emails].reverse().find(m => m.to.toLowerCase() === email.toLowerCase() && m.type === type);
            if (!mail) throw new Error(`no ${type} email for ${email}`);
            return mail.link;
        },
        confirmEmail: email => pool.query('update auth.users set email_confirmed_at = now() where lower(email) = lower($1)', [email]),
        // A user created directly, optionally with onboarding finished through the real functions.
        async createUser({ email, password = 'Passw0rd!', confirmed = true, onboard = false, name = 'Tester', accept = true, ttl } = {}) {
            const meta = accept ? { accepted_terms: '2026-11-13', accepted_privacy: '2026-11-13' } : {};
            const row = (await pool.query(`insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3, $4) returning *`,
                [email, hash(password), confirmed ? new Date() : null, JSON.stringify(meta)])).rows[0];
            if (onboard) {
                const claims = { sub: row.id, role: 'authenticated' };
                await asRole('authenticated', claims, async c => {
                    await c.query(`select public.save_character($1, 'avatar-user', '{}')`, [name]);
                    await c.query(`select public.save_goals('strength', '{}')`);
                    await c.query(`select public.save_preferences('beginner', 'home', '{pullup-bar}', 3, '20-30')`);
                    await c.query('select public.complete_onboarding()');
                });
            }
            return { id: row.id, email, password, session: confirmed ? issueSession(row, { ttl }) : null };
        },
        issueSession: async (userId, o) => issueSession(await getUserById(userId), o),
        failNext(match, status = 503, times = 1) { config.failNext.push({ match, status, times }); },
        async close() { await new Promise(r => server.close(r)); await pool.end(); }
    };
    return api;
}
