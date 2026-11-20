import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw Error('Development fixtures only');
const [action='seed', supplied] = process.argv.slice(2);
const tag = supplied ?? randomUUID().replaceAll('-','').slice(0,12);
if (!/^[a-f0-9]{12}$/.test(tag)) throw Error('Invalid fixture tag');
const ids = ['a','b','c'].map(x=>'af_dm_ui_'+tag+'_'+x);
try {
  if (action === 'clean') {
    // Exact fixture owners only; no broad cleanup of real accounts.
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM conversations WHERE user_low=ANY($1::text[]) OR user_high=ANY($1::text[])',[ids]);
      await client.query('DELETE FROM afilli_auth_sessions WHERE user_id=ANY($1::text[])',[ids]);
      await client.query('DELETE FROM afilli_auth_accounts WHERE user_id=ANY($1::text[])',[ids]);
      await client.query('DELETE FROM community_users WHERE id=ANY($1::text[])',[ids]);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK');throw e; }
    finally { client.release(); }
    console.log('Removed synthetic direct-message fixture '+tag);
  } else if (action === 'seed') {
    const password = 'Synthetic DM check '+tag+'!';
    const hash = await hashPassword(password);
    for (const [i,id] of ids.entries()) {
      await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)',[id,'MesajTest'+i+'-'+tag]);
      await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)',[id,'dm-ui-'+tag+'-'+i+'@example.com',hash]);
    }
    const thread=(await pool.query('INSERT INTO conversations(user_low,user_high) VALUES(least($1::text,$2::text),greatest($1::text,$2::text)) RETURNING id',[ids[0],ids[1]])).rows[0].id;
    console.log(JSON.stringify({tag,ids,thread,emails:ids.map((_,i)=>'dm-ui-'+tag+'-'+i+'@example.com'),password}));
  } else throw Error('Unknown action');
} finally { await pool.end(); }
