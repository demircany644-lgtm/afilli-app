import { useRef, useState, useSyncExternalStore } from 'react';
import { subscribeSavedBooks, setBookSubscription } from '@workspace/api-client-react';
import { actorRequest, useOwnerGuard } from '@/components/profile/hooks';
import { apiError, goSignIn } from '@/components/bulletins/common';
import { useCommunity } from '@/context/CommunityContext';
import { useApp } from '@/context/AppContext';

/**
 * Account-keyed coordinator for server book subscriptions (chapter notifications).
 * Per owner, every operation runs on one serial queue: the one-time additive migration of
 * local real-book bookmarks always completes before any explicit set, so a just-removed
 * subscription is never re-added by a late merge.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRealBookId = (id: string) => UUID.test(id);
const CHUNK = 100;

type OwnerState = { done: boolean; running: boolean; error: string | null; tail: Promise<void> };
export type MigrationStatus = { done: boolean; running: boolean; error: string | null };
const owners = new Map<string, OwnerState>();
const listeners = new Set<() => void>();
const snapshots = new Map<string, MigrationStatus>();
const IDLE: MigrationStatus = { done: false, running: false, error: null };

function state(owner: string): OwnerState {
  let s = owners.get(owner);
  if (!s) { s = { done: false, running: false, error: null, tail: Promise.resolve() }; owners.set(owner, s); }
  return s;
}
function emit(owner: string) {
  const s = state(owner);
  snapshots.set(owner, { done: s.done, running: s.running, error: s.error });
  listeners.forEach((f) => f());
}
function enqueue<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  const s = state(owner);
  const run = s.tail.then(fn);
  s.tail = run.then(() => undefined, () => undefined);
  return run;
}

async function migrateNow(owner: string, ids: string[]) {
  const s = state(owner);
  if (s.done) return;
  s.running = true; s.error = null; emit(owner);
  try {
    const real = [...new Set(ids.filter(isRealBookId))];
    for (let i = 0; i < real.length; i += CHUNK) await subscribeSavedBooks({ bookIds: real.slice(i, i + CHUNK) }, actorRequest(owner));
    s.done = true;
  } catch (e) {
    s.error = apiError(e, 'Kayıtlı kitapların bildirimleri açılamadı. Kayıtların cihazında duruyor.');
    throw e;
  } finally { s.running = false; emit(owner); }
}

/** Initial local-to-server merge; once per owner after the local cache is ready. Additive, never removes local data. */
export function migrateSavedBooks(owner: string, ids: string[]): Promise<void> {
  return enqueue(owner, () => migrateNow(owner, ids));
}

/** Explicit subscription change, ordered after the initial merge for this owner. */
export function setBookSaved(owner: string, bookId: string, saved: boolean, currentIds: string[]): Promise<void> {
  return enqueue(owner, async () => {
    await migrateNow(owner, currentIds);
    await setBookSubscription(bookId, { saved }, actorRequest(owner));
  });
}

export function useMigrationStatus(owner: string | null): MigrationStatus {
  return useSyncExternalStore(
    (f) => { listeners.add(f); return () => { listeners.delete(f); }; },
    () => (owner ? snapshots.get(owner) ?? IDLE : IDLE),
    () => IDLE,
  );
}

/**
 * Owner-bound saver. Local bookmark changes only after server success; the owner-bound
 * AppContext setter is captured up front so a late success still commits for the right
 * account (AppProvider refuses if the owner changed). Busy/error only touch a live screen.
 */
export function useSavedBookSetter() {
  const { userId, ready } = useCommunity();
  const app = useApp();
  const guard = useOwnerGuard(userId);
  const savedRef = useRef(app.saved); savedRef.current = app.saved;
  const lock = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const set = async (bookId: string, saved: boolean): Promise<boolean> => {
    if (lock.current) return false;
    const commit = app.setBookSaved;
    if (!ready) { setError({ id: bookId, message: 'Hesap bilgilerin henüz hazır değil. Yeniden dene.' }); return false; }
    if (!userId) {
      if (!isRealBookId(bookId)) { try { commit(bookId, saved); return true; } catch (e) { setError({ id: bookId, message: e instanceof Error ? e.message : 'Kayıt yapılamadı.' }); return false; } }
      if (saved) { goSignIn(); return false; }
      try { commit(bookId, false); return true; } catch { return false; }
    }
    if (!app.ready) { setError({ id: bookId, message: 'Cihaz kayıtların henüz hazır değil. Yeniden dene.' }); return false; }
    const owner = userId;
    lock.current = true; setBusyId(bookId); setError(null);
    try {
      await setBookSaved(owner, bookId, saved, savedRef.current);
      try { commit(bookId, saved); } catch (e) { if (guard()) setError({ id: bookId, message: e instanceof Error ? e.message : 'Kayıt cihazına yazılamadı.' }); return false; }
      return true;
    } catch (e) {
      if (guard()) setError({ id: bookId, message: apiError(e, saved ? 'Kitap kaydedilemedi. Tekrar dene.' : 'Kayıt kaldırılamadı. Kitap kitaplığında duruyor.') });
      return false;
    } finally { lock.current = false; if (guard()) setBusyId(null); }
  };
  return { set, busyId, error, clearError: () => setError(null) };
}
