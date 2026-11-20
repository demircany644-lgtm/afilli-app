import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MessageGif } from '@workspace/api-client-react';

/** One unconfirmed outgoing message. The clientId is the server idempotency key and never changes. */
export type LocalChatPhoto = { localId: string; size: number; width: number; height: number };
export type Attachments = { replyToId?: string | null; gif?: MessageGif | null; gifQuery?: string; photo?: LocalChatPhoto | null; photoId?: string | null };
export type OutboxEntry = { clientId: string; body: string } & Attachments;
export type ChatDraft = { body: string; outbox: OutboxEntry[] } & Attachments;

export const EMPTY_DRAFT: ChatDraft = { body: '', outbox: [] };
export const chatDraftKey = (owner: string, threadId: string) => `afilli:chat-draft:${owner}:${threadId}`;

export class DraftStorageError extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); this.name = 'DraftStorageError'; }
}

function isEntry(v: unknown): v is OutboxEntry {
  const value = v as OutboxEntry | null;
  return !!value && typeof value.clientId === 'string' && /^[0-9a-f-]{36}$/i.test(value.clientId)
    && typeof value.body === 'string' && (value.body.trim().length > 0 || !!value.gif || !!value.photo || !!value.photoId) && value.body.length <= 4000
    && validAttachments(value);
}

function validAttachments(v: Attachments): boolean {
  if (v.photoId != null && (typeof v.photoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.photoId))) return false;
  if (v.photo != null && (!/^[0-9a-f-]{36}$/i.test(v.photo.localId) || !Number.isInteger(v.photo.size)
    || v.photo.size < 1 || v.photo.size > 2097152 || !Number.isInteger(v.photo.width) || !Number.isInteger(v.photo.height)
    || v.photo.width < 1 || v.photo.height < 1 || v.photo.width > 1600 || v.photo.height > 1600)) return false;
  if (v.gif && (v.photo || v.photoId)) return false;
  if (v.gifQuery !== undefined && (typeof v.gifQuery !== 'string' || v.gifQuery.length > 200)) return false;
  if (v.replyToId != null && (typeof v.replyToId !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.replyToId))) return false;
  if (v.gif == null) return true;
  const g = v.gif;
  if (typeof g !== 'object' || g.provider !== 'klipy' || typeof g.id !== 'string' || !g.id || g.id.length > 250
    || typeof g.title !== 'string' || g.title.length > 250 || typeof g.attribution !== 'string'
    || !Number.isInteger(g.width) || !Number.isInteger(g.height) || g.width < 1 || g.height < 1 || g.width > 4000 || g.height > 4000) return false;
  try {
    const url = new URL(g.url), source = new URL(g.sourceUrl);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'].includes(url.hostname)
      && source.protocol === 'https:' && ['klipy.com', 'www.klipy.com'].includes(source.hostname)
      && !source.username && !source.password && !source.port;
  } catch { return false; }
}

