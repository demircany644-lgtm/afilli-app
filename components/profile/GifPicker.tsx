import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import type { MessageGif } from '@workspace/api-client-react';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { useGifPrivacy } from '@/context/DirectMessagesContext';
import { searchGifs } from '@/lib/klipy';
import { PoweredByKlipy } from './GifMessage';

/** Explicit KLIPY disclosure; nothing external loads until the account consents. */
export function GifConsent({ onAccept, onClose }: { onAccept: () => void; onClose?: () => void }) {
  const st = useStStyles();
  return (
    <View style={st.consent}>
      <Text style={st.title}>GIF'ler KLIPY üzerinden gelir</Text>
      <Text style={st.text}>GIF aramak ve göstermek için KLIPY adlı harici bir hizmet kullanılır. KLIPY'ye IP adresin, arama terimlerin ve hesabına bağlı takma bir kimlik iletilir. Mesaj metnin asla paylaşılmaz. İznini istediğin an geri çekebilirsin.</Text>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Pressable testID="gif-consent" accessibilityRole="button" onPress={() => { tap(); onAccept(); }} style={st.primary}>
          <Text style={st.primaryText}>Kabul et ve aç</Text>
        </Pressable>
        {onClose ? <Pressable testID="gif-consent-cancel" accessibilityRole="button" onPress={onClose} style={st.ghost}><Text style={st.ghostText}>Vazgeç</Text></Pressable> : null}
      </View>
      <PoweredByKlipy />
    </View>
  );
}

export function GifPicker({ onPick, onClose }: { onPick: (gif: MessageGif, query: string) => void; onClose: () => void }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const { allowed, setAllowed, customerId } = useGifPrivacy();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MessageGif[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const change = (t: string) => {
    setQ(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (t.trim() === query && page === 1) return;
      setItems([]); setPage(1); setHasMore(false); setQuery(t.trim());
    }, 350);
  };

  useEffect(() => {
    if (!allowed || !customerId) return;
    const ac = new AbortController();
    setLoading(true); setError(null);
    searchGifs(query, page, ac.signal, customerId).then(
      (r) => { if (ac.signal.aborted) return; setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items])); setHasMore(r.hasMore); setLoading(false); },
      (e) => { if (ac.signal.aborted) return; setError(e instanceof Error ? e.message : 'GIF’ler yüklenemedi.'); setLoading(false); },
    );
    return () => ac.abort();
  }, [allowed, customerId, query, page, attempt]);

  const cols = width < 380 ? 2 : 3;
  const cell = Math.floor((Math.min(width, 640) - 28 - (cols - 1) * 6) / cols);

  if (!allowed) return <View style={st.sheet}><GifConsent onAccept={() => setAllowed(true)} onClose={onClose} /></View>;

  return (
    <View style={st.sheet} testID="gif-picker">
      <View style={st.head}>
        <View style={st.search}>
          <Feather name="search" size={15} color={P.muted} />
          <TextInput testID="gif-search" value={q} onChangeText={change} placeholder="Search KLIPY" placeholderTextColor={P.muted}
            style={st.searchInput} maxLength={200} autoCorrect={false} returnKeyType="search" accessibilityLabel="Search KLIPY" />
        </View>
        <Pressable testID="gif-close" accessibilityRole="button" accessibilityLabel="GIF seçiciyi kapat" onPress={onClose} hitSlop={8} style={st.close}>
          <Feather name="x" size={18} color={P.text} />
        </Pressable>
      </View>
      {!customerId ? <Text style={st.text}>GIF için hesap kimliği hazırlanıyor...</Text> : null}
      <FlatList
        data={items} key={cols} numColumns={cols} keyExtractor={(g, i) => g.id + ':' + i} style={{ maxHeight: 300 }}
        columnWrapperStyle={{ gap: 6 }} contentContainerStyle={{ gap: 6, paddingBottom: 6 }} keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (hasMore && !loading && !error) setPage((p) => p + 1); }}
        renderItem={({ item }) => (
          <Pressable testID={'gif-result-' + item.id} accessibilityRole="button" accessibilityLabel={'GIF gönder: ' + (item.title || 'GIF')}
            onPress={() => { tap(); onPick(item, query); }} style={({ pressed }) => [st.cell, { width: cell, height: cell, opacity: pressed ? 0.7 : 1 }]}>
            <Image source={{ uri: item.url }} cachePolicy="none" contentFit="cover" style={{ width: cell, height: cell }} />
          </Pressable>
        )}
        ListEmptyComponent={!loading && !error && customerId ? <Text style={st.text}>{query ? 'Bu arama için GIF bulunamadı.' : 'Sonuç yok.'}</Text> : undefined}
        ListFooterComponent={loading ? (
          <View style={{ flexDirection: 'row', gap: 6 }}>{Array.from({ length: cols }).map((_, i) => <View key={i} style={[st.cell, { width: cell, height: cell, opacity: 0.5 }]} />)}</View>
        ) : error ? (
          <Pressable testID="gif-retry" accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)} style={st.err}>
            <Feather name="refresh-cw" size={14} color={P.danger} />
            <Text style={st.errText}>{error} · Tekrar dene</Text>
          </Pressable>
        ) : undefined}
      />
      <View style={st.foot}>
        <PoweredByKlipy />
        <Pressable testID="gif-withdraw" accessibilityRole="button" onPress={() => { setAllowed(false); onClose(); }} hitSlop={6}>
          <Text style={st.withdraw}>GIF iznini geri çek</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStStyles = makeStyles((t) => {
  const { magazine: P, social: S } = t;
  return StyleSheet.create({
    sheet: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border, backgroundColor: P.background },
    consent: { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
    title: { fontFamily: F.serifBold, fontSize: 16, color: P.text },
    text: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: P.muted, textAlign: 'left', paddingVertical: 4 },
    primary: { minHeight: 42, paddingHorizontal: 16, borderRadius: 21, justifyContent: 'center', backgroundColor: S.bubbleMine },
    primaryText: { fontFamily: F.semi, fontSize: 13, color: S.bubbleMineText },
    ghost: { minHeight: 42, paddingHorizontal: 12, justifyContent: 'center' },
    ghostText: { fontFamily: F.semi, fontSize: 13, color: P.muted },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, paddingHorizontal: 12, minHeight: 40 },
    searchInput: { flex: 1, fontFamily: F.body, fontSize: 14, color: P.text, paddingVertical: 8 },
    close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    cell: { borderRadius: 10, overflow: 'hidden', backgroundColor: P.border },
    err: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
    errText: { fontFamily: F.semi, fontSize: 12, color: P.danger },
    foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    withdraw: { fontFamily: F.semi, fontSize: 11, color: P.muted, textDecorationLine: 'underline' },
  });
});
