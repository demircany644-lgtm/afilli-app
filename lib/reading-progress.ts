import { useSyncExternalStore } from 'react';
import { randomUUID } from 'expo-crypto';
import { setReadingPosition, type ReadingPosition } from '@workspace/api-client-react';
import { progressJournal } from './reading-progress-journal';

/**
 * Owner+book scoped, serialized reading-progress controller shared by every reader instance.
 * - The latest user-selected chapter ("desired") always wins; older acks never clear newer targets.
 * - A pending-only journal (chapter id + seq, never text) is written BEFORE each post and cleared
 *   only when the ack matches the journaled seq, so unmount / app kill / re-login can recover it.
 * - Each request is posted with the owner captured at gesture time; a different live owner pauses sending.
 */

export type Pending = { chapterId: string; seq: number; at: number; token: string };
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'paused';
export type ProgressSnapshot = {
  /** Latest chapter the owner selected (or server-confirmed seed). */
  desired: string | null;
  /** Last chapter the server acknowledged for this owner+book. */
  confirmed: string | null;
  status: SaveStatus;
  error: string | null;
  /** Local journal failure: do not send until the intent is backed up successfully. */
  storageError: string | null;
};
export type Transport = (owner: string, bookId: string, chapterId: string) => Promise<ReadingPosition>;
export type Journal = {
  put: (owner: string, bookId: string, p: Pending) => Promise<void>;
  get: (owner: string, bookId: string) => Promise<Pending | null>;
  /** Removes the entry only if its unique operation token still matches. */
  clear: (owner: string, bookId: string, token: string) => Promise<void>;
};

type Slot = {
  owner: string; bookId: string;
  desired: string | null; desiredSeq: number; ackedSeq: number;
  confirmed: string | null; running: Promise<void> | null;
  pending: Pending | null; persisted: Promise<boolean>;
  snap: ProgressSnapshot; listeners: Set<() => void>;
};

const EMPTY: ProgressSnapshot = { desired: null, confirmed: null, status: 'idle', error: null, storageError: null };

