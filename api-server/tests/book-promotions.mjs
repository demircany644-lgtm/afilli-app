import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';

if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Development fixtures only');
const base = 'http://localhost:80/api', marker = randomUUID().replaceAll('-', '');
const password = `Promo test ${randomUUID()}`, bookId = randomUUID(), chapterId = randomUUID();
const users = [`promo_${marker}_author`, `promo_${marker}_other`, `promo_${marker}_admin`];
const emails = users.map((_, i) => `promo-${marker}-${i}@example.com`);
const [authorId, otherId, adminId] = users;
const document = {
  title: `Promotion ${marker}`, description: 'Synthetic promotion fixture', cover: 'preset:paper',
  genres: ['Roman'], ageRating: 'all', completion: 'ongoing', language: 'Türkçe',
  chapters: [{ id: chapterId, title: 'İlk bölüm', html: '<p>Yayımlanmış örnek bölüm.</p>', status: 'published' }],
};
let checks = 0;
async function api(path, token = null, method = 'GET', data, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  let parsed = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  assert.equal(response.status, expected, `${method} ${path}: ${typeof parsed === 'string' ? parsed : parsed?.error ?? ''}`);
  checks++;
  return parsed;
}
const requestInput = (durationDays, clientRequestId = randomUUID()) => ({ durationDays, clientRequestId });
let originalSettings;
const promotionIds = [];

