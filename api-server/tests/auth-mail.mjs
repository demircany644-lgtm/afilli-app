import assert from 'node:assert/strict';
import { authMailConfig, createAuthMailer } from '../src/lib/auth-mail.ts';

const env = {
  AFILLI_AUTH_EMAIL_PROVIDER: 'gmail',
  AFILLI_AUTH_EMAIL_FROM: 'sender@gmail.com',
  AFILLI_AUTH_EMAIL_VERIFIED: 'true',
};
let calls = [], reservations = 0;
const ok = value => ({ ok: true, json: async () => value });
const mailer = createAuthMailer(async (connector, path, options) => {
  calls.push({ connector, path, options });
  return path.endsWith('/profile') ? ok({ emailAddress: env.AFILLI_AUTH_EMAIL_FROM }) : ok({ id: 'synthetic-receipt' });
}, async () => { reservations++; });

assert.equal(authMailConfig({}), null);
assert.equal(authMailConfig({ ...env, AFILLI_AUTH_EMAIL_VERIFIED: undefined }), null);
assert.equal(authMailConfig({ ...env, AFILLI_AUTH_EMAIL_PROVIDER: 'unknown' }), null);
assert.equal(authMailConfig({ ...env, AFILLI_AUTH_EMAIL_FROM: 'sender@gmail.com\r\nBcc: victim@example.com' }), null);
assert.equal(authMailConfig({ ...env, AFILLI_AUTH_EMAIL_PROVIDER: 'resend' }), null);
assert.equal(authMailConfig({ ...env, AFILLI_AUTH_EMAIL_PROVIDER: undefined, AFILLI_AUTH_EMAIL_FROM: 'sender@example.com' }).provider, 'resend');
await mailer.verify(env);
await mailer.send('recipient@example.com', '123456', env);
assert.equal(reservations, 1);
const sent = calls.at(-1);
assert.equal(sent.connector, 'google-mail');
assert.equal(sent.path, '/gmail/v1/users/me/messages/send');
assert.equal(sent.options.method, 'POST');
const mime = Buffer.from(sent.options.body.raw, 'base64url').toString();
assert.match(mime, /From: Afilli <sender@gmail.com>\r\nTo: recipient@example.com/);
const [headers, body] = mime.split('\r\n\r\n');
assert.match(headers, /Content-Type: text\/plain; charset=UTF-8/);
assert.equal(Buffer.from(headers.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)[1], 'base64').toString(), 'Afilli şifre belirleme kodun');
assert.match(Buffer.from(body, 'base64').toString(), /123456[\s\S]*10 dakika[\s\S]*yalnızca bir kez/);
await assert.rejects(() => mailer.send('recipient@example.com\r\nBcc: other@example.com', '123456', env), /Invalid/);
await assert.rejects(() => mailer.send('recipient@example.com', 'bad-code', env), /Invalid/);

const mismatch = createAuthMailer(async () => ok({ emailAddress: 'different@gmail.com' }), async () => { throw new Error('Must not reserve'); });
await assert.rejects(() => mismatch.verify(env), /does not match/);
await assert.rejects(() => mismatch.send('recipient@example.com', '123456', env), /does not match/);
let failedCalls = 0;
const failed = createAuthMailer(async (_, path) => {
  failedCalls++;
  return path.endsWith('/profile') ? ok({ emailAddress: env.AFILLI_AUTH_EMAIL_FROM }) : { ok: false };
}, async () => {});
await assert.rejects(() => failed.send('recipient@example.com', '123456', env), /delivery failed/);
assert.equal(failedCalls, 2, 'No automatic retry after an uncertain or rejected send');
let quotaCalls = 0;
const capped = createAuthMailer(async () => { quotaCalls++; return ok({ emailAddress: env.AFILLI_AUTH_EMAIL_FROM }); },
  async () => { throw new Error('Password email sending limit reached'); });
await assert.rejects(() => capped.send('recipient@example.com', '123456', env), /limit reached/);
assert.equal(quotaCalls, 1, 'Quota must prevent the send request');
const invalidReceipt = createAuthMailer(async (_, path) => path.endsWith('/profile') ? ok({ emailAddress: env.AFILLI_AUTH_EMAIL_FROM }) : ok({}),
  async () => {});
await assert.rejects(() => invalidReceipt.send('recipient@example.com', '123456', env), /receipt is missing/);
calls = [];
await mailer.send('recipient@example.com', '123456', {
  ...env, AFILLI_AUTH_EMAIL_PROVIDER: 'resend', AFILLI_AUTH_EMAIL_FROM: 'sender@example.com',
});
assert.equal(calls.length, 1);
assert.equal(calls[0].connector, 'resend');
assert.deepEqual(calls[0].options.body.to, ['recipient@example.com']);
console.log('PASS authentication mail: config, Gmail identity, UTF-8 MIME, input validation, quota rejection, no retries, receipts and Resend compatibility. No real email sent.');
