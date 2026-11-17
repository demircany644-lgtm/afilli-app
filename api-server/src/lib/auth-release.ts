import { pool } from '@workspace/db';
import { authMailReady, verifyAuthMailSender } from './auth-mail';

export async function assertAuthReleaseReady() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!authMailReady()) throw new Error('Authentication release blocked: configure a verified password-email sender before replacing the existing service');
  await verifyAuthMailSender();
  const state = await pool.query("SELECT 1 FROM afilli_auth_migration WHERE id='legacy' AND complete=true");
  const users = await pool.query('SELECT 1 FROM community_users LIMIT 1');
  const unmapped = await pool.query(`SELECT 1 FROM community_users u LEFT JOIN afilli_auth_accounts a ON a.user_id=u.id
    WHERE a.user_id IS NULL LIMIT 1`);
  if ((users.rowCount && !state.rowCount) || unmapped.rowCount) {
    throw new Error('Authentication release blocked: existing account identities must be safely migrated before cutover');
  }
}
