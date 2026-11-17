import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { WRITER_CHAT_SCRIPT, WRITER_CHAT_URL } from '@/lib/writer-chat';
import { StateCard } from '@/components/profile/kit';
import { useColors } from '@/hooks/useColors';

export function WriterChatFrame() {
  const c = useColors();
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const timeout = window.setTimeout(() => setFailed(true), 25000);
    let frame: HTMLIFrameElement | null = null;
    const load = () => { window.clearTimeout(timeout); setLoaded(true); };
    const observeFrame = () => {
      const next = container.current?.querySelector('iframe') ?? null;
      if (!next || next === frame) return;
      frame?.removeEventListener('load', load);
      frame = next;
      frame.title = 'Yazar sohbeti — Minnit Chat';
      frame.addEventListener('load', load);
    };
    const observer = new MutationObserver(observeFrame);
    if (container.current) observer.observe(container.current, { childList: true, subtree: true });
    observeFrame();
    const id = 'afilli-minnit-embed-script';
    let script = document.getElementById(id) as HTMLScriptElement | null;
    const error = () => setFailed(true);
    if (!script) {
      script = document.createElement('script');
      script.id = id;
      script.src = WRITER_CHAT_SCRIPT;
      script.defer = true;
      script.addEventListener('load', () => { script!.dataset.loaded = 'true'; }, { once: true });
      script.addEventListener('error', error);
      document.body.appendChild(script);
    } else script.addEventListener('error', error);
    // Minnit's single script owns the iframe handshake and its storage. Reuse it
    // on re-entry rather than adding duplicate message handlers and intervals.
    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
      frame?.removeEventListener('load', load);
      script?.removeEventListener('error', error);
    };
  }, [attempt]);
  if (failed) return <StateCard icon="wifi-off" title="Yazar sohbeti açılamadı"
    text="İnternet bağlantını kontrol et. Sohbet Minnit tarafından sağlanıyor."
    action={{ label: 'Tekrar dene', testID: 'writer-chat-retry', onPress: () => {
      const script = document.getElementById('afilli-minnit-embed-script') as HTMLScriptElement | null;
      if (script?.dataset.loaded !== 'true') script?.remove();
      setLoaded(false); setFailed(false); setAttempt(n => n + 1);
    } }} />;
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }} aria-label="Yazar sohbeti — Minnit Chat">
      <div key={attempt} ref={container} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', lineHeight: 0 }}>
        <span style={{ display: 'none' }} className="minnit-chat-sembed" data-chatname={WRITER_CHAT_URL}
          data-style="position:absolute;inset:0;display:block;width:100%;height:100%;" data-version="1.56">Chat</span>
        {!loaded ? <div role="status" aria-label="Yazar sohbeti yükleniyor" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.background }}>
          <ActivityIndicator color={c.brown} />
        </div> : null}
      </div>
      <p style={{ margin: 0, padding: 5, fontSize: 13, color: c.writerChatLabel, textAlign: 'center' }}>
        afilli chat
      </p>
    </div>
  );
}
