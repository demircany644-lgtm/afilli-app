import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
if (process.env.NODE_ENV === 'production') throw new Error('Development fixture only');
const suffix = process.argv[3];
if (!/^[a-f0-9]{12}$/.test(suffix ?? '')) throw new Error('Supply a 12-character synthetic fixture id');
const ids = [`af_adminui_${suffix}_root`, `af_adminui_${suffix}_reader`];
try {
  if (process.argv[2] === 'create') {
    const hash = await hashPassword('Synthetic admin UI test 2026!');
    for (const [n, id] of ids.entries()) {
      await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, n === 0 ? 'PanelDenetim' : 'OkurDenetim']);
      await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role) VALUES($1,$2,$3,$4)',
        [id, `${n === 0 ? 'admin' : 'reader'}-${suffix}@example.com`, hash, n === 0 ? 'superadmin' : 'user']);
    }
    const bookId = randomUUID();
    await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,publication,created_at)
      VALUES($1,$2,$3,'Panel Denetim Kitabı','Synthetic published body','published',now())`, [bookId, ids[1], bookId]);
    console.log(JSON.stringify({ rootId: ids[0], readerId: ids[1], rootEmail: `admin-${suffix}@example.com`, readerEmail: `reader-${suffix}@example.com`, bookId }));
  } else if (process.argv[2] === 'cleanup') {
    await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM authored_books WHERE author_id=ANY($1::text[])', [ids]);
    for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts']) {
      await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [ids]);
    }
    await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [ids]);
    console.log('Synthetic admin UI fixtures removed.');
  } else throw new Error('Use create or cleanup');
} finally { await pool.end(); }
