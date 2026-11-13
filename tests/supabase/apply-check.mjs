import { freshDatabase, applyMigrations } from './db.mjs';
const db = await freshDatabase('cala_check');
try { await applyMigrations(db); console.log('migrations applied'); } catch (e) { console.log('FAIL', e.message, e.where || '', e.position || ''); }
await db.end();
