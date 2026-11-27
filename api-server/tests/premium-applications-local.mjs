import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
import { refreshPremiumEntitlement } from '../src/lib/premium.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Development tests only');
const base = 'http://localhost:80/api', marker = randomUUID().replaceAll('-', '');
const password = `Premium test ${randomUUID()}`;
const users = [], applicationIds = [];
let checks = 0;

async function api(path, token, body, expected = 200, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await response.text();
  const data = content ? JSON.parse(content) : null;
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${data?.error ?? ''}`);
  checks++;
  return data;
}

async function seed(role, index) {
  const id = `premium_${marker}_${index}`, email = `premium-${marker}-${index}@example.com`;
  users.push(id);
  await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `Premium${index}`]);
  await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role) VALUES($1,$2,$3,$4)',
    [id, email, await hashPassword(password), role]);
  const login = await api('/auth/login', null, { email, password }, 200);
  return { id, email, token: login.token };
}

async function application(userId, index, status = 'pending') {
  const result = await pool.query(`INSERT INTO premium_applications
    (user_id,package_id,package_identifier,product_id,product_identifier,plan_name,status)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
  [userId, `test-package-${index}`, '$rc_monthly', `test-product-${index}`, `test.sku.${index}`, 'Sentetik Premium plan', status]);
  applicationIds.push(result.rows[0].id);
  return result.rows[0].id;
}

