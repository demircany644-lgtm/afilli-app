import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ReplitConnectors } from '@replit/connectors-sdk';
import { pool } from '@workspace/db';
import { hashPassword, digest } from '../src/lib/auth-crypto.ts';
import { passwordCode, resetPassword, login } from '../src/lib/accounts.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Development tests only');
const keys = ['AFILLI_AUTH_EMAIL_PROVIDER', 'AFILLI_AUTH_EMAIL_FROM', 'AFILLI_AUTH_EMAIL_VERIFIED'];
const previousEnv = keys.map(key => process.env[key]);
const previousProxy = ReplitConnectors.prototype.proxy;
const id = `af_mailcheck_${randomUUID().replaceAll('-', '')}`;
const email = `mail-check-${randomUUID()}@example.com`;
const oldPassword = `Old synthetic ${randomUUID()}`;
const newPassword = `New synthetic ${randomUUID()}`;
let sentCode, sendCount = 0, rejectDelivery = false;
// Only this test process is changed. Neither the running app nor production
// configuration is changed, and no real email is sent by this test.
process.env.AFILLI_AUTH_EMAIL_PROVIDER = 'gmail';
process.env.AFILLI_AUTH_EMAIL_FROM = 'synthetic-sender@gmail.com';
process.env.AFILLI_AUTH_EMAIL_VERIFIED = 'true';
ReplitConnectors.prototype.proxy = async function(connector, path, options) {
  assert.equal(connector, 'google-mail');
  if (path.endsWith('/profile')) {
    return { ok: true, json: async () => ({ emailAddress: 'synthetic-sender@gmail.com' }) };
  }
  assert.equal(path, '/gmail/v1/users/me/messages/send');
  assert.equal(options.method, 'POST');
  const mime = Buffer.from(options.body.raw, 'base64url').toString();
  assert.match(mime, new RegExp(`To: ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r\\n`));
  const text = Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString();
  sentCode = text.match(/kodun: (\d{6})/)[1];
  sendCount++;
  return { ok: !rejectDelivery, json: async () => ({ id: 'synthetic-send-receipt' }) };
};

try {
  await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, 'EpostaDenetim']);
  await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)',
    [id, email, await hashPassword(oldPassword)]);
  const unknown = await passwordCode(`unknown-${randomUUID()}@example.com`);
  assert.ok(unknown.challengeId);
  assert.equal(sendCount, 0, 'Unknown users must not trigger mail');
  const challenge = await passwordCode(email);
  assert.equal(sendCount, 1);
  const saved = (await pool.query('SELECT code_hash,used_at FROM afilli_auth_codes WHERE id=$1', [challenge.challengeId])).rows[0];
  assert.equal(saved.code_hash, digest(`${challenge.challengeId}:${sentCode}`));
  assert.equal(saved.used_at, null);
  const wrong = sentCode === '111111' ? '222222' : '111111';
  await assert.rejects(() => resetPassword(challenge.challengeId, wrong, newPassword), /Kod geçersiz/);
  assert.equal((await resetPassword(challenge.challengeId, sentCode, newPassword)).id, id);
  await assert.rejects(() => login(email, oldPassword), /şifre yanlış/);
  assert.equal((await login(email, newPassword)).id, id);
  await assert.rejects(() => resetPassword(challenge.challengeId, sentCode, oldPassword), /Kod geçersiz/);
  rejectDelivery = true;
  await assert.rejects(() => passwordCode(email), /E-posta gönderilemedi/);
  const pending = await pool.query('SELECT 1 FROM afilli_auth_codes WHERE user_id=$1 AND used_at IS NULL', [id]);
  assert.equal(pending.rowCount, 0, 'A failed delivery must invalidate its code');
  assert.equal((await login(email, newPassword)).id, id, 'Failed delivery must not change the password');
  console.log('PASS password recovery: request → Gmail MIME → code validation → reset → new login, replay rejection, unknown user privacy and failed-delivery safety. Synthetic account only; no real email sent.');
} finally {
  ReplitConnectors.prototype.proxy = previousProxy;
  keys.forEach((key, index) => {
    if (previousEnv[index] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[index];
  });
  for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts']) {
    await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [id]);
  }
  await pool.query('DELETE FROM community_users WHERE id=$1', [id]);
  // Keep reserved quota attempts: retries must never reset shared counters.
  await pool.end();
}
