import { pool } from '@workspace/db';
import { getSettings } from './social';

// Roles are imported with verified legacy identities. A matching email typed at
// signup must never turn an unverified new account into an administrator.
export async function bootstrapAdministrator() {
  await getSettings();
  // Keep existing grants as an audit record; never recreate or restore a role.
  await pool.query('SELECT 1 FROM afilli_auth_accounts LIMIT 1');
}
