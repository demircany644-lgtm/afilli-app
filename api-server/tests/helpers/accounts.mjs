// Compatibility fixture for older API suites. All identities and sessions are
// now local to the development database; no external auth provider is called.
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../db/package.json', import.meta.url));
const { Pool } = require('pg');
const created = new Set(), sessions = new Map();
async function db(fn) {
  if (process.env.NODE_ENV === 'production') throw new Error('Test fixtures are development-only');
  const pool = new Pool();
  try { return await fn(pool); } finally { await pool.end(); }
}
export const accounts = {
  users: {
    async createUser({ emailAddress, firstName }) {
      if (!emailAddress?.[0]?.endsWith('@example.com')) throw new Error('Use a synthetic fixture address');
      const id = `af_test_${randomUUID().replaceAll('-', '')}`;
      await db(async pool => {
        await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, firstName || 'Test']);
        await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,email_verified) VALUES($1,$2,true)', [id, emailAddress[0]]);
      });
      created.add(id); return { id };
    },
    async updateUserMetadata(id, { publicMetadata }) {
      if (!created.has(id)) throw new Error('Not a fixture identity');
      await db(pool => pool.query('UPDATE afilli_auth_accounts SET role=$2 WHERE user_id=$1', [id, publicMetadata.role === 'admin' ? 'admin' : 'user']));
    },
    async deleteUser(id) {
      if (!created.has(id)) return;
      await db(async pool => {
        for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts']) {
          await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [id]);
        }
      });
    },
  },
  sessions: {
    async createSession({ userId }) {
      if (!created.has(userId)) throw new Error('Not a fixture identity');
      const token = randomBytes(32).toString('base64url');
      await db(pool => pool.query(`INSERT INTO afilli_auth_sessions(token_hash,user_id,expires_at)
        VALUES($1,$2,now()+interval '1 hour')`, [createHash('sha256').update(token).digest('hex'), userId]));
      sessions.set(token, true); return { id: token };
    },
    async getToken(id) {
      if (!sessions.has(id)) throw new Error('Not a fixture session');
      return { jwt: id };
    },
  },
};