/** Strict parse: throws on anything unreadable so callers never overwrite it with an empty draft. Accepts the legacy `failed` field. */
export function parseChatDraft(raw: string | null): ChatDraft {
  if (raw == null) return { body: '', outbox: [] };
  let v: unknown;
  try { v = JSON.parse(raw); } catch (e) { throw new DraftStorageError('Kayıtlı taslak okunamadı.', e); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DraftStorageError('Kayıtlı taslak bozuk.');
  const o = v as { body?: unknown; outbox?: unknown; failed?: unknown } & Attachments;
  if (typeof o.body !== 'string' || (o.outbox !== undefined && !Array.isArray(o.outbox))
    || (o.failed !== undefined && !Array.isArray(o.failed))) throw new DraftStorageError('Kayıtlı taslak bozuk.');
  const list = Array.isArray(o.outbox) ? o.outbox : Array.isArray(o.failed) ? o.failed : [];
  if (!list.every(isEntry) || !validAttachments(o)) throw new DraftStorageError('Kayıtlı gönderim kuyruğu bozuk.');
  return { body: o.body, outbox: list.map(e => ({ ...e })), ...('replyToId' in o ? { replyToId: o.replyToId } : {}), ...('gif' in o ? { gif: o.gif } : {}), ...('gifQuery' in o ? { gifQuery: o.gifQuery } : {}),
    ...('photo' in o ? { photo: o.photo } : {}), ...('photoId' in o ? { photoId: o.photoId } : {}) };
}

/** Strict read: throws DraftStorageError on storage or parse failure. */
export async function readChatDraft(owner: string, threadId: string): Promise<ChatDraft> {
  let raw: string | null;
  try { raw = await AsyncStorage.getItem(chatDraftKey(owner, threadId)); }
  catch (e) { throw new DraftStorageError('Cihaz depolamasına erişilemedi.', e); }
  return parseChatDraft(raw);
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Serialized functional update per owner+thread: read (strict) -> fn -> write, queued so concurrent
 * save/enqueue/ack never race. Rejects (without writing) if the read or write fails.
 */
export function updateChatDraft(owner: string, threadId: string, fn: (d: ChatDraft) => ChatDraft): Promise<ChatDraft> {
  const key = chatDraftKey(owner, threadId);
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    if (await AsyncStorage.getItem('afilli:account-deleted:v1:' + owner)) throw new DraftStorageError('Bu hesap silindi.', null);
    const cur = await readChatDraft(owner, threadId);
    const next = fn(cur);
    try {
      if (!next.body && next.outbox.length === 0 && !next.gif && !next.replyToId && !next.photo && !next.photoId) await AsyncStorage.removeItem(key);
      else await AsyncStorage.setItem(key, JSON.stringify(next));
      if (await AsyncStorage.getItem('afilli:account-deleted:v1:' + owner)) {
        await AsyncStorage.removeItem(key);
        throw new DraftStorageError('Bu hesap silindi; geç taslak kaldırıldı.', null);
      }
    } catch (e) { throw new DraftStorageError('Taslak kaydedilemedi.', e); }
    return next;
  });
  chains.set(key, run);
  run.finally(() => { if (chains.get(key) === run) chains.delete(key); }).catch(() => {});
  return run;
}

export async function purgeOwnerChatDrafts(owner: string) {
  const prefix = `afilli:chat-draft:${owner}:`;
  await Promise.allSettled([...chains.entries()].filter(([key]) => key.startsWith(prefix)).map(([, run]) => run));
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
  for (const key of keys) await AsyncStorage.removeItem(key);
}

/** Save typed text; outbox untouched. */
export const saveDraftBody = (owner: string, threadId: string, body: string) =>
  updateChatDraft(owner, threadId, (d) => ({ ...d, body }));

export const saveDraftContent = (owner: string, threadId: string, content: { body: string } & Attachments) =>
  updateChatDraft(owner, threadId, d => ({ ...d, ...content }));

/**
 * Durably queue an outgoing message BEFORE network send. `bodyAfter` is evaluated inside the
 * serialized write so the newest typed text is kept (pass a ref reader).
 */
export const enqueueOutbox = (owner: string, threadId: string, entry: OutboxEntry, bodyAfter: () => string, attachmentsAfter?: () => Attachments) =>
  updateChatDraft(owner, threadId, (d) => ({
    ...d,
    body: bodyAfter(),
    ...(attachmentsAfter ? attachmentsAfter() : {}),
    outbox: [...d.outbox.filter((x) => x.clientId !== entry.clientId), entry],
  }));

/** Remove an entry only after a real server ack; keeps body and all other entries. */
export const ackOutbox = (owner: string, threadId: string, clientId: string) =>
  updateChatDraft(owner, threadId, (d) => ({ ...d, outbox: d.outbox.filter((x) => x.clientId !== clientId) }));
