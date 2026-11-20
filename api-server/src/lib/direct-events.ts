import type { Request, Response } from 'express';
import { pool, type PoolClient } from '@workspace/db';
import { digest } from './auth-crypto';
import { requestToken } from './auth-session';
import { fail, type Transaction } from './community';

type Event = { threadId: string; kind: 'message' | 'read' | 'typing' | 'sync' };
type Listener = (event: Event | null) => void;
const subscribers = new Map<string, Set<Listener>>();
let listening: PoolClient | null = null;
let connecting: Promise<void> | null = null;
const channel = 'afilli_direct_v1';

/** Hints only: actual messages are always fetched through fresh membership/session checks. */
export async function directEvent(client: Transaction, pair: { user_low: string; user_high: string }, threadId: string, kind: Event['kind']) {
  await client.query('SELECT pg_notify($1,$2)', [channel, JSON.stringify({ users: [pair.user_low, pair.user_high], threadId, kind })]);
}

async function ensureListener() {
  if (listening) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const client = await pool.connect();
    let released = false;
    const drop = () => {
      if (released) return;
      released = true;
      if (listening === client) listening = null;
      client.release(true);
      // Reconnect clients must re-read persisted data, never assume NOTIFY is durable.
      for (const set of subscribers.values()) for (const notify of [...set]) notify(null);
    };
    client.on('error', drop);
    client.on('end', drop);
    client.on('notification', (notification) => {
      if (notification.channel !== channel || !notification.payload) return;
      try {
        const e = JSON.parse(notification.payload);
        if (!Array.isArray(e.users) || !/^[a-f0-9-]{36}$/i.test(e.threadId)
          || !['message', 'read', 'typing', 'sync'].includes(e.kind)) return;
        for (const user of new Set<string>(e.users)) {
          for (const notify of subscribers.get(user) ?? []) notify({ threadId: e.threadId, kind: e.kind });
        }
      } catch { /* No unvalidated database notification reaches a client. */ }
    });
    try {
      await client.query(`LISTEN ${channel}`);
      if (released) throw new Error('Private event connection closed.');
      listening = client;
    } catch (error) { drop(); throw error; }
  })();
  try { await connecting; } finally { connecting = null; }
}

export async function openDirectEvents(req: Request, res: Response, owner: string) {
  if ((subscribers.get(owner)?.size ?? 0) >= 5) return fail(429, 'Çok fazla açık mesaj bağlantısı var. Kullanmadığın sekmeyi kapat.');
  await ensureListener();
  if (res.destroyed) return;
  const token = requestToken(req);
  if (!token) return fail(401, 'Mesajlar için yeniden giriş yap.');
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  let closed = false;
  let checking = false;
  let heartbeat: ReturnType<typeof setInterval>;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    subscribers.get(owner)?.delete(notify);
    if (!subscribers.get(owner)?.size) subscribers.delete(owner);
  };
  const end = () => { cleanup(); if (!res.writableEnded) res.end(); };
  const write = (event: unknown) => {
    if (closed) return;
    if (!res.write(`data: ${JSON.stringify(event)}\n\n`)) end();
  };
  const validSession = async () => {
    const row = await pool.query(`SELECT 1 FROM afilli_auth_sessions s JOIN afilli_auth_accounts a ON a.user_id=s.user_id
      WHERE s.token_hash=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT a.disabled`, [digest(token), owner]);
    return !!row.rowCount;
  };
  const notify: Listener = (event) => {
    if (!event) { end(); return; }
    // No body/quote is included; fetching the hint requires fresh authorization.
    write(event);
  };
  if (!subscribers.has(owner)) subscribers.set(owner, new Set());
  subscribers.get(owner)!.add(notify);
  res.once('close', cleanup);
  res.once('finish', cleanup);
  write({ kind: 'ready' });
  if (closed) return;
  heartbeat = setInterval(async () => {
    if (closed || checking) return;
    checking = true;
    try {
      if (!(await validSession())) { write({ kind: 'revoked' }); end(); return; }
      // Also recovers metadata/read receipts after a peer/account was deleted.
      write({ kind: 'sync' });
    } catch { end(); }
    finally { checking = false; }
  }, 20_000);
  heartbeat.unref();
}
