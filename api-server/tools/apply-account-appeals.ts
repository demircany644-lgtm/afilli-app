import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';

if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1' || !process.env.REPLIT_DEV_DOMAIN) {
  throw new Error('Development schema setup only; production requires the reviewed additive migration.');
}

const client = await pool.connect();
try {
  await client.query(await readFile(new URL('./account-appeals.sql', import.meta.url), 'utf8'));
  const result = await client.query(`SELECT
    to_regclass('account_appeals') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='afilli_auth_sessions' AND column_name='access_mode')
    AND to_regclass('account_appeals_one_pending_per_user') IS NOT NULL AS ok`);
  if (!result.rows[0]?.ok) throw new Error('Additive account appeal schema verification failed.');
  console.log('Development account-appeal schema verified; existing accounts, sessions, and content were retained.');
} finally {
  client.release();
  await pool.end();
}