export function createProgressStore(opts: {
  transport: Transport;
  journal: Journal;
  /** Return false to hold posts for an owner that is no longer the live session. */
  canSend?: (owner: string) => boolean;
  errorText?: (e: unknown) => string;
  createId?: () => string;
}) {
  const slots = new Map<string, Slot>();
  let counter = Date.now() * 1000;
  const nextSeq = () => ++counter;
  const errText = opts.errorText ?? ((e: unknown) => (e instanceof Error && e.message ? e.message : 'Okuma konumu kaydedilemedi.'));
  const k = (owner: string, bookId: string) => owner + '\u0000' + bookId;

  function slot(owner: string, bookId: string): Slot {
    let s = slots.get(k(owner, bookId));
    if (!s) {
      s = { owner, bookId, desired: null, desiredSeq: 0, ackedSeq: 0, confirmed: null, running: null,
        pending: null, persisted: Promise.resolve(true), snap: EMPTY, listeners: new Set() };
      slots.set(k(owner, bookId), s);
    }
    return s;
  }
  function emit(s: Slot, patch: Partial<ProgressSnapshot>) {
    s.snap = { ...s.snap, desired: s.desired, confirmed: s.confirmed, ...patch };
    s.listeners.forEach((l) => l());
  }

  function pump(s: Slot): Promise<void> {
    if (s.running) return s.running;
    s.running = (async () => {
      while (s.desired && s.desiredSeq > s.ackedSeq) {
        const target = s.desired, seq = s.desiredSeq, pending = s.pending;
        const persisted = await s.persisted;
        if (seq !== s.desiredSeq) continue;
        if (!persisted || !pending) return;
        if (opts.canSend && !opts.canSend(s.owner)) { emit(s, { status: 'paused', error: null }); return; }
        emit(s, { status: 'saving', error: null });
        try {
          const r = await opts.transport(s.owner, s.bookId, target);
          s.confirmed = r.chapterId ?? target;
          await opts.journal.clear(s.owner, s.bookId, pending.token);
          s.ackedSeq = Math.max(s.ackedSeq, seq);
          if (seq === s.desiredSeq) { s.pending = null; emit(s, { status: 'saved', error: null, storageError: null }); }
        } catch (e) {
          // A newer target supersedes this failure; otherwise surface an honest error and stop.
          if (seq === s.desiredSeq) { emit(s, { status: 'error', error: errText(e) }); return; }
        }
      }
    })().finally(() => {
      s.running = null;
      if (s.desiredSeq > s.ackedSeq && s.snap.status === 'saving') void pump(s);
    });
    return s.running;
  }

  function request(owner: string, bookId: string, chapterId: string, force = false): Promise<void> {
      const s = slot(owner, bookId);
      const current = s.desired ?? s.confirmed;
      if (!force && chapterId === current && s.snap.status !== 'error' && s.snap.status !== 'paused') return s.running ?? Promise.resolve();
      const seq = nextSeq();
      s.desired = chapterId; s.desiredSeq = seq;
      const pending = { chapterId, seq, at: Date.now(), token: (opts.createId ?? randomUUID)() };
      s.pending = pending;
      emit(s, { status: 'saving', error: null });
      s.persisted = opts.journal.put(owner, bookId, pending).then(() => {
        if (s.desiredSeq === seq) emit(s, { storageError: null });
        return true;
      }, () => {
        if (s.desiredSeq === seq) emit(s, { status: 'error', error: 'Okuma konumu cihazda kaydedilemedi. Tekrar dene.',
          storageError: 'Cihaz kaydı doğrulanamadığı için sunucuya konum gönderilmedi.' });
        return false;
      });
      return pump(s);
  }
  return {
    /** User gesture is journaled independently of the screen lifetime and before transport. */
    request,
    /** Seed with the server-confirmed chapter after a successful GET (never overrides a pending target). */
    seed(owner: string, bookId: string, chapterId: string | null) {
      const s = slot(owner, bookId);
      s.confirmed = chapterId;
      if (s.desiredSeq <= s.ackedSeq) s.desired = chapterId;
      emit(s, {});
    },
    /** Pending target: in-memory unacked desire first, then the durable journal. */
    async pending(owner: string, bookId: string): Promise<Pending | null> {
      const s = slots.get(k(owner, bookId));
      if (s?.pending && s.desiredSeq > s.ackedSeq) return s.pending;
      const p = await opts.journal.get(owner, bookId);
      if (p) counter = Math.max(counter, p.seq);
      return p;
    },
    /** Drop a pending entry that can no longer be applied (e.g. chapter unpublished). Matching seq only. */
    async discard(owner: string, bookId: string, p: Pending): Promise<void> {
      const s = slots.get(k(owner, bookId));
      if (s && s.desiredSeq === p.seq) { s.desired = null; s.ackedSeq = s.desiredSeq; emit(s, { status: 'idle', error: null }); }
      await opts.journal.clear(owner, bookId, p.token);
    },
    retry(owner: string, bookId: string) { const s = slots.get(k(owner, bookId)); if (s?.desired) void request(owner, bookId, s.desired, true); },
    async settled(owner: string, bookId: string) { const s = slots.get(k(owner, bookId)); while (s?.running) await s.running; },
    /** Resume held posts for an owner that became live again. */
    resumeOwner(owner: string) { slots.forEach((s) => { if (s.owner === owner) void pump(s); }); },
    snapshot(owner: string, bookId: string): ProgressSnapshot { return slots.get(k(owner, bookId))?.snap ?? EMPTY; },
    subscribe(owner: string, bookId: string, fn: () => void) {
      const s = slot(owner, bookId); s.listeners.add(fn);
      return () => { s.listeners.delete(fn); };
    },
  };
}
export type ProgressStore = ReturnType<typeof createProgressStore>;

// ---------- App singleton ----------

let liveOwner: string | null = null;
/** Called by the reader with the live session owner; resumes any held posts for it. */
export function setLiveProgressOwner(owner: string | null) {
  if (owner === liveOwner) return;
  liveOwner = owner;
  if (owner) progressStore.resumeOwner(owner);
}

export const progressStore = createProgressStore({
  transport: async (owner, bookId, chapterId) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try { return await setReadingPosition(bookId, { chapterId }, { headers: { 'X-Afilli-Actor': owner }, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  },
  journal: progressJournal,
  canSend: (owner) => liveOwner === owner,
  errorText: (e) => {
    const m = (e as { data?: { error?: string }; message?: string } | null);
    return m?.data?.error ?? (m?.message && !/^HTTP/i.test(m.message) ? m.message : 'Okuma konumu kaydedilemedi.');
  },
});

export function useProgress(owner: string | null, bookId: string): ProgressSnapshot {
  return useSyncExternalStore(
    (fn) => (owner ? progressStore.subscribe(owner, bookId, fn) : () => {}),
    () => (owner ? progressStore.snapshot(owner, bookId) : EMPTY),
    () => EMPTY,
  );
}
