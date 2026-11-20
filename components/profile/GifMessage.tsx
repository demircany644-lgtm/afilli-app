import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import type { MessageGif } from '@workspace/api-client-react';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { useGifPrivacy } from '@/context/DirectMessagesContext';

export const KLIPY_URL = 'https://klipy.com';

export function PoweredByKlipy({ testID = 'klipy-attribution' }: { testID?: string }) {
  const st = useStStyles();
  return (
    <Pressable testID={testID} accessibilityRole="link" accessibilityLabel="Powered by KLIPY" hitSlop={6}
      onPress={() => { Linking.openURL(KLIPY_URL).catch(() => {}); }}>
      <Text style={st.powered}>Powered by KLIPY</Text>
    </Pressable>
  );
}

/**
 * Receiver-side GIF. Never touches the KLIPY CDN until this account has opted in;
 * the provider forbids caching, so cachePolicy is 'none' and nothing is prefetched.
 */
export function GifMessage({ gif, maxW = 220, compact }: { gif: MessageGif; maxW?: number; compact?: boolean }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const { allowed, setAllowed } = useGifPrivacy();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [asking, setAsking] = useState(false);
  const w = compact ? Math.min(96, maxW) : maxW;
  const ratio = gif.width > 0 && gif.height > 0 ? gif.height / gif.width : 1;
  const h = Math.max(48, Math.min(Math.round(w * ratio), compact ? 96 : 280));
  const label = gif.title ? 'GIF: ' + gif.title : 'GIF';

  if (!allowed) {
    return (
      <View style={[st.locked, { width: w, minHeight: compact ? 48 : 96 }]}>
        <Pressable testID={'gif-enable-' + gif.id} accessibilityRole="button" accessibilityLabel={label + '. GIF bilgilerini göster'}
          onPress={() => { tap(); setAsking(true); }}>
        <Feather name="image" size={compact ? 14 : 18} color={P.muted} />
        <Text style={st.lockedTitle} numberOfLines={compact ? 1 : 2}>{gif.title || 'GIF'}</Text>
        {!compact && !asking ? <Text style={st.lockedText}>GIF gizli. Harici hizmet bilgilerini görmek için dokun.</Text> : null}
        </Pressable>
        {asking ? <>
          <Text style={st.lockedText}>GIF'ler KLIPY'den gelir. Açarsan IP adresin; arama yaptığında arama terimlerin ve takma hesap kimliğin KLIPY'ye iletilir. Mesaj metnin paylaşılmaz. GIF seçicisinden iznini geri çekebilirsin.</Text>
          <Pressable testID="gif-consent" accessibilityRole="button" accessibilityLabel="Kabul et ve göster" onPress={() => setAllowed(true)} style={{ paddingVertical: 10 }}>
            <Text style={st.lockedTitle}>Kabul et ve göster</Text>
          </Pressable>
        </> : null}
      </View>
    );
  }
  return (
    <View style={{ width: w, gap: 3 }}>
      <View style={[st.frame, { width: w, height: h }]}>
        <Image key={attempt} source={{ uri: gif.url }} cachePolicy="none" contentFit="cover" style={{ width: w, height: h }}
          accessibilityLabel={label} onLoad={() => setState('ok')} onError={() => setState('error')} />
        {state === 'loading' ? <View style={[StyleSheet.absoluteFill, st.overlay]}><Text style={st.lockedText}>Yükleniyor...</Text></View> : null}
        {state === 'error' ? (
          <Pressable testID={'gif-retry-' + gif.id} accessibilityRole="button" accessibilityLabel="GIF yüklenemedi, tekrar dene"
            onPress={() => { setState('loading'); setAttempt((n) => n + 1); }} style={[StyleSheet.absoluteFill, st.overlay]}>
            <Feather name="refresh-cw" size={16} color={P.muted} />
            <Text style={st.lockedText}>Yüklenemedi · Tekrar dene</Text>
          </Pressable>
        ) : null}
      </View>
      {!compact ? <PoweredByKlipy testID={'gif-attribution-' + gif.id} /> : null}
    </View>
  );
}

const useStStyles = makeStyles((t) => {
  const { magazine: P } = t;
  return StyleSheet.create({
    powered: { fontFamily: F.semi, fontSize: 10, letterSpacing: 0.4, color: P.muted, textDecorationLine: 'underline' },
    locked: { borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: P.border, backgroundColor: P.card, padding: 10, gap: 4, alignItems: 'flex-start', justifyContent: 'center' },
    lockedTitle: { fontFamily: F.semi, fontSize: 13, color: P.text },
    lockedText: { fontFamily: F.body, fontSize: 11, lineHeight: 15, color: P.muted, textAlign: 'center' },
    frame: { borderRadius: 14, overflow: 'hidden', backgroundColor: P.border },
    overlay: { alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8, backgroundColor: P.card },
  });
});
