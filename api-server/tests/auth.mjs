import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { hashPassword, verifyPassword } from '../src/lib/auth-crypto.ts';
import { assertAuthReleaseReady } from '../src/lib/auth-release.ts';
const require = createRequire(new URL('../../db/package.json', import.meta.url));
const { Pool } = require('pg'), pool = new Pool();
if (process.env.NODE_ENV === 'production') throw new Error('Development tests only');
const base = 'http://localhost:80/api';
const ids = [], books = [];
const email = `auth-check-${randomUUID()}@example.com`;
const password = 'Synthetic password 27';
let tests = 0;
const hash = value => createHash('sha256').update(value).digest('hex');
async function api(path, body, token, expected = 200, method = 'POST', extra = {}) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${path}: ${response.status} ${data?.error ?? ''}`);
  return { data, response };
}
try {
  const previousMode = process.env.NODE_ENV, previousVerification = process.env.AFILLI_AUTH_EMAIL_VERIFIED;
  try {
    process.env.NODE_ENV = 'production'; delete process.env.AFILLI_AUTH_EMAIL_VERIFIED;
    await assert.rejects(assertAuthReleaseReady, /verified password-email sender/); tests++;
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    if (previousVerification === undefined) delete process.env.AFILLI_AUTH_EMAIL_VERIFIED; else process.env.AFILLI_AUTH_EMAIL_VERIFIED = previousVerification;
  }
  const encoded = await hashPassword(password);
  assert.ok(await verifyPassword(password, encoded)); assert.equal(await verifyPassword('wrong', encoded), false);
  assert.equal(await verifyPassword(password, null), false); tests++;
  assert.equal((await api('/auth/session', undefined, null, 200, 'GET')).data.user, null); tests++;
  await api('/auth/register', { email, nickname: 'Okur', password, acceptedRules: false }, null, 400);
  await api('/auth/register', { email, nickname: 'AB', password, acceptedRules: true }, null, 400); tests++;
  const result = await api('/auth/register', { email, nickname: 'Denetim', password, acceptedRules: true }, null, 201);
  const { user, token } = result.data; ids.push(user.id);
  assert.ok(token); assert.match(result.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(result.response.headers.get('set-cookie'), /Secure/); tests++;
  const account = (await pool.query('SELECT password_hash,role FROM afilli_auth_accounts WHERE user_id=$1', [user.id])).rows[0];
  assert.ok(account.password_hash.startsWith('scrypt1$')); assert.notEqual(account.password_hash, password); assert.equal(account.role, 'user');
  const saved = (await pool.query('SELECT token_hash FROM afilli_auth_sessions WHERE user_id=$1', [user.id])).rows[0];
  assert.equal(saved.token_hash, hash(token)); assert.notEqual(saved.token_hash, token); tests++;
  await api('/auth/register', { email: email.toUpperCase(), nickname: 'Diğer', password, acceptedRules: true }, null, 409); tests++;
  await api('/auth/login', { email, password: 'not-the-password' }, null, 401);
  const signed = (await api('/auth/login', { email, password }, null)).data;
  assert.equal(signed.user.id, user.id);
  assert.equal((await api('/auth/session', undefined, token, 200, 'GET')).data.user.id, user.id); tests++;
  await api('/my-profile', undefined, token, 401, 'GET', { 'X-Afilli-Actor': 'different_account' });
  await api('/social-settings', { instagramUrl: 'https://www.instagram.com/afilli/' }, token, 403, 'PUT'); tests++;
  await api('/auth/logout', undefined, signed.token, 204);
  assert.equal((await api('/auth/session', undefined, signed.token, 200, 'GET')).data.user, null); tests++;
  await api('/auth/login', { email, password }, null, 403, 'POST', { Origin: 'https://hostile.example.invalid' }); tests++;
  const exhausted = randomUUID();
  await pool.query("INSERT INTO afilli_auth_codes(id,user_id,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')", [exhausted, user.id, hash(`${exhausted}:654321`)]);
  for (let n = 0; n < 5; n++) await api('/auth/reset-password', { challengeId: exhausted, code: '111111', password }, null, 400);
  await api('/auth/reset-password', { challengeId: exhausted, code: '654321', password }, null, 400);
  assert.equal((await pool.query('SELECT attempts FROM afilli_auth_codes WHERE id=$1', [exhausted])).rows[0].attempts, 5); tests++;
  const legacy = `user_authcheck_${randomUUID().replaceAll('-', '')}`, book = randomUUID();
  ids.push(legacy); books.push(book);
  await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [legacy, 'Eski Okur']);
  await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,email_verified,migrated) VALUES($1,$2,true,true)', [legacy, `legacy-${randomUUID()}@example.com`]);
  await pool.query("INSERT INTO authored_books(id,author_id,local_id,title,body) VALUES($1,$2,'retained','Korunan kitap','Silinmemeli')", [book, legacy]);
  const challenge = randomUUID();
  await pool.query("INSERT INTO afilli_auth_codes(id,user_id,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')", [challenge, legacy, hash(`${challenge}:654321`)]);
  const restored = (await api('/auth/reset-password', { challengeId: challenge, code: '654321', password }, null)).data;
  assert.equal(restored.user.id, legacy);
  assert.equal((await pool.query('SELECT author_id,body FROM authored_books WHERE id=$1', [book])).rows[0].author_id, legacy);
  await api('/auth/reset-password', { challengeId: challenge, code: '654321', password }, null, 400); tests++;
  const nextChallenge = randomUUID();
  await pool.query("INSERT INTO afilli_auth_codes(id,user_id,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')", [nextChallenge, legacy, hash(`${nextChallenge}:654321`)]);
  const newer = (await api('/auth/reset-password', { challengeId: nextChallenge, code: '654321', password }, null)).data;
  assert.equal((await api('/auth/session', undefined, restored.token, 200, 'GET')).data.user, null);
  assert.equal((await api('/auth/session', undefined, newer.token, 200, 'GET')).data.user.id, legacy); tests++;
  const expired = randomUUID();
  await pool.query("INSERT INTO afilli_auth_codes(id,user_id,code_hash,expires_at) VALUES($1,$2,$3,now()-interval '1 minute')", [expired, legacy, hash(`${expired}:654321`)]);
  await api('/auth/reset-password', { challengeId: expired, code: '654321', password }, null, 400); tests++;
  // No external email is sent by this suite.
  console.log(`${tests} authentication and ownership checks passed; no real emails were sent.`);
} finally {
  if (books.length) await pool.query('DELETE FROM authored_books WHERE id=ANY($1::uuid[])', [books]);
  if (ids.length) {
    for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts']) await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [ids]);
    await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [ids]);
  }
  await pool.end();
}
