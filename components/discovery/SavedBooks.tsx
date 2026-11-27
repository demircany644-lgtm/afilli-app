import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useGetBookCards, getGetBookCardsQueryKey, type DiscoveryBookCard } from '@workspace/api-client-react';
import { makeStyles } from '@/hooks/useTheme';
import { Cover, F, tap } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { useApp } from '@/context/AppContext';
import { actorRequest, scoped } from '@/components/profile/hooks';
import { useWriterPalette, writerPalette } from '@/components/writer/parts';
import { DiscoveryCover, openBook, isUuid } from '@/components/discovery/parts';
import { getBook } from '@/data/catalog';
import { isRealBookId, useSavedBookSetter } from '@/lib/book-subscriptions';

const CHUNK = 30;
type ShelfMode = 'saved' | 'read';

/** Horizontal cover rail for saved and previously read books; missing cards never erase local IDs. */
export function LibraryBookShelf({ title, ids, mode, books = [] }: {
  title: string;
  ids: string[];
  mode: ShelfMode;
  books?: DiscoveryBookCard[];
}) {
  const st = useStyles();
  const W = useWriterPalette();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.round(Math.max(96, Math.min(122, (screenWidth - 56) / 2.65)));
  const cardHeight = Math.round(cardWidth * 1.45);
  const uniqueIds = [...new Set(ids)];
  const [pages, setPages] = useState(1);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const saver = useSavedBookSetter();
  const app = useApp();
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += CHUNK) chunks.push(uniqueIds.slice(i, i + CHUNK));
  const remove = async (id: string) => {
    if (mode === 'saved') {
      if (isRealBookId(id)) {
        if (await saver.set(id, false)) setConfirmId(null);
      } else {
        try { app.setBookSaved(id, false); setConfirmId(null); } catch { /* The account cache remains untouched if it is not ready. */ }
      }
    } else {
      app.removeFromLibrary(id);
      setConfirmId(null);
    }
  };

  return (
    <View style={st.section} testID={mode === 'saved' ? 'library-saved-shelf' : 'library-read-shelf'}>
      <Text style={st.sectionTitle}>{title}</Text>
      {!uniqueIds.length ? (
        <View style={st.empty}>
          <Feather name={mode === 'saved' ? 'bookmark' : 'book-open'} size={20} color={W.gold} />
          <Text style={st.emptyText}>{mode === 'saved' ? 'Henüz kaydettiğin kitap yok.' : 'Henüz okumaya başladığın kitap yok.'}</Text>
          {mode === 'saved' ? (
            <Pressable testID="library-discover" accessibilityRole="link" onPress={() => { tap(); router.push('/search'); }} style={st.discover}>
              <Text style={st.discoverText}>Kitap keşfet</Text><Feather name="arrow-right" size={14} color={W.ink} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" contentContainerStyle={st.rail}>
            {chunks.slice(0, pages).map((chunk) => (
              <ShelfChunk key={chunk.join(',')} ids={chunk} books={books} mode={mode} cardWidth={cardWidth} cardHeight={cardHeight}
                confirmId={confirmId} setConfirmId={setConfirmId} onRemove={remove} busyId={saver.busyId} />
            ))}
          </ScrollView>
          {chunks.length > pages ? (
            <Pressable testID="library-saved-more" accessibilityRole="button" onPress={() => { tap(); setPages((p) => p + 1); }} style={st.more}>
              <Text style={st.moreText}>Daha fazla kitap ({uniqueIds.length - pages * CHUNK})</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {saver.error ? <Text style={st.error} accessibilityLiveRegion="polite">{saver.error.message}</Text> : null}
    </View>
  );
}

export function SavedBooks({ ids }: { ids: string[] }) {
  return <LibraryBookShelf title="Kaydettiklerim" ids={ids} mode="saved" />;
}

function ShelfChunk({ ids, books, mode, cardWidth, cardHeight, confirmId, setConfirmId, onRemove, busyId }: {
  ids: string[];
  books: DiscoveryBookCard[];
  mode: ShelfMode;
  cardWidth: number;
  cardHeight: number;
  confirmId: string | null;
  setConfirmId: (id: string | null) => void;
  onRemove: (id: string) => void;
  busyId: string | null;
}) {
  const st = useStyles();
  const W = useWriterPalette();
  const { ready, userId } = useCommunity();
  const supplied = new Map(books.map((book) => [book.id, book]));
  const lookupIds = ids.filter((id) => isUuid(id) && !supplied.has(id));
  const params = { ids: lookupIds.join(',') };
  const q = useGetBookCards(params, {
    query: { enabled: ready && lookupIds.length > 0, queryKey: scoped(getGetBookCardsQueryKey(params), userId) },
    request: actorRequest(userId),
  });
  const byId = new Map([...supplied, ...(q.data ?? []).map((book) => [book.id, book] as const)]);

  return (
    <View style={st.chunk}>
      {ids.map((id) => {
        const card = byId.get(id);
        const localBook = isUuid(id) ? undefined : getBook(id);
        const cardLoading = isUuid(id) && (!ready || q.isLoading);
        const label = card?.title ?? localBook?.title ?? (q.isError ? 'Kitap bilgisi alınamadı' : cardLoading ? 'Kitap bilgisi yükleniyor' : 'Bu kitap şu anda erişilebilir değil');
        const canRemove = mode === 'saved' || (!isUuid(id) && mode === 'read');
        const detail = confirmId === id ? (
          <View style={st.confirm}>
            <Text style={st.confirmText}>{mode === 'saved' ? 'Bu kitabı kayıtlardan kaldır?' : 'Kitaplık kaydı ve okuma konumu kaldırılır.'}</Text>
            <View style={st.confirmActions}>
              <Pressable testID={'library-remove-cancel-' + id} accessibilityRole="button" accessibilityLabel="Vazgeç" onPress={() => setConfirmId(null)} style={st.confirmButton}>
                <Feather name="x" size={14} color={W.muted} />
              </Pressable>
              <Pressable testID={'library-remove-confirm-' + id} accessibilityRole="button" accessibilityLabel="Kaldır" accessibilityState={{ busy: busyId === id }}
                disabled={!!busyId && busyId !== id} onPress={() => onRemove(id)} style={[st.confirmButton, { backgroundColor: W.soft }]}>
                <Feather name={busyId === id ? 'loader' : 'check'} size={14} color={W.ink} />
              </Pressable>
            </View>
          </View>
        ) : canRemove ? (
          <Pressable testID={'library-remove-' + id} accessibilityRole="button" accessibilityLabel={label + ', kaydı kaldır'} onPress={() => setConfirmId(id)} style={st.remove}>
            <Feather name="bookmark" size={12} color={W.muted} /><Text style={st.removeText}>{mode === 'saved' ? 'Kaldır' : 'Kitaplıktan kaldır'}</Text>
          </Pressable>
        ) : null;
        return (
          <View key={id} style={{ width: cardWidth }}>
            <Pressable testID={'library-' + id} accessibilityRole="button" accessibilityLabel={label + ', kitabın detayını aç'}
              onPress={() => { tap(); if (isRealBookId(id)) openBook(id); else router.push({ pathname: '/book/[id]', params: { id } }); }}
              style={({ pressed }) => [st.book, pressed && { opacity: 0.8 }]}>
              <View style={[st.cover, { width: cardWidth, height: cardHeight }]}>
                {card ? <DiscoveryCover card={card} w={cardWidth} h={cardHeight} /> : localBook ? <Cover book={localBook} w={cardWidth} h={cardHeight} /> : (
                  <View style={[st.unavailable, { width: cardWidth, height: cardHeight }]}>
                    <Feather name={q.isError ? 'cloud-off' : 'book-open'} size={20} color={W.muted} />
                    <Text style={st.unavailableText}>{label}</Text>
                  </View>
                )}
              </View>
              <Text style={st.bookTitle} numberOfLines={2}>{label}</Text>
              {card ? <Text style={st.author} numberOfLines={1}>{card.author.nickname}</Text> : null}
            </Pressable>
            {detail}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    section: { marginTop: 4, marginBottom: 22 },
    sectionTitle: { fontFamily: F.serifBold, fontSize: 21, color: W.ink, marginHorizontal: 18, marginBottom: 10 },
    rail: { paddingHorizontal: 18, gap: 12, paddingBottom: 6 },
    chunk: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    book: { alignItems: 'flex-start' },
    cover: { overflow: 'hidden', borderRadius: 7, borderWidth: 1, borderColor: W.border, backgroundColor: W.paper },
    bookTitle: { width: '100%', marginTop: 7, fontFamily: F.semi, fontSize: 12.5, lineHeight: 17, color: W.ink },
    author: { width: '100%', marginTop: 2, fontFamily: F.body, fontSize: 11, color: W.muted },
    unavailable: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10, backgroundColor: W.card },
    unavailableText: { fontFamily: F.body, fontSize: 10.5, color: W.muted, textAlign: 'center' },
    remove: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 5, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4 },
    removeText: { fontFamily: F.body, fontSize: 11, color: W.muted },
    confirm: { marginTop: 4, padding: 6, borderRadius: 9, backgroundColor: W.card, borderWidth: 1, borderColor: W.border },
    confirmText: { fontFamily: F.body, fontSize: 10.5, color: W.ink, marginBottom: 4 },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
    confirmButton: { minWidth: 32, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: W.border },
    empty: { marginHorizontal: 18, padding: 16, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: W.border, alignItems: 'center', gap: 8 },
    emptyText: { fontFamily: F.body, fontSize: 13, color: W.muted, textAlign: 'center' },
    discover: { padding: 5, flexDirection: 'row', alignItems: 'center', gap: 6 },
    discoverText: { fontFamily: F.semi, fontSize: 13, color: W.ink },
    more: { alignSelf: 'center', padding: 12 },
    moreText: { fontFamily: F.med, fontSize: 13, color: W.ink, textDecorationLine: 'underline' },
    error: { marginHorizontal: 18, marginTop: 4, fontFamily: F.body, fontSize: 12, color: W.danger },
  });
});
