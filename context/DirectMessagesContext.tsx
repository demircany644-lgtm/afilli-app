import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { customFetch, getConversations, cleanupDirectMedia, type Conversation } from '@workspace/api-client-react';
import { drainChatPhotoCleanup } from '@/lib/chat-photos';
import { useCommunity } from './CommunityContext';
import { useAuth } from './AuthContext';
import { actorRequest, useOwnerGuard } from '@/components/profile/hooks';
import { eventParser } from '@/lib/direct-message-state';
import { DirectSessionContext as Context, GifPrivacyContext as Privacy, type Connection } from './direct-session';

export function useDirectMessages() { const v = useContext(Context); if (!v) throw new Error('Mesaj sağlayıcısı bulunamadı.'); return v; }
export function useGifPrivacy() { const v = useContext(Privacy); if (!v) throw new Error('GIF sağlayıcısı bulunamadı.'); return v; }

export function DirectMessagesProvider({ children }: { children: React.ReactNode }) {
  const { ready, userId } = useCommunity();
  const { accessMode } = useAuth();
  const owner = ready && accessMode === 'normal' ? userId : null;
  return <AccountMessages key={ready ? owner ?? 'guest' : 'pending'} owner={owner}>{children}</AccountMessages>;
}
function AccountMessages({ owner, children }: { owner: string | null; children: React.ReactNode }) {
  const alive = useOwnerGuard(owner);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(!!owner);
  const [error, setError] = useState<unknown>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [revision, setRevision] = useState(0);
  const [allowed, setAllowed] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [mediaCleanupError, setMediaCleanupError] = useState<string | null>(null);
  const refreshRun = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    if (!owner) return;
    let active = true;
    digestStringAsync(CryptoDigestAlgorithm.SHA256, 'afilli-klipy-v1:' + owner).then(id => { if (active && alive()) setCustomerId(id); }).catch(() => {});
    return () => { active = false; for (const c of controllers.current) c.abort(); controllers.current.clear(); };
  }, [owner, alive]);
  // Opening/foregrounding the app triggers retention, without blocking startup
  // or making an offline device crash. Access is denied at expiry on the server
  // regardless of whether this physical cleanup request can finish.
  useEffect(() => {
    if (!owner) return;
    let disposed = false, current: AbortController | null = null;
    const check = async () => {
      if (disposed || !alive() || AppState.currentState && AppState.currentState !== 'active'
        || Platform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      current?.abort();
      const controller = new AbortController(); current = controller;
      const timeout = setTimeout(() => controller.abort(), 30000);
      let issue: string | null = null;
      try {
        try { await drainChatPhotoCleanup(owner); } catch { issue = 'Cihazdaki fotoğraf temizliği yeniden denenecek.'; }
        for (let batch = 0; batch < 20 && alive() && !controller.signal.aborted; batch++) {
          const result = await cleanupDirectMedia({ ...actorRequest(owner), signal: controller.signal });
          if (result.retryNeeded) issue = 'Medya temizliği yeniden denenecek. Süresi dolan medyaya erişim kapalı.';
          if (!result.hasMore || result.retryNeeded) break;
        }
      } catch { issue = 'Medya temizliği bağlantı kurulunca yeniden denenecek.'; }
      finally { clearTimeout(timeout); if (!disposed && alive() && current === controller) setMediaCleanupError(issue); }
    };
    const state = AppState.addEventListener('change', value => { if (value === 'active') void check(); else current?.abort(); });
    const visibility = () => { if (document.visibilityState === 'visible') void check(); else current?.abort(); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
    void check();
    return () => { disposed = true; current?.abort(); state.remove(); if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility); };
  }, [owner, alive]);
  const refresh = useCallback(async () => {
    if (!owner || !alive()) return;
    if (refreshRun.current) { again.current = true; return refreshRun.current; }
    const run = (async () => {
      do {
        again.current = false;
        const controller = new AbortController(); controllers.current.add(controller);
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const rows = await getConversations({ ...actorRequest(owner), signal: controller.signal });
          if (alive()) { setConversations(rows); setError(null); }
        } catch (e) {
          if (alive()) {
            setError(e);
            if ([401, 403].includes((e as { status?: number }).status ?? 0)) setConversations([]);
          }
        } finally { clearTimeout(timeout); controllers.current.delete(controller); if (alive()) setLoading(false); }
      } while (again.current && alive());
    })();
    refreshRun.current = run;
    try { await run; } finally { if (refreshRun.current === run) refreshRun.current = null; }
  }, [owner, alive]);
  useEffect(() => {
    if (!owner) { setConnection('offline'); return; }
    let disposed = false, attempts = 0;
    let current: AbortController | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let running = false;
    const foreground = () => (AppState.currentState === 'active' || AppState.currentState == null)
      && (Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState !== 'hidden');
    const stop = () => { current?.abort(); clearTimeout(reconnect); clearInterval(watchdog); };
    const start = async () => {
      if (disposed || !alive() || !foreground() || running) return;
      running = true;
      const controller = new AbortController(); current = controller;
      let last = Date.now(), revoked = false;
      setConnection(attempts ? 'reconnecting' : 'connecting');
      watchdog = setInterval(() => { if (Date.now() - last > 45000) controller.abort(); }, 5000);
      try {
        // Explicit SDK-native streaming; do not depend on which global fetch a build installed.
        const response = await customFetch<Response>('/api/message-events', { ...actorRequest(owner), signal: controller.signal,
          headers: { ...actorRequest(owner).headers, Accept: 'text/event-stream' }, cache: 'no-store',
          fetcher: expoFetch as typeof globalThis.fetch, responseType: 'response' });
        if (!response.body) throw new Error('Anlık mesaj akışı açılamadı.');
        const reader = response.body.getReader(), decoder = new TextDecoder();
        const parse = eventParser(event => {
          if (!alive() || disposed || controller.signal.aborted) return;
          last = Date.now();
          if (event.kind === 'revoked') { revoked = true; setConversations([]); setRevision(n => n + 1); setConnection('offline'); controller.abort(); return; }
          attempts = 0; setConnection('live');
          setRevision(n => n + 1);
          void refresh();
        });
        try {
          while (!disposed && alive() && !controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            parse(decoder.decode(value, { stream: true }));
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (e) {
        if ([401, 403].includes((e as { status?: number }).status ?? 0)) { revoked = true; if (alive()) { setConversations([]); setRevision(n => n + 1); } }
      } finally {
        running = false; clearInterval(watchdog);
        if (!disposed && alive() && foreground() && !revoked) {
          setConnection('reconnecting');
          reconnect = setTimeout(() => { void start(); }, Math.min(15000, 700 * 2 ** Math.min(attempts++, 5)));
        } else if (!disposed && alive()) setConnection('offline');
      }
    };
    const resume = () => {
      if (foreground()) { setRevision(n => n + 1); void refresh(); if (!running) void start(); }
      else { stop(); setConnection('offline'); }
    };
    const subscription = AppState.addEventListener('change', resume);
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', resume);
    resume();
    return () => { disposed = true; stop(); subscription.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', resume); };
  }, [owner, alive, refresh]);
  return <Context.Provider value={{ owner, conversations, loading, error, refresh, connection, revision, mediaCleanupError }}>
    <Privacy.Provider value={{ allowed, setAllowed, customerId }}>{children}</Privacy.Provider>
  </Context.Provider>;
}
