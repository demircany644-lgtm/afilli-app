import React, { useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { BookRow } from '@/components/BookList';
import { Empty, webBottom } from '@/components/ui';
import { BOOKS, HOME_SECTIONS, trNorm } from '@/data/catalog';
import { useGetPublishedBooks, getGetPublishedBooksQueryKey } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { actorRequest, scoped } from '@/components/profile/hooks';
import { mediaUrl } from '@/components/bulletins/common';

export default function Search() {
  const { section: raw } = useLocalSearchParams<{ section?: string }>();
  const section = HOME_SECTIONS.find((item) => item.id === raw);
  return <Discovery key={section?.id ?? 'all'} section={section} />;
}

function Discovery({ section }: { section?: (typeof HOME_SECTIONS)[number] }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const { ready, userId } = useCommunity();
  const published = useGetPublishedBooks({ query: { enabled: ready, queryKey: scoped(getGetPublishedBooksQueryKey(), userId) }, request: actorRequest(userId) });
  const results = useMemo(() => {
    const n = trNorm(q);
    const candidates = section ? BOOKS.filter((b) => section.ids.some((id) => id === b.id)) : BOOKS;
    return candidates.filter((b) => [b.title, b.author, b.alias, b.genre].some((f) => trNorm(f).includes(n)));
  }, [q, section]);
  const communityResults = useMemo(() => {
    const n = trNorm(q);
    const items = (published.data ?? []).filter((b) => [b.title, b.author.nickname, ...(b.genres ?? [])].some((f) => trNorm(f).includes(n)));
    if (section?.id === 'oneriler') return [...items].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));
    if (section) return [...items].sort((a, b) => (b.readCount ?? 0) - (a.readCount ?? 0));
    return items;
  }, [q, published.data, section]);
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[s.bar, { paddingTop: (Platform.OS === 'web' ? 67 : ins.top) + 8 }]}>
        <View style={[s.field, { backgroundColor: c.paper, borderColor: c.gold }]}>
          <Feather name="search" size={18} color={c.gold} />
          <TextInput testID="search-input" autoFocus={!section} value={q} onChangeText={setQ} placeholder="Kitap, yazar veya tür" placeholderTextColor={c.mutedForeground}
            style={[s.in, { color: c.brown }]} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel="Ara" />
          {!!q && <Pressable testID="search-clear" accessibilityLabel="Temizle" hitSlop={8} onPress={() => setQ('')}><Feather name="x-circle" size={18} color={c.mutedForeground} /></Pressable>}
        </View>
        <Pressable testID="search-cancel" accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={8}>
          <Text style={[s.cancel, { color: c.brown }]}>Vazgeç</Text>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 8, paddingBottom: 30 + webBottom }}>
        <Text testID="discovery-title" style={[s.heading, { color: c.brown }]}>{section?.title ?? 'Kitapları Keşfet'}</Text>
        {section ? <Pressable testID="discovery-all" accessibilityRole="button" onPress={() => router.setParams({ section: undefined })} style={{ marginHorizontal: 20, marginBottom: 14 }}><Text style={{ color: c.gold, fontFamily: 'Inter_500Medium' }}>Tüm kitaplarda ara</Text></Pressable> : null}
        <Text style={[s.h, { color: c.mutedForeground }]}>{q ? (results.length + communityResults.length) + ' sonuç' : 'Örnek okuma seçkisi'}</Text>
        {results.length === 0 && communityResults.length === 0 ? <Empty icon="search" title="Sonuç bulunamadı" text={'"' + q + '" için eşleşen kitap, yazar veya tür yok.'} />
          : results.map((b) => <BookRow key={b.id} book={b} testID={'result-' + b.id} />)}
        <Text style={[s.h, { color: c.mutedForeground, marginTop: 14 }]}>Topluluğun Yayınladıkları</Text>
        {published.isError ? <View style={s.notice}><Text style={{ color: c.destructive }}>Topluluk kitapları alınamadı. Örnek seçki kullanılabilir.</Text><Pressable testID="discovery-retry" accessibilityRole="button" onPress={() => void published.refetch()}><Text style={{ color: c.gold }}>Tekrar dene</Text></Pressable></View>
          : published.isLoading || !ready ? <Text style={[s.notice, { color: c.mutedForeground }]}>Kitaplar yükleniyor…</Text>
          : communityResults.length === 0 ? <Text style={[s.notice, { color: c.mutedForeground }]}>{q ? 'Bu aramayla eşleşen topluluk kitabı yok.' : 'Henüz yayınlanmış topluluk kitabı yok.'}</Text>
          : communityResults.map((b) => <Pressable key={b.id} testID={'published-result-' + b.id} accessibilityRole="button" accessibilityLabel={b.title + ', ' + b.author.nickname} onPress={() => router.push({ pathname: '/authored-book/[id]', params: { id: b.id } })} style={[s.published, { backgroundColor: c.paper, borderColor: c.border }]}>
            {b.coverUrl ? <Image source={{ uri: mediaUrl(b.coverUrl) }} style={{ width: 52, height: 74, borderRadius: 4 }} /> : <Feather name="book-open" size={34} color={c.gold} />}
            <View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.brown, fontFamily: 'PlayfairDisplay_700Bold', fontSize: 16 }}>{b.title}</Text><Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12 }}>{b.author.nickname}</Text><Text style={{ color: c.gold, fontSize: 12 }}>{b.genres?.join(' · ')}</Text></View>
            <Feather name="chevron-right" size={18} color={c.mutedForeground} />
          </Pressable>)}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  heading: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, marginHorizontal: 20, marginBottom: 12 },
  notice: { marginHorizontal: 20, marginBottom: 16, gap: 8, fontFamily: 'Inter_400Regular' },
  published: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 12, marginHorizontal: 18, marginBottom: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, height: 44 },
  in: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, height: 44 },
  cancel: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  h: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginHorizontal: 20, marginBottom: 10 },
});
