import { ReplitConnectors } from '@replit/connectors-sdk';
import { pool } from '@workspace/db';

const connectors = new ReplitConnectors();
type MailEnvironment = Record<string, string | undefined>;
type MailConfig = { provider: 'gmail' | 'resend'; from: string };
type MailResponse = { ok: boolean; json(): Promise<unknown> };
type MailProxy = (connector: string, path: string, options: {
  method: 'GET' | 'POST'; body?: Record<string, unknown>;
}) => Promise<MailResponse>;

export function authMailConfig(env: MailEnvironment = process.env): MailConfig | null {
  const from = (env.AFILLI_AUTH_EMAIL_FROM ?? '').trim().toLowerCase();
  const provider = env.AFILLI_AUTH_EMAIL_PROVIDER ?? 'resend';
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(from)
    || env.AFILLI_AUTH_EMAIL_VERIFIED !== 'true') return null;
  if (provider === 'gmail') return { provider, from };
  if (provider !== 'resend' || /@(gmail|googlemail|outlook|hotmail|yahoo|yandex)\./i.test(from)) return null;
  return { provider, from };
}

export function authMailReady() {
  return authMailConfig() !== null;
}

// Shared database counters, not process memory: enforce conservative test-volume
// limits across autoscale instances. Reserve attempts, including uncertain sends,
// so a timeout never causes an automatic duplicate or an unbounded retry.
export async function reserveGmailQuota() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, max, seconds] of [
      ['auth-mail:gmail:day', 100, 86400],
      ['auth-mail:gmail:hour', 20, 3600],
    ] as const) {
      const result = await client.query<{ count: number }>(`INSERT INTO afilli_auth_limits(key,count,expires_at)
        VALUES($1,1,now()+make_interval(secs=>$2)) ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN afilli_auth_limits.expires_at<=now() THEN 1 ELSE afilli_auth_limits.count+1 END,
        expires_at=CASE WHEN afilli_auth_limits.expires_at<=now() THEN now()+make_interval(secs=>$2)
          ELSE afilli_auth_limits.expires_at END RETURNING count`, [key, seconds]);
      if (result.rows[0].count > max) throw new Error('Password email sending limit reached');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createAuthMailer(proxy: MailProxy, reserve: () => Promise<void>) {
  async function verifySender(config: MailConfig) {
    if (config.provider !== 'gmail') return;
    const response = await proxy('google-mail', '/gmail/v1/users/me/profile', { method: 'GET' });
    if (!response.ok) throw new Error('Gmail sender connection is unavailable');
    const profile = await response.json() as { emailAddress?: unknown };
    if (typeof profile?.emailAddress !== 'string' || profile.emailAddress.toLowerCase() !== config.from) {
      throw new Error('Connected Gmail account does not match the configured sender');
    }
  }
  return {
    async verify(env: MailEnvironment = process.env) {
      const config = authMailConfig(env);
      if (!config) throw new Error('Auth sender is not configured');
      await verifySender(config);
    },
    async send(email: string, code: string, env: MailEnvironment = process.env) {
      const config = authMailConfig(env);
      if (!config) throw new Error('Auth sender is not configured');
      // Strict, single-recipient headers prevent CRLF/header injection.
      if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)
        || !/^\d{6}$/.test(code)) throw new Error('Invalid password email input');
      const subject = 'Afilli şifre belirleme kodun';
      const text = `Afilli şifre belirleme kodun: ${code}\n\nBu kod 10 dakika geçerlidir ve yalnızca bir kez kullanılabilir. Bu işlemi sen başlatmadıysan kodu kimseyle paylaşma ve bu e-postayı dikkate alma.`;
      let response: MailResponse;
      if (config.provider === 'gmail') {
        await verifySender(config);
        await reserve();
        const raw = [
          `From: Afilli <${config.from}>`, `To: ${email}`,
          `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
          'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64', '',
          Buffer.from(text).toString('base64').match(/.{1,76}/g)!.join('\r\n'),
        ].join('\r\n');
        response = await proxy('google-mail', '/gmail/v1/users/me/messages/send', {
          method: 'POST', body: { raw: Buffer.from(raw).toString('base64url') },
        });
      } else {
        response = await proxy('resend', '/emails', {
          method: 'POST', body: { from: `Afilli <${config.from}>`, to: [email], subject, text },
        });
      }
      if (!response.ok) throw new Error('Password email delivery failed');
      const receipt = await response.json() as { id?: unknown };
      if (typeof receipt?.id !== 'string' || !receipt.id) throw new Error('Password email receipt is missing');
    },
  };
}

const mailer = createAuthMailer(
  (connector, path, options) => connectors.proxy(connector, path, options),
  reserveGmailQuota,
);
export const verifyAuthMailSender = () => mailer.verify();
export const sendPasswordCode = (email: string, code: string) => mailer.send(email, code);