try {
  originalSettings = (await pool.query('SELECT enabled,allowed_durations,updated_by,updated_at FROM book_promotion_settings WHERE id=true')).rows[0];
  if (!originalSettings) throw new Error('Run the development book-promotions migration first.');
  const hash = await hashPassword(password);
  for (let i = 0; i < users.length; i++) {
    await pool.query('INSERT INTO community_users(id,nickname,avatar) VALUES($1,$2,NULL)', [users[i], `PromoYazar${i}-${marker}`]);
    await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role) VALUES($1,$2,$3,$4)',
      [users[i], emails[i], hash, i === 2 ? 'admin' : 'user']);
  }
  await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,writer_data,published_data,publication,published_at,writer_revision)
    VALUES($1::uuid,$2,$3::text,$4,'',$5,$5,'published',now(),1)`, [bookId, authorId, bookId, document.title, document]);
  const sessions = await Promise.all(emails.map(email => api('/auth/login', null, 'POST', { email, password })));
  const [author, other, admin] = sessions.map(s => s.token);

  await api('/admin/book-promotion-settings', other, 'GET', undefined, 403);
  const adminSettings = await api('/admin/book-promotion-settings', admin);
  assert.deepEqual(adminSettings.allowedDurations, [3, 7, 15, 30]);
  await api('/authored-books/not-a-uuid/promotion', author, 'GET', undefined, 400);
  await api(`/authored-books/${bookId}/promotion`, null, 'GET', undefined, 401);
  await api(`/authored-books/${bookId}/promotion`, other, 'GET', undefined, 404);
  assert.equal((await api(`/authored-books/${bookId}/promotion`, author)).latestRequest, null);
  await api(`/authored-books/${bookId}/promotion-requests`, author, 'POST', requestInput(5), 400);
  await api(`/authored-books/${bookId}/promotion-requests`, other, 'POST', requestInput(7), 404);

  const limitedSettings = await api('/admin/book-promotion-settings', admin, 'PUT', { enabled: true, allowedDurations: [3, 7] });
  assert.deepEqual(limitedSettings.allowedDurations, [3, 7]);
  await api(`/authored-books/${bookId}/promotion-requests`, author, 'POST', requestInput(15), 400);
  await api('/admin/book-promotion-settings', admin, 'PUT', { enabled: false, allowedDurations: [3, 7, 15, 30] });
  await api(`/authored-books/${bookId}/promotion-requests`, author, 'POST', requestInput(7), 409);
  assert.equal((await api(`/authored-books/${bookId}/promotion`, author)).enabled, false);
  await api('/admin/book-promotion-settings', admin, 'PUT', { enabled: true, allowedDurations: [3, 7, 15, 30] });

  const clientRequestId = randomUUID();
  const pending = await api(`/authored-books/${bookId}/promotion-requests`, author, 'POST', requestInput(7, clientRequestId), 201);
  promotionIds.push(pending.id);
  assert.equal(pending.status, 'pending'); assert.equal(pending.decision, null); assert.equal(pending.durationDays, 7);
  assert.equal((await api(`/authored-books/${bookId}/promotion-requests`, author, 'POST', requestInput(7, clientRequestId), 201)).id, pending.id);
  await api(`/authored-books/${bookId}/promotion-requests`, author, 'POST', requestInput(3), 409);
  assert.equal((await api('/discovery/promoted-books')).length, 0);
  const pendingPage = await api('/admin/book-promotion-requests?status=pending', admin);
  assert.ok(pendingPage.items.some(row => row.id === pending.id));
  await api('/admin/book-promotion-requests?status=pending', other, 'GET', undefined, 403);
  await api('/admin/book-promotion-requests/not-a-uuid/decision', admin, 'POST', { decision: 'approve_free' }, 400);

  const approved = await api(`/admin/book-promotion-requests/${pending.id}/decision`, admin, 'POST',
    { decision: 'approve_free', reason: 'Ücretsiz onay.' });
  assert.equal(approved.status, 'active'); assert.equal(approved.decision, 'free');
  assert.ok(approved.startsAt && approved.expiresAt);
  assert.ok(new Date(approved.expiresAt).getTime() - new Date(approved.startsAt).getTime() > 6 * 86_400_000);
  const feed = await api('/discovery/promoted-books');
  assert.equal(feed.length, 1); assert.equal(feed[0].id, bookId); assert.equal(feed[0].title, document.title);
  assert.equal((await api(`/authored-books/${bookId}/promotion`, author)).latestRequest.status, 'active');
  await api(`/admin/book-promotion-requests/${pending.id}/decision`, admin, 'POST', { decision: 'reject' }, 409);

  await pool.query('UPDATE book_promotion_requests SET expires_at=clock_timestamp()-interval \'1 second\' WHERE id=$1', [pending.id]);
  assert.equal((await api('/discovery/promoted-books')).length, 0);
  assert.equal((await api(`/authored-books/${bookId}/promotion`, author)).latestRequest.status, 'expired');

  const rejected = await api(`/authored-books/${bookId}/promotion-requests`, author, 'POST', requestInput(3), 201);
  promotionIds.push(rejected.id);
  const rejectedResult = await api(`/admin/book-promotion-requests/${rejected.id}/decision`, admin, 'POST',
    { decision: 'reject', reason: 'İçerik incelemesi.' });
  assert.equal(rejectedResult.status, 'rejected'); assert.equal(rejectedResult.decision, 'reject');
  const finalRequest = await api(`/authored-books/${bookId}/promotion-requests`, author, 'POST', requestInput(30), 201);
  promotionIds.push(finalRequest.id);
  assert.equal((await api('/admin/book-promotion-requests?status=pending', admin)).items[0].id, finalRequest.id);
  assert.equal((await api(`/authored-books/${bookId}/promotion`, author)).latestRequest.status, 'pending');
  assert.ok(checks >= 25);
  console.log(`PASS ${checks} book-promotion API checks: ownership, free requests, admin settings, approval, feed visibility, expiry, and rejection.`);
} finally {
  if (promotionIds.length) await pool.query('DELETE FROM book_promotion_requests WHERE id=ANY($1::uuid[])', [promotionIds]);
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM authored_books WHERE id=$1', [bookId]);
  await pool.query('DELETE FROM afilli_auth_sessions WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM afilli_auth_accounts WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [users]);
  if (originalSettings) {
    await pool.query('UPDATE book_promotion_settings SET enabled=$1,allowed_durations=$2,updated_by=$3,updated_at=$4 WHERE id=true',
      [originalSettings.enabled, originalSettings.allowed_durations, originalSettings.updated_by, originalSettings.updated_at]);
  }
  await pool.end();
}
