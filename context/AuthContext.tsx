import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AuthSessionContext as C } from './auth-session';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { removeAccountCache } from '@/lib/account-local-delete';
import { purgeOwnerChatDrafts } from '@/lib/chat-drafts';
import { purgeOwnerChatPhotos } from '@/lib/chat-photos';
import { purgeOwnerWriterRecords } from '@/lib/writer-store';
import { createDeletionJobs } from '@/lib/account-deletion-jobs';
import { randomUUID } from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import {
  getAccountSession, loginAccount, registerAccount, logoutAccount, resetAccountPassword,
  setAuthTokenGetter, getAccountDeletionStatus, type AccountSession, type AccountUser,
} from '@workspace/api-client-react';

const native = Platform.OS !== 'web';
const storageKey = 'afilli_account_session_v1';
const cleanupMessage = 'Bir hesap silme isteğinin doğrulanması veya cihaz temizliği tamamlanamadı. Kurtarma kaydı korunuyor; temizlemeyi yeniden dene.';
async function clearDeletedContent(owner: string) {
  await removeAccountCache(owner);
  await purgeOwnerChatPhotos(owner);
  await purgeOwnerChatDrafts(owner);
  await purgeOwnerWriterRecords(owner);
}
const headers: Record<string, string> = native ? { 'X-Afilli-Client': 'native' } : {};
const transport = { credentials: 'include' as const, headers };
export type Session = {
  isLoaded: boolean; userId: string | null; isSignedIn: boolean; offline: boolean; error: string | null;
  getToken: () => Promise<string | null>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, nickname: string, password: string, acceptedRules: true) => Promise<void>;
  resetPassword: (challengeId: string, code: string, password: string) => Promise<void>;
  signOut: () => Promise<void>; retry: () => Promise<void>;
  /** Highest role reported by the server for this account (never derived from email). */
  role: AccountUser['role'] | null;
  /** Local-only cleanup after the server confirmed self-deletion. Never calls logout. Resolves false if device storage could not be cleared. */
  finalizeDeletion: (deletedUserId: string, requestId: string) => Promise<boolean>;
  /** Persist the deletion marker BEFORE the remote DELETE; throws if it cannot be written (do not send then). */
  beginDeletion: (userId: string) => Promise<string>;
  /** Server explicitly rejected the deletion: the account still exists, drop the marker. */
  abortDeletion: (userId: string, requestId: string, serverRejected?: boolean) => Promise<void>;
  /** Non-null when the deleted account's device record could not be removed yet. */
  forgetError: string | null;
  retryForget: () => Promise<boolean>;
};
type SavedSession = { token: string; user: AccountUser };
function parseSaved(raw: string | null): SavedSession | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw);
    return /^[A-Za-z0-9_-]{43}$/.test(x?.token ?? '') && typeof x?.user?.id === 'string'
      && typeof x.user.nickname === 'string' && typeof x.user.email === 'string' ? x : null;
  } catch { return null; }
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUserState] = useState<AccountUser | null>(null);
  // Live identity, updated synchronously on every accept/restore/clear (never a stale closure).
  const liveUser = useRef<AccountUser | null>(null);
  const setUser = useCallback((u: AccountUser | null) => { liveUser.current = u; setUserState(u); }, []);
  const [isLoaded, setLoaded] = useState(false), [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const revision = useRef(0), busy = useRef(false);
  const mounted = useRef(true);
  const storageQueue = useRef(Promise.resolve());
  const [forgetError, setForgetError] = useState<string | null>(null);
  const persist = useCallback((operation: () => Promise<void>) => {
    const result = storageQueue.current.then(operation);
    storageQueue.current = result.catch(() => {});
    return result;
  }, []);
  const jobs = useRef<ReturnType<typeof createDeletionJobs> | null>(null);
  if (!jobs.current) jobs.current = createDeletionJobs({
    storage: AsyncStorage, newId: randomUUID, purge: clearDeletedContent,
    receipt: async (requestId) => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
      try { return (await getAccountDeletionStatus({ requestId }, { credentials: 'include', signal: controller.signal })).deleted; }
      finally { clearTimeout(timer); }
    },
    clearSavedSession: (owner) => persist(async () => {
      // Read inside the shared write queue: a newly signed-in account's token
      // must never be removed by an older owner's cleanup job.
      if (native && parseSaved(await SecureStore.getItemAsync(storageKey))?.user.id === owner) {
        await SecureStore.deleteItemAsync(storageKey);
      }
    }),
  });
  const recoverDeletionJobs = useCallback(async (confirmedRequestId?: string) => {
    try {
      const result = await jobs.current!.run(confirmedRequestId);
      setForgetError(result.remaining.length || result.failed ? cleanupMessage : null);
      return { ...result, unreadable: false };
    } catch {
      setForgetError(cleanupMessage);
      return { remaining: [], failed: true, unreadable: true };
    }
  }, []);
  const getToken = useCallback(async () => native ? token.current : null, []);
  const restore = useCallback(async () => {
    const generation = ++revision.current;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    let cached: SavedSession | null = null;
    let confirmed: AccountSession | null = null;
    let blockedOwners: string[] = [], jobsUnknown = false;
    try {
      const recovery = await recoverDeletionJobs();
      blockedOwners = recovery.remaining.map(job => job.owner);
      jobsUnknown = recovery.unreadable;
      if (generation !== revision.current || !mounted.current) return;
      if (native) {
        cached = parseSaved(await SecureStore.getItemAsync(storageKey));
        if (generation !== revision.current || !mounted.current) return;
        token.current = cached?.token ?? null;
      }
      const result = await getAccountSession({
        ...transport, signal: controller.signal,
        headers: native && token.current ? { ...transport.headers, Authorization: `Bearer ${token.current}` } : transport.headers,
      });
      if (generation !== revision.current || !mounted.current) return;
      confirmed = result;
      if (native) {
        const next = result.user && token.current ? JSON.stringify({ token: token.current, user: result.user }) : null;
        await persist(async () => {
          if (generation !== revision.current || !mounted.current) return;
          if (next) await SecureStore.setItemAsync(storageKey, next);
          else await SecureStore.deleteItemAsync(storageKey);
        });
      }
      if (generation !== revision.current || !mounted.current) return;
      if (!result.user) token.current = null;
      setUser(result.user); setOffline(false); setError(null);
    } catch {
      if (generation !== revision.current || !mounted.current) return;
      if (confirmed) {
        // A storage error cannot undo a definitive server sign-out/deletion.
        if (!confirmed.user) token.current = null;
        setUser(confirmed.user); setOffline(false);
        setError('Oturum doğrulandı, ancak cihazdaki oturum kaydı güncellenemedi. Yeniden dene.');
        return;
      }
      // Preserve the securely stored, previously authenticated owner offline.
      // No new account can be created or authenticated from this cache.
      const blocked = !!cached && (jobsUnknown || blockedOwners.includes(cached.user.id));
      setUser(blocked ? null : cached?.user ?? null); setOffline(true);
      if (blocked) token.current = null;
      setError(blocked
        ? 'Hesap silme sonucu henüz doğrulanamadı. Bu hesap çevrimdışı açılmayacak; bağlantı gelince yeniden dene.'
        : 'Bağlantı veya oturum kontrolü tamamlanamadı. Kayıtların korunuyor; yeniden dene.');
    } finally {
      clearTimeout(timer);
      if (generation === revision.current && mounted.current) setLoaded(true);
    }
  }, [persist, setUser, recoverDeletionJobs]);
  useEffect(() => {
    mounted.current = true;
    if (native) setAuthTokenGetter(getToken);
    void restore();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && !busy.current) void restore(); });
    return () => { mounted.current = false; revision.current++; subscription.remove(); if (native) setAuthTokenGetter(null); };
  }, [restore, getToken]);
  const accept = useCallback(async (result: AccountSession) => {
    if (!result.user) throw new Error('Giriş tamamlanamadı. Yeniden dene.');
    if (native) {
      if (!result.token) throw new Error('Oturum kaydı alınamadı. Yeniden giriş yap.');
      await persist(() => SecureStore.setItemAsync(storageKey, JSON.stringify({ token: result.token, user: result.user })));
      token.current = result.token;
    }
    queryClient.clear(); setUser(result.user); setOffline(false); setError(null); setLoaded(true);
    // Old owners' jobs are independent of whoever just signed in.
    await recoverDeletionJobs();
  }, [queryClient, persist, setUser, recoverDeletionJobs]);
  const mutate = useCallback(async (action: () => Promise<AccountSession>) => {
    if (busy.current) return;
    busy.current = true; revision.current++;
    try { await accept(await action()); } finally { busy.current = false; }
  }, [accept]);
  const signOut = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; revision.current++;
    try {
      // Never claim that remote sessions were revoked while offline.
      await logoutAccount(transport);
      if (native) await persist(() => SecureStore.deleteItemAsync(storageKey));
      token.current = null; queryClient.clear(); setUser(null); setOffline(false); setError(null);
    } finally { busy.current = false; }
  }, [queryClient, persist, setUser]);
  const beginDeletion = useCallback(async (owner: string) => {
    if (liveUser.current?.id !== owner || busy.current) throw new Error('Oturum değişti veya başka bir işlem sürüyor.');
    busy.current = true; revision.current++;
    try {
      const requestId = await jobs.current!.prepare(owner);
      if (liveUser.current?.id !== owner) throw new Error('Oturum değişti.');
      return requestId;
    } catch {
      busy.current = false;
      throw new Error('Güvenli silme kaydı cihazına yazılamadı. Hesap silme isteği gönderilmedi.');
    }
  }, []);
  const abortDeletion = useCallback(async (owner: string, requestId: string, serverRejected = true) => {
    try {
      if (serverRejected) await jobs.current!.reject(requestId);
    } catch { setForgetError(cleanupMessage); }
    finally { if (liveUser.current?.id === owner) busy.current = false; }
  }, []);
  const finalizeDeletion = useCallback(async (deletedUserId: string, requestId: string) => {
    // Compare against the LIVE identity: a newer session must never be cleared.
    const ownsSession = liveUser.current?.id === deletedUserId;
    if (ownsSession) {
      busy.current = true; revision.current++;
      token.current = null;
      queryClient.cancelQueries().catch(() => {});
      queryClient.clear(); setUser(null); setOffline(false); setError(null);
    }
    try {
      const result = await recoverDeletionJobs(requestId);
      return !result.unreadable && !result.remaining.some(job => job.owner === deletedUserId);
    } finally { if (ownsSession) busy.current = false; }
  }, [queryClient, recoverDeletionJobs, setUser]);
  const retryForget = useCallback(async () => {
    const result = await recoverDeletionJobs();
    return !result.unreadable && result.remaining.length === 0;
  }, [recoverDeletionJobs]);
  return <C.Provider value={{
    role: user?.role ?? null, finalizeDeletion, beginDeletion, abortDeletion, forgetError, retryForget,
    isLoaded, userId: user?.id ?? null, isSignedIn: !!user && !offline, offline, error, getToken, signOut, retry: restore,
    login: (email, password) => mutate(() => loginAccount({ email: email.trim().toLowerCase(), password }, transport)),
    register: (email, nickname, password, acceptedRules) => mutate(() => registerAccount({ email: email.trim().toLowerCase(), nickname: nickname.trim(), password, acceptedRules }, transport)),
    resetPassword: (challengeId, code, password) => mutate(() => resetAccountPassword({ challengeId, code, password }, transport)),
  }}>{children}</C.Provider>;
}
export function useAuth() {
  const value = useContext(C);
  if (!value) throw new Error('Afilli oturumu hazır değil.');
  return value;
}
