import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
import { deleteOwnAccount } from '../src/lib/admin-account-delete.ts';
import { transaction } from '../src/lib/community.ts';
import { bootstrapAdministrator } from '../src/lib/admin-bootstrap.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Synthetic development fixtures only');
if (!process.env.REPLIT_DEV_DOMAIN) throw new Error('Development URL is required');
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const marker = randomUUID().replaceAll('-', '');
const password = `Synthetic ${randomUUID()}`;
const ids = ['root', 'admin', 'reader', 'keep'].map(s => `af_privacy_${marker}_${s}`);
const [root, admin, reader, keep] = ids, book = randomUUID(), media = randomUUID();
const deletionReceipt = randomUUID(), rolledBackReceipt = randomUUID();
const emails = ids.map((_, i) => `privacy-${marker}-${i}@example.com`);
const nicknames = ['GizliYetkili', 'GizliYonetici', 'SilinecekOkur', 'KorunanOkur'];
let checks = 0;
async function api(path, token, status = 200, method = 'GET', data, extra = {}) {
  if (path === '/auth/account' && method === 'DELETE') data = { requestId: randomUUID(), ...data };
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await r.text(), value = text ? JSON.parse(text) : null;
  assert.equal(r.status, status, `${method} ${path}: ${text}`);
  checks++; return value;
}
const login = (i) => api('/auth/login', null, 200, 'POST', { email: emails[i], password });
try {
  const hash = await hashPassword(password);
  for (const [i, id] of ids.entries()) {
    await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, nicknames[i]]);
    await pool.query(`INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role,email_verified)
      VALUES($1,$2,$3,$4,true)`, [id, emails[i], hash, ['superadmin', 'admin', 'user', 'user'][i]]);
  }
  const sessions = await Promise.all(ids.map((_, i) => login(i)));
  const rootAgain = await login(0);
  assert.notEqual(sessions[0].token, rootAgain.token);
  for (const s of [sessions[0], rootAgain]) {
    assert.equal((await api('/auth/session', s.token)).user.role, 'superadmin');
    assert.equal((await api('/admin/overview', s.token)).role, 'superadmin');
  }
  // Browser-cookie session, independent of both native bearer tokens.
  const browser = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emails[0], password }),
  });
  assert.equal(browser.status, 200);
  const cookie = browser.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('afilli_session='));
  assert.equal((await api('/auth/session', null, 200, 'GET', undefined, { Cookie: cookie })).user.role, 'superadmin');
  // Restart/bootstrap never resets or recreates account roles.
  await bootstrapAdministrator();
  assert.equal((await api('/auth/session', rootAgain.token)).user.role, 'superadmin');
  await api('/admin/overview', sessions[2].token, 403, 'GET', undefined,
    { 'X-Admin-Email': emails[0], 'X-Admin-Role': 'superadmin' });
  await api('/my-profile/visibility', null, 401, 'PATCH', { visible: false });
  await api('/my-profile/visibility', sessions[2].token, 403, 'PATCH', { visible: false, role: 'superadmin', email: emails[0] });
  await api('/my-profile/visibility', sessions[0].token, 400, 'PATCH', { visible: 'false' });
  assert.equal((await api('/my-profile', sessions[2].token)).onlineVisible, null);
  assert.equal((await api('/my-profile/visibility', sessions[1].token, 200, 'PATCH', { visible: false })).onlineVisible, false);
  assert.equal((await api('/my-profile/visibility', sessions[0].token, 200, 'PATCH', { visible: false })).onlineVisible, false);
  await api('/presence', sessions[0].token, 204, 'POST', { active: true });
  assert.equal((await api('/my-profile', rootAgain.token)).onlineVisible, false);
  const rootNewLogin = await login(0);
  assert.equal((await api('/my-profile', rootNewLogin.token)).onlineVisible, false);
  const conversation = await api('/conversations', sessions[2].token, 200, 'POST', { peerId: root });
  await api(`/conversations/${conversation.id}/typing`, sessions[0].token, 204, 'PUT', { typing: true });
  const hidden = await api(`/profiles/${root}`, sessions[2].token);
  assert.equal(hidden.online, false); assert.equal(hidden.lastSeen, null); assert.equal(hidden.typing, false);
  assert.equal(hidden.onlineVisible, null);
  const thread = await api(`/conversations/${conversation.id}`, sessions[2].token);
  assert.equal(thread.peerOnline, false); assert.equal(thread.peerLastSeen, null); assert.equal(thread.peerTyping, false);
  await api('/my-profile/visibility', rootAgain.token, 200, 'PATCH', { visible: true });
  assert.equal((await api(`/profiles/${root}`, sessions[2].token)).online, true);
  // Only synthetic temp rows determine this case, regardless of real admin count.
  await assert.rejects(transaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('afilli-admin-governance'))");
    await db.query('CREATE TEMP TABLE afilli_auth_accounts (LIKE public.afilli_auth_accounts INCLUDING ALL) ON COMMIT DROP');
    await db.query('INSERT INTO pg_temp.afilli_auth_accounts SELECT * FROM public.afilli_auth_accounts WHERE user_id=$1', [root]);
    await deleteOwnAccount(db, root, nicknames[0]);
  }), e => e.status === 409 && /yetkisi devret/.test(e.message));
  await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,publication)
    VALUES($1::uuid,$2,$1::text,'Synthetic private test','Synthetic','published')`, [book, reader]);
  await pool.query("INSERT INTO writer_uploads(id,owner_id,content_type,size) VALUES($1,$2,'image/png',1)", [media, reader]);
  await pool.query("INSERT INTO afilli_auth_codes(id,user_id,code_hash,expires_at) VALUES($1,$2,'synthetic',now()+interval '1 hour')", [randomUUID(), reader]);
  const readerAgain = await login(2);
  await api('/auth/account/deletion', null, 401);
  const scope = await api('/auth/account/deletion', sessions[2].token);
  assert.equal(scope.nickname, nicknames[2]); assert.equal(scope.books, 1); assert.equal(scope.media, 1);
  await api('/auth/account', null, 401, 'DELETE', { password, confirmation: nicknames[2] });
  await api('/auth/account', sessions[2].token, 403, 'DELETE', { password: 'wrong', confirmation: nicknames[2] });
  await api('/auth/account', sessions[2].token, 409, 'DELETE', { password, confirmation: 'wrong nickname' });
  assert.equal((await api('/auth/session', sessions[2].token)).user.id, reader);
  // A late failure rolls back account, content, sessions and durable media queue.
  await assert.rejects(transaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('afilli-admin-governance'))");
    await deleteOwnAccount(db, reader, nicknames[2], rolledBackReceipt);
    throw new Error('Synthetic post-delete rollback');
  }), /Synthetic post-delete rollback/);
  assert.equal((await pool.query('SELECT 1 FROM authored_books WHERE id=$1', [book])).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM account_media_deletions WHERE media_id=$1', [media])).rowCount, 0);
  assert.equal((await api('/auth/session', readerAgain.token)).user.id, reader);
  assert.equal((await api('/auth/account/deletion-status', null, 200, 'POST', { requestId: rolledBackReceipt })).deleted, false);
  // Extra target fields cannot change which identity is deleted.
  assert.equal((await api('/auth/account/deletion-status', null, 200, 'POST', { requestId: deletionReceipt })).deleted, false);
  await api('/auth/account', sessions[2].token, 204, 'DELETE', { password, confirmation: nicknames[2], id: keep, requestId: deletionReceipt });
  assert.equal((await api('/auth/account/deletion-status', null, 200, 'POST', { requestId: deletionReceipt })).deleted, true);
  assert.equal((await api('/auth/account/deletion-status', null, 200, 'POST', { requestId: randomUUID() })).deleted, false);
  for (const token of [sessions[2].token, readerAgain.token]) {
    assert.equal((await api('/auth/session', token)).user, null);
    await api('/my-profile', token, 401);
  }
  await api('/auth/login', null, 401, 'POST', { email: emails[2], password });
  assert.equal((await pool.query('SELECT 1 FROM community_users WHERE id=$1', [keep])).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM authored_books WHERE id=$1', [book])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM afilli_auth_codes WHERE user_id=$1', [reader])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM account_media_deletions WHERE media_id=$1 AND eligible_at>now()', [media])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM admin_audit WHERE target_id=$1 AND action='account.self_delete'", [reader])).rowCount, 1);
  // A non-last administrator may also self-delete through the same endpoint.
  await api('/auth/account', sessions[1].token, 204, 'DELETE', { password, confirmation: nicknames[1] });
  assert.equal((await api('/auth/session', sessions[1].token)).user, null);
  console.log(`PASS ${checks} API checks: independent sessions/roles, hidden presence and typing, admin-only preference, reauthentication, rollback, self-deletion and media queue.`);
} finally {
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM conversations WHERE user_low=ANY($1::text[]) OR user_high=ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM account_media_deletions WHERE media_id=$1', [media]);
  await pool.query('DELETE FROM writer_uploads WHERE owner_id=ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM authored_books WHERE author_id=ANY($1::text[])', [ids]);
  for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts']) {
    await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [ids]);
  }
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
}
