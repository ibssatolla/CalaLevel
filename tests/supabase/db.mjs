// Helpers for tests against a local Postgres. Starts from an empty database each time.
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = path.join(here, '..', '..', 'supabase', 'migrations');
const cfg = { host: process.env.PGHOST || '/tmp', port: Number(process.env.PGPORT || 54329), user: process.env.PGUSER || 'postgres' };

export async function freshDatabase(name) {
    const admin = new pg.Client({ ...cfg, database: 'postgres' });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    await admin.end();
    const db = new pg.Client({ ...cfg, database: name });
    await db.connect();
    await db.query(readFileSync(path.join(here, 'stub-auth.sql'), 'utf8'));
    return db;
}

export function migrationFiles() {
    return readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
}

export async function applyMigrations(db) {
    for (const f of migrationFiles()) await db.query(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
}

export async function connect(name) {
    const db = new pg.Client({ ...cfg, database: name });
    await db.connect();
    return db;
}

// Runs fn inside a transaction as a given API role and user, the way PostgREST does. Always rolled back unless keep is true.
export async function asUser(db, uid, fn, { role = 'authenticated', keep = false } = {}) {
    await db.query('begin');
    try {
        await db.query(`set local role ${role}`);
        await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role } : { role })]);
        const out = await fn(db);
        await db.query(keep ? 'commit' : 'rollback');
        return out;
    } catch (e) {
        await db.query('rollback');
        throw e;
    }
}