try {
  const admin = await seed('admin', 0), paidUser = await seed('user', 1), freeUser = await seed('user', 2),
    rejectedUser = await seed('user', 3), expiredUser = await seed('user', 4), renewedUser = await seed('user', 5);
  await api('/premium/config', null, undefined, 401);
  const config = await api('/premium/config', freeUser.token);
  assert.equal(config.configured, false);
  assert.deepEqual(config.packages, []);
  assert.equal(config.iosPublicKey, null);

  const paidId = await application(paidUser.id, 1);
  const freeId = await application(freeUser.id, 2);
  const rejectedId = await application(rejectedUser.id, 3);
  const expiredId = await application(expiredUser.id, 4, 'active');
  await pool.query(`INSERT INTO premium_memberships
    (user_id,application_id,source,status,product_id,product_identifier,expires_at,verified_at)
    VALUES($1,$2,'paid','active','expired-product','expired.sku',now()-interval '1 second',now()-interval '30 days')`,
  [expiredUser.id, expiredId]);
  const renewedId = await application(renewedUser.id, 5, 'active');
  await pool.query(`INSERT INTO premium_memberships
    (user_id,application_id,source,status,product_id,product_identifier,expires_at,verified_at)
    VALUES($1,$2,'paid','active','renewed-product','renewed.sku',now()+interval '3 hours',now()-interval '30 minutes')`,
  [renewedUser.id, renewedId]);
  const queue = await api('/admin/premium-applications', admin.token);
  const entry = queue.items.find((item) => item.id === paidId);
  assert.equal(entry.nickname, 'Premium1');
  assert.equal(entry.email, paidUser.email);
  assert.equal(entry.planName, 'Sentetik Premium plan');

  assert.equal((await api('/premium/me', paidUser.token)).application.id, paidId);
  await api(`/admin/premium-applications/${freeId}/decision`, freeUser.token,
    { decision: 'free', reason: 'Kullanıcı yetkisi yok' }, 403);
  await api(`/admin/premium-applications/${paidId}/decision`, admin.token,
    { decision: 'free', reason: ' ' }, 400);

  const paidApproval = await api(`/admin/premium-applications/${paidId}/decision`, admin.token,
    { decision: 'paid', reason: 'Ücretli başvuru uygun görüldü' });
  assert.equal(paidApproval.status, 'paid_approved');
  await api(`/admin/premium-applications/${paidId}/decision`, admin.token,
    { decision: 'free', reason: 'Yinelenen karar' }, 409);
  await api(`/premium/applications/${paidId}/verify`, paidUser.token, {}, 409);
  await api('/premium/restore', paidUser.token, {}, 409);
  assert.equal((await api('/premium/me', paidUser.token)).active, false);

  const paidInbox = await api('/book-notifications', paidUser.token);
  assert.ok(paidInbox.items.some((item) => item.applicationId === paidId && item.kind === 'premium_status'
    && item.body.includes('ödeme')));
  const freeApproval = await api(`/admin/premium-applications/${freeId}/decision`, admin.token,
    { decision: 'free', reason: 'Ücretsiz Premium desteği' });
  assert.equal(freeApproval.status, 'active');
  const freeAccount = await api('/premium/me', freeUser.token);
  assert.equal(freeAccount.active, true);
  assert.equal(freeAccount.source, 'free');
  assert.equal(freeAccount.expiresAt, null);
  await api('/premium/preferences', freeUser.token,
    { profileFrame: 'gold', profileBackground: 'wine', chatEffect: 'rose', storeDesign: 'night' }, 200, 'PUT');
  const profile = await api(`/profiles/${freeUser.id}`, freeUser.token);
  assert.equal(profile.premium, true);
  assert.equal(profile.premiumPreferences.profileFrame, 'gold');
  assert.equal(profile.premiumPreferences.chatEffect, 'rose');
  await api(`/admin/premium-applications/${freeId}/decision`, admin.token,
    { decision: 'reject', reason: 'Tekrarlanan karar' }, 409);
  await api(`/admin/premium-applications/${rejectedId}/decision`, admin.token,
    { decision: 'reject', reason: 'Bu başvuru reddedildi' });
  assert.equal((await api('/premium/me', rejectedUser.token)).application.status, 'rejected');
  const freeInbox = await api('/book-notifications', freeUser.token);
  assert.ok(freeInbox.items.some((item) => item.applicationId === freeId && item.body.includes('ücretsiz')));

  const expiredAccount = await api('/premium/me', expiredUser.token);
  assert.equal(expiredAccount.active, false);
  assert.equal(expiredAccount.application.status, 'expired');
  await api('/premium/preferences', expiredUser.token,
    { profileFrame: 'gold', profileBackground: 'wine', chatEffect: 'rose', storeDesign: 'night' }, 403, 'PUT');
  const expiredInbox = await api('/book-notifications', expiredUser.token);
  assert.ok(expiredInbox.items.some((item) => item.applicationId === expiredId
    && item.kind === 'premium_status' && item.body.includes('süren sona erdi')),
  JSON.stringify(expiredInbox.items));

  const renewedUntil = new Date(Date.now() + 30 * 86_400_000);
  await refreshPremiumEntitlement(renewedUser.id, async (owner, productId, productIdentifier) => {
    assert.equal(owner, renewedUser.id);
    assert.equal(productId, 'renewed-product');
    assert.equal(productIdentifier, 'renewed.sku');
    return renewedUntil;
  });
  const renewedMembership = (await pool.query(
    'SELECT status,expires_at FROM premium_memberships WHERE user_id=$1', [renewedUser.id],
  )).rows[0];
  assert.equal(renewedMembership.status, 'active');
  assert.equal(new Date(renewedMembership.expires_at).getTime(), renewedUntil.getTime());
  assert.equal((await api('/premium/me', renewedUser.token)).active, true);
  const renewedInbox = await api('/book-notifications', renewedUser.token);
  assert.ok(renewedInbox.items.some((item) => item.applicationId === renewedId
    && item.kind === 'premium_status' && item.body.includes('üyeliğin yenilendi')),
  JSON.stringify(renewedInbox.items));

  const history = await api('/admin/history', admin.token);
  assert.ok(history.items.some((item) => item.targetType === 'premium_application' && applicationIds.includes(item.targetId)));
  console.log(`PASS ${checks} premium API checks: access control, admin decisions, free activation, failed payment denial, preference gate, notifications, and audit.`);
} finally {
  await pool.query('DELETE FROM social_notifications WHERE recipient_id=ANY($1::text[]) OR actor_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[]) OR (target_type=$2 AND target_id=ANY($3::text[]))',
    [users, 'premium_application', applicationIds]);
  await pool.query('DELETE FROM premium_applications WHERE id=ANY($1::uuid[])', [applicationIds]);
  await pool.query('DELETE FROM afilli_auth_sessions WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM afilli_auth_codes WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM afilli_auth_accounts WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [users]);
  await pool.end();
}
