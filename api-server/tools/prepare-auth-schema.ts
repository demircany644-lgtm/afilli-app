import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';

// Local development only. Production schema changes are a separately approved
// release action; this helper must not select a remote production database.
if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1') {
  throw new Error('Use the reviewed production migration process; this helper is development-only');
}
try {
  await pool.query(await readFile(new URL('./auth-schema.sql', import.meta.url), 'utf8'));
  const result = await pool.query(`SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`,
    [['afilli_auth_accounts', 'afilli_auth_sessions', 'afilli_auth_codes', 'afilli_auth_limits', 'afilli_auth_migration']]);
  if (result.rows[0]?.count !== 5) throw new Error('Authentication schema verification failed');
  console.log('Five additive authentication tables verified; existing content was not deleted.');
} finally { await pool.end(); }
