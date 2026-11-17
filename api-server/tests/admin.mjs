import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Development tests only');
const base = 'http://localhost:80/api', marker = randomUUID().replaceAll('-', '');
const password = `Synthetic test ${randomUUID()}`;
const users = [], book = randomUUID(), draft = randomUUID(), post = randomUUID(), comment = randomUUID(), reply = randomUUID(), upload = randomUUID();
let checks = 0;
let previousInstagram;
async function api(path, token, body, expected = 200, method = body === undefined ? 'GET' : 'PATCH', extra = {}) {
  const r = await fetch(base + path, { method,
    headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(r.status, expected, `${method} ${path}: ${r.status} ${data?.error ?? ''}`);
  checks++;
  return data;
}
async function seed(role, n) {
  const id = `af_admincheck_${marker}_${n}`, email = `admin-${marker}-${n}@example.com`;
  users.push(id);
  await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `Denetim${n}`]);
  await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role) VALUES($1,$2,$3,$4)', [id, email, await hashPassword(password), role]);
  const login = await api('/auth/login', null, { email, password }, 200, 'POST');
  return { id, email, token: login.token };
}
try {
  previousInstagram = (await pool.query('SELECT instagram_handle FROM social_settings WHERE id=true')).rows[0]?.instagram_handle;
  const owner = await seed('superadmin', 0), other = await seed('superadmin', 1), admin = await seed('admin', 2), reader = await seed('user', 3);
  await api('/admin/overview', null, undefined, 401);
  await api('/admin/overview', reader.token, undefined, 403);
  assert.equal((await api('/admin/overview', admin.token)).role, 'admin');
  await api('/admin/accounts', admin.token, undefined, 403);
  await api(`/admin/accounts/${reader.id}`, admin.token, { role: 'admin', reason: 'Yetki testi' }, 403);
  await api('/admin/history', reader.token, undefined, 403);
  await api('/admin/content?kind=book', reader.token, undefined, 403);
  await api('/admin/overview', owner.token, undefined, 401, 'GET', { 'X-Afilli-Actor': reader.id });
  const accounts = await api(`/admin/accounts?q=${marker}`, owner.token);
  assert.equal(accounts.items.length, 4);
  assert.equal(accounts.total, 4);
  assert.equal(accounts.nextOffset, null);
  assert.equal(JSON.stringify(accounts).includes('password'), false);
  await api('/admin/accounts?offset=-1', owner.token, undefined, 400);
  await api('/admin/accounts?q=' + 'a'.repeat(101), owner.token, undefined, 400);
  await api('/admin/content?kind=not_a_table', owner.token, undefined, 400);
  const before = (await api('/admin/history', owner.token)).total;
  await api(`/admin/accounts/${owner.id}`, owner.token, { role: 'user', reason: 'Kendi yetkisi' }, 409);
  await api(`/admin/accounts/${owner.id}`, owner.token, { disabled: true, reason: 'Kendini kapat' }, 409);
  await api(`/admin/accounts/${reader.id}`, owner.token, { role: 'root', reason: 'Geçersiz rol' }, 400);
  await api(`/admin/accounts/${reader.id}`, owner.token, { disabled: true, reason: '   ' }, 400);
  assert.equal((await api('/admin/history', owner.token)).total, before);
  await api(`/admin/accounts/${reader.id}`, owner.token, { nickname: 'YeniDenetim', reason: 'Takma ad denetimi' });
  assert.equal((await api(`/admin/accounts?q=${marker}`, owner.token)).items.find(u => u.id === reader.id).nickname, 'YeniDenetim');
  await api(`/admin/accounts/${reader.id}`, owner.token, { disabled: true, reason: 'Hesap askıya alma testi' });
  assert.equal((await api('/auth/session', reader.token)).user, null);
  await api('/auth/login', null, { email: reader.email, password }, 401, 'POST');
  await api(`/admin/accounts/${reader.id}`, owner.token, { role: 'admin', reason: 'Engelli hesabı yükseltme' }, 409);
  await api(`/admin/accounts/${reader.id}`, owner.token, { disabled: false, reason: 'Hesabı geri açma testi' });
  reader.token = (await api('/auth/login', null, { email: reader.email, password }, 200, 'POST')).token;
  await api(`/admin/accounts/${reader.id}`, owner.token, { role: 'admin', reason: 'Yetki verme testi' });
  assert.equal((await api('/auth/session', reader.token)).user, null);
  reader.token = (await api('/auth/login', null, { email: reader.email, password }, 200, 'POST')).token;
  assert.equal((await api('/admin/overview', reader.token)).role, 'admin');
  await api(`/admin/accounts/${reader.id}`, owner.token, { role: 'user', reason: 'Yetki geri alma testi' });
  await api('/admin/overview', reader.token, undefined, 401);

  const races = await Promise.all([
    fetch(base + `/admin/accounts/${other.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ role: 'user', reason: 'Eşzamanlı yetki testi' }) }),
    fetch(base + `/admin/accounts/${owner.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other.token}` }, body: JSON.stringify({ role: 'user', reason: 'Eşzamanlı yetki testi' }) }),
  ]);
  assert.deepEqual(races.map(r => r.status).sort(), [200, 403]); checks++;
  // Continue using whichever synthetic administrator survived the race.
  const surviving = (await pool.query("SELECT user_id FROM afilli_auth_accounts WHERE user_id=ANY($1::text[]) AND role='superadmin'", [[owner.id, other.id]])).rows[0].user_id;
  const root = surviving === owner.id ? owner : other;
  for (const [id, publication] of [[book, 'published'], [draft, 'draft']]) {
    await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,publication,created_at)
      VALUES($1,$2,$3,$4,$5,$6,now())`, [id, reader.id, id, `Test kitap ${marker}`, 'Private manuscript sentinel', publication]);
  }
  await pool.query('INSERT INTO bulletins(id,author_id,client_id,body) VALUES($1,$2,$3,$4)', [post, reader.id, randomUUID(), `Test bülten ${marker}`]);
  await pool.query('INSERT INTO writer_comments(id,book_id,author_id,client_id,body) VALUES($1,$2,$3,$4,$5)', [comment, book, reader.id, randomUUID(), `Test kitap yorumu ${marker}`]);
  await pool.query('INSERT INTO bulletin_comments(id,post_id,author_id,body) VALUES($1,$2,$3,$4)', [reply, post, reader.id, `Test bülten yorumu ${marker}`]);
  await pool.query('INSERT INTO bulletin_uploads(id,owner_id,post_id,object_path,content_type,size) VALUES($1,$2,$3,$4,$5,1)', [upload, reader.id, post, `synthetic/${marker}`, 'image/png']);
  assert.equal(JSON.stringify(await api('/admin/content?kind=book&q=' + marker, root.token)).includes('Private manuscript sentinel'), false);
  await api(`/authored-books/${book}`, null);
  await api(`/authored-books/${draft}`, null, undefined, 404);
  await api(`/admin/content/book/${book}`, admin.token, { hidden: true, reason: 'Kitap gizleme denetimi' });
  await api(`/authored-books/${book}`, null, undefined, 404);
  assert.equal((await pool.query('SELECT body,publication FROM authored_books WHERE id=$1', [book])).rows[0].body, 'Private manuscript sentinel');
  await api(`/admin/content/book/${book}`, root.token, { hidden: false, reason: 'Kitabı geri açma denetimi' });
  await api(`/authored-books/${book}`, null);
  await api(`/admin/content/book/${draft}`, root.token, { hidden: false, reason: 'Taslak gizliliği denetimi' });
  await api(`/authored-books/${draft}`, null, undefined, 404);
  assert.equal((await api(`/authored-books/${book}`, null)).commentCount, 1);
  await api(`/admin/content/writer_comment/${comment}`, admin.token, { hidden: true, reason: 'Yorum gizleme denetimi' });
  assert.equal((await api(`/authored-books/${book}/comments`, null)).length, 0);
  assert.equal((await api(`/authored-books/${book}`, null)).commentCount, 0);
  await api(`/admin/content/writer_comment/${comment}`, root.token, { hidden: false, reason: 'Yorumu geri açma denetimi' });
  assert.equal((await api(`/authored-books/${book}/comments`, null)).length, 1);
  await api(`/admin/content/bulletin_comment/${reply}`, root.token, { hidden: true, reason: 'Bülten yorumunu gizle' });
  const replies = await api(`/bulletins/${post}/comments`, null);
  const hiddenReply = (Array.isArray(replies) ? replies : replies.items).find(c => c.id === reply);
  assert.equal(hiddenReply.deleted, true); assert.equal(hiddenReply.body, '');
  await api(`/admin/content/bulletin_comment/${reply}`, root.token, { hidden: false, reason: 'Bülten yorumunu geri aç' });
  await api(`/admin/content/bulletin/${post}`, admin.token, { hidden: true, reason: 'Bülteni gizleme denetimi' });
  await api(`/bulletins/${post}`, null, undefined, 404);
  await api(`/bulletin-media/${upload}`, null, undefined, 404);
  await api(`/admin/content/bulletin/${post}`, root.token, { hidden: false, reason: 'Bülteni geri açma denetimi' });
  await api(`/bulletins/${post}`, null);
  const settings = await api('/social-settings', null);
  assert.equal(Object.hasOwn(settings, 'facebookUrl'), false);
  assert.equal(Object.hasOwn(settings, 'xUrl'), false);
  const publicProfile = await api(`/profiles/${reader.id}`, null);
  assert.equal(Object.hasOwn(publicProfile, 'instagram'), false);
  assert.equal(Object.hasOwn(publicProfile, 'facebookUrl'), false);
  assert.equal(Object.hasOwn(publicProfile, 'xUrl'), false);
  await api('/admin/settings', reader.token, { instagramUrl: 'https://www.instagram.com/afilli/' }, 401, 'PUT');
  await api('/admin/settings', root.token, { instagramUrl: 'https://evil.example/afilli/' }, 400, 'PUT');
  await api('/admin/settings', root.token, { instagramUrl: 'https://www.instagram.com/afilli/' }, 200, 'PUT');
  assert.equal((await api('/social-settings', null)).instagramUrl, 'https://www.instagram.com/afilli/');
  await api('/social-settings', root.token, { instagramUrl: null }, 200, 'PUT');
  assert.equal((await api('/social-settings', null)).instagramUrl, null);
  await api('/admin/settings', root.token, { instagramUrl: settings.instagramUrl }, 200, 'PUT');
  const history = await api('/admin/history', root.token);
  assert.ok(history.items.some(h => h.action === 'settings.update'));
  assert.ok(history.items.some(h => h.action === 'content.hide'));
  assert.equal(JSON.stringify(history).includes('password_hash'), false);
  console.log(`PASS ${checks} administrative API requests plus assertions: permissions, self-protection, concurrent demotion, session invalidation, privacy, reversible book/post/comment moderation, public reader and media gates, settings and audit. Synthetic development fixtures only.`);
} finally {
  if (previousInstagram !== undefined) {
    await pool.query('UPDATE social_settings SET instagram_handle=$1 WHERE id=true', [previousInstagram]);
  }
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM bulletin_uploads WHERE id=$1', [upload]);
  await pool.query('DELETE FROM bulletin_comments WHERE post_id=$1', [post]);
  await pool.query('DELETE FROM bulletins WHERE id=$1', [post]);
  await pool.query('DELETE FROM authored_books WHERE id=ANY($1::uuid[])', [[book, draft]]);
  for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts']) {
    await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [users]);
  }
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [users]);
  await pool.end();
}
