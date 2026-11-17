import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import {
  getAccountSession, loginAccount, registerAccount, logoutAccount, resetAccountPassword,
  setAuthTokenGetter, type AccountSession, type AccountUser,
} from '@workspace/api-client-react';

const native = Platform.OS !== 'web';
const storageKey = 'afilli_account_session_v1';
const headers: Record<string, string> = native ? { 'X-Afilli-Client': 'native' } : {};
const transport = { credentials: 'include' as const, headers };
type Session = {
  isLoaded: boolean; userId: string | null; isSignedIn: boolean; offline: boolean; error: string | null;
  getToken: () => Promise<string | null>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, nickname: string, password: string, acceptedRules: true) => Promise<void>;
  resetPassword: (challengeId: string, code: string, password: string) => Promise<void>;
  signOut: () => Promise<void>; retry: () => Promise<void>;
};
const C = createContext<Session | null>(null);
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
  const [user, setUser] = useState<AccountUser | null>(null);
  const [isLoaded, setLoaded] = useState(false), [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const revision = useRef(0), busy = useRef(false);
  const mounted = useRef(true);
  const storageQueue = useRef(Promise.resolve());
  const persist = useCallback((operation: () => Promise<void>) => {
    const result = storageQueue.current.then(operation);
    storageQueue.current = result.catch(() => {});
    return result;
  }, []);
  const getToken = useCallback(async () => native ? token.current : null, []);
  const restore = useCallback(async () => {
    const generation = ++revision.current;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    let cached: SavedSession | null = null;
    try {
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
      // Preserve the securely stored, previously authenticated owner offline.
      // No new account can be created or authenticated from this cache.
      setUser(cached?.user ?? null); setOffline(true);
      setError('Bağlantı veya oturum kontrolü tamamlanamadı. Kayıtların korunuyor; yeniden dene.');
    } finally {
      clearTimeout(timer);
      if (generation === revision.current && mounted.current) setLoaded(true);
    }
  }, [persist]);
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
  }, [queryClient, persist]);
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
  }, [queryClient, persist]);
  return <C.Provider value={{
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
