import { Router, type IRouter } from 'express';
import {
  RegisterAccountBody, LoginAccountBody, RequestPasswordCodeBody, ResetAccountPasswordBody,
  GetAccountSessionResponse, RegisterAccountResponse, LoginAccountResponse, ResetAccountPasswordResponse,
  RequestPasswordCodeResponse,
} from '@workspace/api-zod';
import { pool } from '@workspace/db';
import { parse, route } from '../lib/community';
import { accountUser, limitAuth, login, normalizeEmail, passwordCode, register, resetPassword } from '../lib/accounts';
import { authenticatedUserId, clearSessionCookie, createSession, requestToken } from '../lib/auth-session';
import { digest } from '../lib/auth-crypto';

const router: IRouter = Router();
router.get('/auth/session', route(async (req, res) => {
  const id = authenticatedUserId(req);
  res.json(GetAccountSessionResponse.parse({ user: id ? await accountUser(id) : null }));
}));
router.post('/auth/register', route(async (req, res) => {
  const data = parse(RegisterAccountBody, req.body);
  const email = normalizeEmail(data.email), nickname = data.nickname.trim();
  if (nickname.length < 3 || nickname.length > 15) { res.status(400).json({ error: 'Takma ad 3–15 karakter olmalı.' }); return; }
  await limitAuth(req, 'register', email, 6);
  const user = await register(email, nickname, data.password);
  const token = await createSession(user.id, req, res);
  res.status(201).json(RegisterAccountResponse.parse({ user, ...(token ? { token } : {}) }));
}));
router.post('/auth/login', route(async (req, res) => {
  const data = parse(LoginAccountBody, req.body), email = normalizeEmail(data.email);
  await limitAuth(req, 'login', email);
  const user = await login(email, data.password);
  const token = await createSession(user.id, req, res);
  res.json(LoginAccountResponse.parse({ user, ...(token ? { token } : {}) }));
}));
router.post('/auth/logout', route(async (req, res) => {
  const token = requestToken(req);
  if (token) await pool.query('UPDATE afilli_auth_sessions SET revoked_at=now() WHERE token_hash=$1', [digest(token)]);
  clearSessionCookie(res);
  res.status(204).end();
}));
router.post('/auth/password-code', route(async (req, res) => {
  const data = parse(RequestPasswordCodeBody, req.body), email = normalizeEmail(data.email);
  await limitAuth(req, 'password-code', email, 3);
  res.status(202).json(RequestPasswordCodeResponse.parse(await passwordCode(email)));
}));
router.post('/auth/reset-password', route(async (req, res) => {
  const data = parse(ResetAccountPasswordBody, req.body);
  await limitAuth(req, 'reset-password', data.challengeId);
  const user = await resetPassword(data.challengeId, data.code, data.password);
  const token = await createSession(user.id, req, res);
  res.json(ResetAccountPasswordResponse.parse({ user, ...(token ? { token } : {}) }));
}));
export default router;
