import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { getMyProfile, updatePresence, setAuthTokenGetter, type CommunityPerson } from '@workspace/api-client-react';
import { setLiveProgressOwner } from '@/lib/reading-progress';
import { CommunityContext } from './community-session';

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, userId, getToken, signOut: endSession } = useAuth();
  const queryClient = useQueryClient();
  const [transportIdentity, setTransportIdentity] = useState<string | null | undefined>(undefined);
  const transportReady = !!isLoaded && transportIdentity === userId;
  const [person, setPerson] = useState<CommunityPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previous = useRef<string | null | undefined>(undefined);
  const currentIdentity = useRef(userId); currentIdentity.current = userId;
  useEffect(() => { setLiveProgressOwner(transportReady ? userId : null); }, [transportReady, userId]);

  useEffect(() => {
    const owner = userId;
    if (Platform.OS !== 'web') setAuthTokenGetter(async () => {
      const token = await getToken();
      if (currentIdentity.current !== owner) throw new Error('Hesabın değişti. Yeniden dene.');
      return token;
    });
    if (previous.current !== undefined && previous.current !== userId) {
      queryClient.clear();
      setPerson(null);
    }
    previous.current = userId;
    setTransportIdentity(userId);
    return () => { if (Platform.OS !== 'web') setAuthTokenGetter(null); };
  }, [getToken, isLoaded, userId, queryClient]);

  useEffect(() => {
    if (!transportReady || !userId) { setPerson(null); return; }
    let active = true;
    getMyProfile().then((profile) => {
      if (active) { setPerson(profile); setError(null); }
    }).catch(() => { if (active) setError('Bağlantı yok, tekrar dene. Profil bilgilerin eşitlenemedi.'); });
    return () => { active = false; };
  }, [transportReady, userId]);
  const refreshProfile = useCallback(async () => {
    const owner = userId;
    if (!owner || !transportReady) return;
    const profile = await getMyProfile();
    if (currentIdentity.current === owner) { setPerson(profile); setError(null); }
  }, [userId, transportReady]);
  useEffect(() => {
    if (!transportReady || !userId) return;
    const owner = userId;
    const isForeground = () => AppState.currentState === 'active' && (Platform.OS !== 'web' || document.visibilityState === 'visible');
    const heartbeat = () => {
      if (currentIdentity.current !== owner) return;
      void updatePresence({ active: isForeground() }, { headers: { 'X-Afilli-Actor': owner } }).catch(() => {});
    };
    heartbeat();
    const timer = setInterval(heartbeat, 25_000);
    const subscription = AppState.addEventListener('change', heartbeat);
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', heartbeat);
    return () => {
      clearInterval(timer); subscription.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', heartbeat);
    };
  }, [transportReady, userId]);

  return (
    <CommunityContext.Provider value={{
      ready: transportReady, userId: userId ?? null, person: transportReady ? person : null, error, refreshProfile,
      signOut: async (redirectTo = '/profile') => {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 1800);
        try {
          if (userId) await updatePresence({ active: false }, { headers: { 'X-Afilli-Actor': userId }, signal: controller.signal }).catch(() => {});
        } finally { clearTimeout(timeout); }
        await endSession(); setPerson(null); queryClient.clear();
      },
    }}>
      <React.Fragment key={userId ?? 'guest'}>{children}</React.Fragment>
    </CommunityContext.Provider>
  );
}
export function useCommunity() {
  const session = useContext(CommunityContext);
  if (!session) throw new Error('Topluluk oturumu bulunamadı.');
  return session;
}
