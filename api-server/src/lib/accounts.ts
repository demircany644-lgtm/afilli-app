import { randomInt, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { pool } from '@workspace/db';
import type { AccountUser } from '@workspace/api-zod';
import { fail, transaction } from './community';
import { digest, hashPassword, verifyPassword } from './auth-crypto';
import { authMailReady, sendPasswordCode } from './auth-mail';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export async function limitAuth(req: Request, action: string, email: string, max = 12) {
  // Durable counters work across server instances. Never store addresses or raw IPs.
  for (const subject of [`ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`, `email:${email}`]) {
    const key = digest(`${action}:${subject}`);
    const result = await pool.query<{ count: number }>(`INSERT INTO afilli_auth_limits(key,count,expires_at)
      VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE
      SET count=CASE WHEN afilli_auth_limits.expires_at<=now() THEN 1 ELSE afilli_auth_limits.count+1 END,
      expires_at=CASE WHEN afilli_auth_limits.expires_at<=now() THEN now()+interval '15 minutes' ELSE afilli_auth_limits.expires_at END
      RETURNING count`, [key]);
    if (result.rows[0].count > (subject.startsWith('ip:') ? 100 : max)) fail(429, 'Çok fazla deneme yapıldı. 15 dakika sonra yeniden dene.');
  }
}
export async function accountUser(id: string): Promise<AccountUser> {
  const found = await pool.query<AccountUser>(`SELECT a.user_id AS id,a.email,u.nickname,a.role FROM afilli_auth_accounts a
    JOIN community_users u ON u.id=a.user_id WHERE a.user_id=$1 AND NOT a.disabled`, [id]);
  return found.rows[0] ?? fail(401, 'Oturumun sona erdi. Yeniden giriş yap.');
}
export async function register(email: string, nickname: string, password: string) {
  const passwordHash = await hashPassword(password);
  const id = `af_${randomUUID().replaceAll('-', '')}`;
  try {
    await transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('afilli-auth-migration'))");
      const gate = await client.query(`SELECT 1 FROM afilli_auth_migration WHERE id='legacy' AND complete=true`);
      const existing = await client.query('SELECT 1 FROM community_users LIMIT 1');
      if (!gate.rowCount && existing.rowCount) fail(503, 'Eski hesapların güvenli geçişi tamamlanıyor. Yeni kayıt geçici olarak kapalı; mevcut veriler korunuyor.');
      await client.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, nickname]);
      await client.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)', [id, email, passwordHash]);
      // The first registration in a genuinely empty database safely establishes the new store.
      if (!existing.rowCount) await client.query("INSERT INTO afilli_auth_migration(id,complete) VALUES('legacy',true) ON CONFLICT DO NOTHING");
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') fail(409, 'Bu e-posta kullanılıyor. Giriş yap veya Şifremi unuttum seçeneğini kullan.');
    throw error;
  }
  return accountUser(id);
}
export async function login(email: string, password: string) {
  const result = await pool.query<{ user_id: string; password_hash: string | null; disabled: boolean }>(
    'SELECT user_id,password_hash,disabled FROM afilli_auth_accounts WHERE email=$1', [email]);
  const account = result.rows[0];
  const valid = await verifyPassword(password, account?.password_hash ?? null);
  if (!valid || !account || account.disabled) fail(401, 'E-posta veya şifre yanlış. Eski hesabın için Şifremi unuttum ile şifre belirleyebilirsin.');
  return accountUser(account.user_id);
}
export async function passwordCode(email: string) {
  if (!authMailReady()) fail(503, 'Şifre e-postası gönderimi henüz yapılandırılmadı. Mevcut hesabın korunuyor.');
  const id = randomUUID(), code = String(randomInt(100000, 1000000));
  const account = await pool.query<{ user_id: string }>('SELECT user_id FROM afilli_auth_accounts WHERE email=$1 AND NOT disabled', [email]);
  const owner = account.rows[0]?.user_id;
  if (owner) {
    await transaction(async client => {
      await client.query('SELECT user_id FROM afilli_auth_accounts WHERE user_id=$1 FOR UPDATE', [owner]);
      await client.query('UPDATE afilli_auth_codes SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [owner]);
      await client.query(`INSERT INTO afilli_auth_codes(id,user_id,code_hash,expires_at)
        VALUES($1,$2,$3,now()+interval '10 minutes')`, [id, owner, digest(`${id}:${code}`)]);
    });
    try { await sendPasswordCode(email, code); }
    catch {
      await pool.query('UPDATE afilli_auth_codes SET used_at=now() WHERE id=$1', [id]);
      fail(503, 'E-posta gönderilemedi. Biraz sonra yeniden dene; hesabın ve şifren değişmedi.');
    }
  }
  return { challengeId: id, message: 'Bu e-posta ile bir hesabın varsa şifre belirleme kodu gönderildi. Gelen kutunu ve spam klasörünü kontrol et.' };
}
export async function resetPassword(id: string, code: string, password: string) {
  const passwordHash = await hashPassword(password);
  // Failed attempts must COMMIT, not roll back when returning an error.
  const owner = await transaction(async client => {
    const identity = await client.query<{ user_id: string }>('SELECT user_id FROM afilli_auth_codes WHERE id=$1', [id]);
    if (!identity.rows[0]) return null;
    await client.query('SELECT user_id FROM afilli_auth_accounts WHERE user_id=$1 FOR UPDATE', [identity.rows[0].user_id]);
    const found = await client.query<{ user_id: string; code_hash: string; attempts: number; valid: boolean }>(
      `SELECT user_id,code_hash,attempts,(used_at IS NULL AND expires_at>now()) AS valid
      FROM afilli_auth_codes WHERE id=$1 FOR UPDATE`, [id]);
    const row = found.rows[0];
    if (!row || !row.valid || row.attempts >= 5) return null;
    await client.query('UPDATE afilli_auth_codes SET attempts=attempts+1 WHERE id=$1', [id]);
    if (row.code_hash !== digest(`${id}:${code}`)) return null;
    const account = await client.query(`UPDATE afilli_auth_accounts SET password_hash=$2,email_verified=true
      WHERE user_id=$1 AND NOT disabled RETURNING user_id`, [row.user_id, passwordHash]);
    if (!account.rowCount) return null;
    await client.query('UPDATE afilli_auth_codes SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [row.user_id]);
    await client.query('UPDATE afilli_auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
    return row.user_id;
  });
  if (!owner) return fail(400, 'Kod geçersiz, süresi dolmuş veya deneme sınırına ulaşılmış. Yeni kod iste.');
  return accountUser(owner);
}
