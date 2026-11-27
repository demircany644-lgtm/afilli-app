import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
import { libraryGifObject } from '../src/lib/gif-library.ts';
if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw Error('Synthetic development fixture only');
const file = new URL('../../generated-artifacts/gif-ui-fixture.json', import.meta.url);
try {
  if (process.argv.includes('--clean')) {
    const f = JSON.parse(await readFile(file, 'utf8')), ids = f.users.map(u => u.id);
    if (ids.some(id => !/^af_gif_ui_[a-f0-9]+_[01]$/.test(id))) throw Error('Unexpected fixture owner');
    const gifs = (await pool.query('SELECT id FROM gif_library WHERE owner_id=ANY($1::text[])', [ids])).rows;
    for (const { id } of gifs) for (const kind of ['source', 'asset']) await libraryGifObject(id, kind).delete({ ignoreNotFound: true });
    await pool.query('DELETE FROM gif_library WHERE owner_id=ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM conversations WHERE user_low=ANY($1::text[]) OR user_high=ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM afilli_auth_sessions WHERE user_id=ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM afilli_auth_accounts WHERE user_id=ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [ids]);
    await unlink(file);
    for (const name of ['gif-ui-one.gif', 'gif-ui-two.gif']) await unlink(new URL('../../generated-artifacts/' + name, import.meta.url)).catch(() => {});
    process.stdout.write('Synthetic GIF UI fixture removed\n');
  } else {
    await mkdir(new URL('../../generated-artifacts/', import.meta.url), { recursive: true });
    const tag = randomUUID().replaceAll('-', ''), password = 'Synthetic ' + randomUUID(), hash = await hashPassword(password);
    const users = ['superadmin', 'user'].map((role, i) => ({ id: `af_gif_ui_${tag}_${i}`, role, email: `gif-ui-${tag}-${i}@example.com`, nickname: `GifTest${i}-${tag.slice(0, 4)}` }));
    for (const u of users) {
      await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [u.id, u.nickname]);
      await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role) VALUES($1,$2,$3,$4)', [u.id, u.email, hash, u.role]);
    }
    const row = (await pool.query(`INSERT INTO conversations(user_low,user_high) VALUES(least($1::text,$2::text),greatest($1::text,$2::text)) RETURNING id`, [users[0].id, users[1].id])).rows[0];
    const animated = Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
    for (const name of ['gif-ui-one.gif', 'gif-ui-two.gif']) await writeFile(new URL('../../generated-artifacts/' + name, import.meta.url), animated);
    await writeFile(file, JSON.stringify({ users, password, threadId: row.id }));
    process.stdout.write('Synthetic GIF UI fixture ready in generated-artifacts/gif-ui-fixture.json\n');
  }
} finally { await pool.end(); }
