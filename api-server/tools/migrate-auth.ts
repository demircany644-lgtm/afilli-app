/**
 * One-time legacy identity reader, NOT an application dependency.
 * Never prints credentials, email addresses, passwords or exported identities.
 * Default: dry-run. No legacy provider mutations and no content ID rewrites.
 */
import { pool } from '@workspace/db';
import { authMailReady } from '../src/lib/auth-mail';

type LegacyUser = {
  id: string; username?: string; first_name?: string; image_url?: string;
  primary_email_address_id?: string; banned?: boolean; locked?: boolean; two_factor_enabled?: boolean;
  email_addresses?: { id: string; email_address: string; verification?: { status: string } }[];
  public_metadata?: { role?: string };
};
const apply = process.argv.includes('--apply');
const environment = process.argv.find(v => v.startsWith('--environment='))?.split('=')[1];
async function main() {
  if (!['development', 'production'].includes(environment ?? '')) throw new Error('Explicit environment is required');
  const key = process.env.CLERK_SECRET_KEY;
  const expected = environment === 'production' ? 'sk_live_' : 'sk_test_';
  if (!key?.startsWith(expected)) throw new Error('Legacy provider environment does not match the requested environment');
  if (apply && environment === 'production'
    && (process.env.AFILLI_AUTH_MIGRATION_APPROVED !== 'true' || !authMailReady())) {
    throw new Error('Production migration requires explicit approval and a configured verified email sender');
  }
  const users: LegacyUser[] = [];
  for (let offset = 0; offset < 100000; offset += 100) {
    const response = await fetch(`https://api.clerk.com/v1/users?limit=100&offset=${offset}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('Legacy identity lookup failed; no migration was applied');
    const batch: unknown = await response.json();
    if (!Array.isArray(batch)) throw new Error('Unexpected legacy identity response');
    users.push(...batch as LegacyUser[]);
    if (batch.length < 100) break;
    if (offset === 99900) throw new Error('Identity page limit reached; refusing incomplete import');
  }
  const entries = users.map(user => {
    const primary = user.email_addresses?.find(email => email.id === user.primary_email_address_id);
    const email = primary?.verification?.status === 'verified' ? primary.email_address.trim().toLowerCase() : null;
    if (!/^user_[A-Za-z0-9_-]+$/.test(user.id)) throw new Error('Invalid legacy identity');
    return { user, email };
  });
  const emails = entries.flatMap(x => x.email ? [x.email] : []);
  if (new Set(emails).size !== emails.length) throw new Error('Ambiguous legacy email ownership; manual review is required');
  const current = await pool.query<{ id: string }>('SELECT id FROM community_users');
  const ids = new Set(entries.filter(x => x.email).map(x => x.user.id));
  const missing = current.rows.filter(row => row.id.startsWith('user_') && !ids.has(row.id)).length;
  const blocked = entries.filter(x => !x.email || x.user.two_factor_enabled || x.user.banned || x.user.locked).length;
  console.log(JSON.stringify({ environment, mode: apply ? 'apply' : 'dry-run', legacyAccounts: entries.length, unmappedContentOwners: missing, accountsRequiringReview: blocked }));
  if (!apply) return;
  if (missing || blocked) throw new Error('Unverified, protected or unmatched accounts require review; no migration was applied');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('afilli-auth-migration'))");
    for (const { user, email } of entries) {
      if (!email) throw new Error('Missing verified primary email');
      await client.query(`INSERT INTO community_users(id,nickname,avatar) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`,
        [user.id, (user.username || user.first_name || 'Okur').slice(0, 40), user.image_url || null]);
      const existing = await client.query<{ user_id: string; email: string }>(
        'SELECT user_id,email FROM afilli_auth_accounts WHERE user_id=$1 OR email=$2 FOR UPDATE', [user.id, email]);
      if (existing.rows.length && (existing.rows.length !== 1 || existing.rows[0].user_id !== user.id || existing.rows[0].email !== email)) {
        throw new Error('Identity conflict; no accounts were reassigned');
      }
      await client.query(`INSERT INTO afilli_auth_accounts(user_id,email,email_verified,role,migrated)
        VALUES($1,$2,true,$3,true) ON CONFLICT(user_id) DO NOTHING`,
        [user.id, email, user.public_metadata?.role === 'admin' ? 'admin' : 'user']);
    }
    const unmapped = await client.query(`SELECT 1 FROM community_users u LEFT JOIN afilli_auth_accounts a ON a.user_id=u.id
      WHERE a.user_id IS NULL LIMIT 1`);
    if (unmapped.rowCount) throw new Error('Some content owners remain unmapped; no migration was applied');
    await client.query("INSERT INTO afilli_auth_migration(id,complete) VALUES('legacy',true) ON CONFLICT(id) DO UPDATE SET complete=true");
    await client.query('COMMIT');
    console.log('Verified identities imported. Existing IDs, content, passwords already set, and existing local roles were preserved.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; }
finally { await pool.end(); }
