import type { Request, RequestHandler, Response } from 'express';
import { pool } from '@workspace/db';
import { digest, sessionSecret } from './auth-crypto';

type AuthRequest = Request & { afilliUserId?: string | null };
export const authenticatedUserId = (req: Request) => (req as AuthRequest).afilliUserId ?? null;
const cookieName = 'afilli_session';
export function allowedOrigin(origin: string) {
  const names = [process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_EXPO_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS ?? '').split(','), ...(process.env.AFILLI_WEB_ORIGINS ?? '').split(',')];
  return names.some((name) => {
    if (!name?.trim()) return false;
    try { return new URL(name.startsWith('https://') ? name : `https://${name.trim()}`).origin === origin; }
    catch { return false; }
  });
}
export function requestToken(req: Request) {
  const authorization = req.header('Authorization');
  if (authorization) return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1] ?? null;
  return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? null;
}
export const authMiddleware: RequestHandler = async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.header('Origin');
  if (origin && !allowedOrigin(origin) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.status(403).json({ error: 'Bu adresten hesap işlemi yapılamaz.' }); return;
  }
  (req as AuthRequest).afilliUserId = null;
  const token = requestToken(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) { next(); return; }
  try {
    const found = await pool.query<{ user_id: string }>(`SELECT s.user_id FROM afilli_auth_sessions s
      JOIN afilli_auth_accounts a ON a.user_id=s.user_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT a.disabled`, [digest(token)]);
    (req as AuthRequest).afilliUserId = found.rows[0]?.user_id ?? null;
    next();
  } catch { res.status(503).json({ error: 'Oturum kontrolü geçici olarak yapılamıyor. Kayıtların korunuyor; yeniden dene.' }); }
};
export async function createSession(userId: string, req: Request, res: Response) {
  const token = sessionSecret();
  await pool.query(`INSERT INTO afilli_auth_sessions(token_hash,user_id,expires_at)
    VALUES($1,$2,now()+interval '90 days')`, [digest(token), userId]);
  res.cookie(cookieName, token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 90 * 86400_000, path: '/api' });
  return req.header('X-Afilli-Client') === 'native' ? token : undefined;
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'none', path: '/api' });
}
