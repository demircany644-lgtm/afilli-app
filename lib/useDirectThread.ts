import { useCallback, useEffect, useRef, useState } from 'react';
import { getConversation, getConversationMessages, getConversationChanges, deleteConversationMessage, syncConversationMessages, sendConversationMessage, readConversation, type Conversation, type DirectMessage } from '@workspace/api-client-react';
import { randomUUID } from 'expo-crypto';
import { useDirectMessages } from '@/context/DirectMessagesContext';
import { actorRequest, useFocusedForeground, useOwnerGuard } from '@/components/profile/hooks';
import { ackOutbox, readChatDraft, updateChatDraft, type OutboxEntry } from './chat-drafts';
import { prepareChatPhoto, queueChatPhotoCleanup, drainChatPhotoCleanup } from './chat-photos';
import { acknowledged, compareSequence, mergeMessages } from './direct-message-state';

export type Pending = OutboxEntry & { status: 'sending' | 'failed' | 'unconfirmed'; error?: string; replyUnavailable?: boolean };
export function useDirectThread(id: string) {
  const { owner, revision, refresh: refreshList } = useDirectMessages();
  const alive = useOwnerGuard(owner);
  const active = useFocusedForeground();
  const [conversation, setConversation] = useState<Conversation>();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const transcript = useRef<DirectMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(!!owner);
  const [error, setError] = useState<unknown>(null);
  const [outboxErr, setOutboxErr] = useState(false);
  const [outboxAttempt, setOutboxAttempt] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursor = useRef<string | null>(null);
  const initialized = useRef(false);
  // Recovery progress is NOT the newest displayed message. Head snapshots and
  // send acknowledgements may jump ahead of messages we have not recovered yet.
  const recoveredAfter = useRef<string | null>(null);
  const changesAfter = useRef<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleting = useRef(new Set<string>());
  const busy = useRef(false), dirty = useRef(false), olderBusy = useRef(false);
  const inFlight = useRef(new Set<string>());
  const controllers = useRef(new Set<AbortController>());
  const denied = useRef(false);
  useEffect(() => () => { for (const c of controllers.current) c.abort(); controllers.current.clear(); }, []);
  const options = useCallback(() => {
    const controller = new AbortController(); controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    return { request: { ...actorRequest(owner), signal: controller.signal }, done: () => { clearTimeout(timeout); controllers.current.delete(controller); } };
  }, [owner]);
  const merge = useCallback((items: DirectMessage[]) => {
    if (!alive() || denied.current) return;
    transcript.current = mergeMessages(transcript.current, items);
    setMessages(transcript.current);
  }, [alive]);
  const failure = useCallback((e: unknown) => {
    if (!alive()) return;
    setError(e);
    if ([401, 403, 404].includes((e as { status?: number }).status ?? 0)) {
      denied.current = true; transcript.current = []; setMessages([]); setPending([]); setConversation(undefined);
    }
  }, [alive]);
  const refresh = useCallback(async () => {
    if (!owner || !id || !alive()) return;
    if (busy.current) { dirty.current = true; return; }
    busy.current = true;
    try {
      do {
        dirty.current = false;
        const run = options();
        try {
          const [c, head] = await Promise.all([getConversation(id, run.request), getConversationMessages(id, {}, run.request)]);
          if (!alive()) return;
          denied.current = false; setConversation(c); merge(head.items);
          if (!initialized.current) {
            initialized.current = true; cursor.current = head.nextCursor; setHasOlder(!!head.nextCursor);
            // Establish the initial historical boundary from this head only,
            // never from a concurrent local ACK already present in transcript.
            recoveredAfter.current = head.items[0]?.sequence ?? '0';
            changesAfter.current = head.changeCursor ?? '0';
          }
          let more = true;
          while (more && alive()) {
            const after = recoveredAfter.current ?? '0';
            const page = await syncConversationMessages(id, { after }, run.request);
            if (!alive()) return;
            if (compareSequence(page.nextAfter, after) < 0 || (page.hasMore && page.nextAfter === after)) throw new Error('Mesaj eşitleme ilerleyemedi.');
            merge(page.items);
            // Commit only a successfully received page. A failed next page
            // resumes here even if a head or send ACK has a larger sequence.
            recoveredAfter.current = page.nextAfter;
            more = page.hasMore;
          }
          // Mutation recovery is separate from insertion order. It includes
          // old loaded messages, tombstones, expired quotes and read receipts.
          more = true;
          while (more && alive()) {
            const after = changesAfter.current ?? '0';
            const page = await getConversationChanges(id, { after }, run.request);
            if (!alive()) return;
            if (compareSequence(page.nextAfter, after) < 0 || (page.hasMore && page.nextAfter === after)) throw Error('Mesaj değişiklikleri eşitlenemedi.');
            merge(page.items); changesAfter.current = page.nextAfter; more = page.hasMore;
          }
          if (alive()) setError(null);
        } catch (e) { failure(e); }
        finally { run.done(); if (alive()) setLoading(false); }
      } while (dirty.current && alive());
    } finally { busy.current = false; }
  }, [owner, id, alive, options, merge, failure]);
  useEffect(() => { if (active) void refresh(); }, [active, revision, refresh]);
  useEffect(() => {
    if (!owner || !id) return;
    let on = true;
    readChatDraft(owner, id).then(d => {
      if (!on || !alive() || denied.current) return;
      setOutboxErr(false);
      setPending(list => [...list, ...d.outbox.filter(e => !list.some(p => p.clientId === e.clientId)).map(e => ({ ...e, status: 'unconfirmed' as const }))]);
    }).catch(() => { if (on && alive()) setOutboxErr(true); });
    return () => { on = false; };
  }, [owner, id, alive, outboxAttempt]);
  // A response/event may confirm an outbox item after an interruption. Dedupe is sender-bound.
  const acking = useRef(new Set<string>());
  useEffect(() => {
    if (!owner || !alive()) return;
    for (const p of pending) {
      if (!acknowledged(messages, owner, p.clientId) || acking.current.has(p.clientId)) continue;
      acking.current.add(p.clientId);
      (async () => {
        if (p.photo) await queueChatPhotoCleanup(owner, p.photo);
        await ackOutbox(owner, id, p.clientId);
        if (alive()) setPending(list => list.filter(e => e.clientId !== p.clientId));
        void drainChatPhotoCleanup(owner).catch(() => {});
      })().catch(() => { if (alive()) setOutboxErr(true); })
        .finally(() => acking.current.delete(p.clientId));
    }
  }, [pending, messages, owner, id, alive, outboxAttempt]);
  const deliver = useCallback((entry: OutboxEntry) => {
    if (!owner || !alive() || denied.current || inFlight.current.has(entry.clientId)) return;
    inFlight.current.add(entry.clientId);
    setPending(list => [{ ...entry, status: 'sending' }, ...list.filter(e => e.clientId !== entry.clientId)]);
    const run = options();
    void (async () => {
      const photoId = await prepareChatPhoto(owner, id, entry, run.request);
      if (!alive()) return null;
      if (photoId && photoId !== entry.photoId) {
        await updateChatDraft(owner, id, draft => ({ ...draft, outbox: draft.outbox.map(item => item.clientId === entry.clientId ? { ...item, photoId } : item) }));
        if (!alive()) return null;
        setPending(list => list.map(item => item.clientId === entry.clientId ? { ...item, photoId } : item));
      }
      return sendConversationMessage(id, { clientId: entry.clientId, body: entry.body, replyToId: entry.replyToId, gif: entry.gif, photoId }, run.request);
    })().then(message => {
      if (!message) return;
      if (!alive()) return; // Durable outbox survives screen/account changes.
      merge([message]); // Canonical ACK is retained BEFORE any local pending item can disappear.
      void refreshList();
    }).catch(e => {
      if (!alive()) return;
      const status = (e as { status?: number }).status;
      const replyUnavailable = (e as { data?: { code?: string } }).data?.code === 'REPLY_UNAVAILABLE' || status === 404 && !!entry.replyToId;
      if ([401, 403].includes(status ?? 0)) failure(e);
      else {
        setPending(list => list.map(p => p.clientId === entry.clientId ? { ...p, status: 'failed', replyUnavailable,
          error: replyUnavailable ? 'Yanıtlanan mesaj silinmiş. Alıntıyı kaldırarak gönderebilirsin.' : status === 409 ? 'Bu gönderimin içeriği değişmiş; taslağı koruyup destek iste.' : 'Gönderim doğrulanamadı. Aynı mesajı tekrar deneyebilirsin.' } : p));
        if (status === 404) void refresh(); // Only a fresh conversation check may deny access.
      }
    }).finally(() => { run.done(); inFlight.current.delete(entry.clientId); });
  }, [owner, alive, id, options, merge, refreshList, failure, refresh]);
  const withoutReply = useCallback(async (entry: Pending) => {
    if (!owner || !alive() || !entry.replyUnavailable || inFlight.current.has(entry.clientId)) return;
    const replacement: OutboxEntry = { clientId: randomUUID(), body: entry.body, replyToId: null, photoId: null,
      gif: entry.gif, gifQuery: entry.gifQuery, photo: entry.photo };
    try {
      await updateChatDraft(owner, id, draft => ({ ...draft, outbox: draft.outbox.map(item => item.clientId === entry.clientId ? replacement : item) }));
      if (!alive()) return;
      setPending(list => list.filter(item => item.clientId !== entry.clientId));
      deliver(replacement);
    } catch { if (alive()) setOutboxErr(true); }
  }, [owner, alive, id, deliver]);
  const deleteMessage = useCallback(async (message: DirectMessage) => {
    if (!owner || !alive() || message.sender.id !== owner || deleting.current.has(message.id)) return;
    deleting.current.add(message.id); setDeleteError(null);
    const run = options();
    try { const tombstone = await deleteConversationMessage(id, message.id, run.request); merge([tombstone]); void refreshList(); void refresh(); }
    catch { if (alive()) setDeleteError('Mesaj silinemedi; mesaj korunuyor. Bağlantını kontrol edip tekrar dene.'); }
    finally { run.done(); deleting.current.delete(message.id); }
  }, [owner, alive, id, options, merge, refreshList, refresh]);
  const loadOlder = useCallback(() => {
    if (!owner || !alive() || denied.current || !cursor.current || olderBusy.current) return;
    olderBusy.current = true; setLoadingOlder(true);
    const before = cursor.current, run = options();
    void getConversationMessages(id, { cursor: before }, run.request).then(page => {
      if (!alive()) return;
      merge(page.items); cursor.current = page.nextCursor; setHasOlder(!!page.nextCursor);
    }).catch(failure).finally(() => { run.done(); olderBusy.current = false; if (alive()) setLoadingOlder(false); });
  }, [owner, alive, id, options, merge, failure]);
  const marked = useRef('0');
  useEffect(() => {
    if (!active || !owner || !conversation || !alive() || denied.current) return;
    const newest = messages.find(m => m.sender.id !== owner && !m.deletedAt && !m.readAt && recoveredAfter.current !== null
      && compareSequence(m.sequence, recoveredAfter.current) <= 0);
    if (!newest || marked.current === newest.sequence) return;
    marked.current = newest.sequence;
    const run = options();
    void readConversation(id, { throughSequence: newest.sequence }, run.request).then(() => {
      if (alive()) { merge(transcript.current.map(m => m.sender.id !== owner && compareSequence(m.sequence, newest.sequence) <= 0 ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m)); void refreshList(); }
    }).catch(() => { marked.current = '0'; }).finally(run.done);
  }, [active, messages, owner, conversation, alive, id, options, merge, refreshList]);
  return {
    conv: { data: conversation, error, isLoading: loading, refetch: refresh },
    messages, pending: pending.filter(p => !owner || !acknowledged(messages, owner, p.clientId)),
    deliver, withoutReply, deleteMessage, deleteError, outboxErr, reloadOutbox: () => setOutboxAttempt(n => n + 1),
    loading, error, retry: () => { void refresh(); }, loadOlder, hasOlder, loadingOlder,
  };
}
