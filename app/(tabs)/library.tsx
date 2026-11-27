import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { makeStyles } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
  useGetWriterLibrary, getGetWriterLibraryQueryKey, useGetReaderReadBooks, getGetReaderReadBooksQueryKey,
  useGetDiscoveryBooks, getGetDiscoveryBooksQueryKey, type WriterSummary, type DiscoveryBookCard,
} from '@workspace/api-client-react';
import { useApp } from '@/context/AppContext';
import { useCommunity } from '@/context/CommunityContext';
import { TabTitle } from '@/components/TabTitle';
import { F, tap } from '@/components/ui';
import { Btn, apiError } from '@/components/bulletins/common';
import { scoped, actorRequest, withIdentity } from '@/components/profile/hooks';
import { listRecords, type WriterRecord } from '@/lib/writer-store';
import { useWriterPalette, writerPalette, Segmented, Skeleton, Banner } from '@/components/writer/parts';
import { ShelfRow } from '@/components/writer/WriterShelf';
import { LibraryBookShelf } from '@/components/discovery/SavedBooks';
import { DiscoveryCover, openBook } from '@/components/discovery/parts';
import { FEATURED_BOOK_INTERVAL_MS, featuredBookIndex } from '@/lib/library';

type Tab = 'reading' | 'mine' | 'published' | 'drafts';

function Library() {
  const W = useWriterPalette();
  const s = useSStyles();
  const { library, saved, ready: shelfReady, storageError } = useApp();
  const { ready, userId } = useCommunity();
  const owner = ready ? userId ?? 'guest' : null;
  const [tab, setTab] = useState<Tab>('reading');
  const lib = useGetWriterLibrary({ query: { enabled: ready && !!userId && tab !== 'reading', queryKey: scoped(getGetWriterLibraryQueryKey(), userId) }, request: actorRequest(userId) });
  const readBooks = useGetReaderReadBooks({ query: {
    enabled: ready && !!userId && tab === 'reading',
    queryKey: scoped(getGetReaderReadBooksQueryKey(), userId),
    refetchOnWindowFocus: true,
  }, request: actorRequest(userId) });
  const [local, setLocal] = useState<WriterRecord[] | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    if (!owner) return;
    let on = true;
    listRecords(owner).then((l) => { if (on) { setLocal(l.records); setLocalErr(null); } }).catch((e: Error) => { if (on) setLocalErr(e.message); });
    return () => { on = false; };
  }, [owner]));

  const remoteReadBooks = readBooks.data ?? [];
  const readIds = [...new Set([...remoteReadBooks.map((book) => book.id), ...Object.keys(library)])];
  const map = new Map<string, { rec?: WriterRecord; sum?: WriterSummary }>();
  (local ?? []).forEach((r) => map.set(r.id, { rec: r }));
  (lib.data ?? []).forEach((s) => map.set(s.id, { ...(map.get(s.id) ?? {}), sum: s }));
  const rows = [...map.entries()].filter(([, x]) => {
    const pub = (x.rec?.publication ?? x.sum?.publication) === 'published';
    return tab === 'mine' || (tab === 'published' ? pub : !pub);
  });
  const loadingMine = local === null || (!!userId && lib.isLoading);

  return (
    <View style={{ flex: 1, backgroundColor: W.cream }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <TabTitle title="Kitaplarım" sub={tab === 'reading' ? 'Kaydettiklerin, okudukların ve öne çıkan kitaplar.' : 'Yazdığın kitaplar, taslaklar ve yayındakiler.'} />
        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
          <Segmented<Tab> testID="library-tabs" value={tab} onChange={setTab}
            options={[{ v: 'reading', label: 'Kitaplığım' }, { v: 'mine', label: 'Yazdıklarım' }, { v: 'published', label: 'Yayınlananlar' }, { v: 'drafts', label: 'Taslaklar' }]} />
        </View>
        {storageError ? <Banner icon="alert-triangle" tone="err" title="Kitaplık kaydı doğrulanamadı" text={storageError} /> : null}
        {tab === 'reading' ? (!shelfReady ? <View style={{ gap: 12, padding: 16 }}><Skeleton h={100} /><Skeleton h={100} /></View> : <>
          <LibraryBookShelf key={'saved:' + saved.join(',')} title="Kaydettiklerim" ids={saved} mode="saved" />
          <LibraryBookShelf key={'read:' + readIds.join(',')} title="Okuduklarım" ids={readIds} mode="read" books={remoteReadBooks} />
          {userId && readBooks.isError ? <Banner icon="cloud-off" tone="warn" title="Okuma geçmişin alınamadı" text={apiError(readBooks.error, 'Kayıtların silinmedi.')}><Btn label="Tekrar dene" ghost onPress={() => void readBooks.refetch()} /></Banner> : null}
          <RankedBookShelf title="En Çok Okunan Kitap" sort="read" enabled={tab === 'reading'} />
          <RotatingLatestBookShelf enabled={tab === 'reading'} />
        </>) : (
          <>
            {localErr ? <Banner icon="alert-triangle" tone="err" title="Cihazdaki kitaplar okunamadı" text={localErr + ' Kayıtlar silinmedi.'} /> : null}
            {userId && lib.isError ? <Banner icon="cloud-off" tone="warn" title="Bulut kitapların alınamadı" text={apiError(lib.error, 'Sunucuya ulaşılamadı.')}><Btn label="Tekrar dene" ghost onPress={() => void lib.refetch()} /></Banner> : null}
            {!userId ? <Text style={s.note}>Misafir olarak yalnızca bu cihazdaki kitapların görünür.</Text> : null}
            {loadingMine ? <View style={{ gap: 10, padding: 16 }}><Skeleton h={96} /><Skeleton h={96} /></View>
              : rows.length === 0 ? (
                <View style={s.empty}>
                  <Feather name={tab === 'published' ? 'send' : 'feather'} size={26} color={W.gold} />
                  <Text style={s.emptyTitle}>{tab === 'published' ? 'Henüz yayında kitabın yok' : tab === 'drafts' ? 'Taslağın yok' : 'Henüz bir kitap yazmadın'}</Text>
                  <Btn label="Kitap Yaz" icon="edit-3" testID="library-write" onPress={() => router.navigate('/write')} />
                </View>
              ) : rows.map(([id, x]) => {
                const pub = (x.rec?.publication ?? x.sum?.publication) === 'published';
                return <ShelfRow key={id} id={id} rec={x.rec} sum={x.sum}
                  owner={owner}
                  onCopied={copyId => { void lib.refetch(); router.push({ pathname: '/write', params: { book: copyId } }); }}
                  onPress={() => pub ? router.push({ pathname: '/authored-book/[id]', params: { id } }) : router.push({ pathname: '/write', params: { book: id } })} />;
              })}
          </>
        )}
      </ScrollView>
    </View>
  );
}
export default withIdentity(Library);

function RankedBookShelf({ title, sort, enabled }: { title: string; sort: 'read'; enabled: boolean }) {
  const st = useShelfStyles();
  const { ready, userId } = useCommunity();
  const params = { sort } as const;
  const q = useGetDiscoveryBooks(params, {
    query: {
      enabled: ready && enabled,
      queryKey: scoped(getGetDiscoveryBooksQueryKey(params), userId),
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
    request: actorRequest(userId),
  });
  const book = q.data?.items[0];
  return (
    <View style={st.section} testID="library-most-read">
      <Text style={st.sectionTitle}>{title}</Text>
      {q.isLoading ? <View style={{ paddingHorizontal: 18 }}><Skeleton h={160} /></View>
        : q.isError ? <View style={st.empty}><Text style={st.emptyText}>Kitap listesi şu anda alınamadı.</Text><Btn label="Tekrar dene" ghost onPress={() => void q.refetch()} /></View>
          : book ? <FeaturedBookCard card={book} note={`${book.readCount.toLocaleString('tr-TR')} okuma`} testID="library-most-read-book" />
            : <Text style={st.emptyText}>Henüz yayımlanmış kitap yok.</Text>}
    </View>
  );
}

function RotatingLatestBookShelf({ enabled }: { enabled: boolean }) {
  const st = useShelfStyles();
  const { ready, userId } = useCommunity();
  const firstParams = { sort: 'new' } as const;
  const first = useGetDiscoveryBooks(firstParams, {
    query: {
      enabled: ready && enabled,
      queryKey: scoped(getGetDiscoveryBooksQueryKey(firstParams), userId),
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
    request: actorRequest(userId),
  });
  const [cursor, setCursor] = useState<string | undefined>();
  const [laterBooks, setLaterBooks] = useState<DiscoveryBookCard[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const head = first.data?.items[0];
  const headKey = first.data ? head?.id ?? '' : undefined;
  const priorHead = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (headKey === undefined) return;
    if (priorHead.current !== undefined && priorHead.current !== headKey) {
      setLaterBooks([]);
      setCursor(undefined);
    }
    priorHead.current = headKey;
  }, [headKey]);

  const pageParams = cursor ? { sort: 'new' as const, cursor } : firstParams;
  const page = useGetDiscoveryBooks(pageParams, {
    query: {
      enabled: ready && enabled && !!cursor,
      queryKey: scoped(getGetDiscoveryBooksQueryKey(pageParams), userId),
      refetchOnWindowFocus: true,
    },
    request: actorRequest(userId),
  });
  useEffect(() => {
    if (!cursor || page.isFetching || !page.data) return;
    setLaterBooks((current) => {
      const seen = new Set([...(first.data?.items ?? []), ...current].map((book) => book.id));
      const added = page.data.items.filter((book) => !seen.has(book.id));
      return added.length ? [...current, ...added] : current;
    });
  }, [cursor, page.data, page.isFetching, first.data?.items]);

  const books = [...(first.data?.items ?? []), ...laterBooks];
  const index = head ? featuredBookIndex(head.publishedAt, now) : 0;
  const nextCursor = cursor ? page.data?.nextCursor : first.data?.nextCursor;
  const selected = books[index] ?? (!nextCursor && !page.isFetching ? books[books.length - 1] : undefined);
  useEffect(() => {
    if (!enabled || !ready || !head || index < books.length || !nextCursor || page.isFetching || nextCursor === cursor) return;
    setCursor(nextCursor);
  }, [enabled, ready, head, index, books.length, nextCursor, page.isFetching, cursor]);

  useEffect(() => {
    if (!head) return;
    const start = Date.parse(head.publishedAt);
    if (!Number.isFinite(start)) return;
    const nextAt = start + (index + 1) * FEATURED_BOOK_INTERVAL_MS;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(10, nextAt - Date.now() + 25));
    return () => clearTimeout(timer);
  }, [head?.id, head?.publishedAt, index]);

  return (
    <View style={st.section} testID="library-latest">
      <Text style={st.sectionTitle}>Son Yazılan Kitap</Text>
      {first.isLoading ? <View style={{ paddingHorizontal: 18 }}><Skeleton h={160} /></View>
        : first.isError ? <View style={st.empty}><Text style={st.emptyText}>Kitap listesi şu anda alınamadı.</Text><Btn label="Tekrar dene" ghost onPress={() => void first.refetch()} /></View>
          : !head ? <Text style={st.emptyText}>Henüz yayımlanmış kitap yok.</Text>
            : page.isError && !selected ? <View style={st.empty}><Text style={st.emptyText}>Sıradaki kitap alınamadı.</Text><Btn label="Tekrar dene" ghost onPress={() => void page.refetch()} /></View>
              : selected ? <FeaturedBookCard card={selected} note={`Yayımlandı ${new Date(selected.publishedAt).toLocaleDateString('tr-TR')}`} testID="library-latest-book" />
                : <View style={{ paddingHorizontal: 18 }}><Skeleton h={160} /></View>}
    </View>
  );
}

function FeaturedBookCard({ card, note, testID }: { card: DiscoveryBookCard; note: string; testID: string }) {
  const st = useShelfStyles();
  const W = useWriterPalette();
  const { width } = useWindowDimensions();
  const coverWidth = Math.round(Math.max(100, Math.min(126, (width - 54) / 2.7)));
  const coverHeight = Math.round(coverWidth * 1.45);
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${card.title}, ${card.author.nickname}, kitabın detayını aç`}
      onPress={() => { tap(); openBook(card.id); }} style={({ pressed }) => [st.featureCard, pressed && { opacity: 0.82 }]}>
      <View style={[st.featureCover, { width: coverWidth, height: coverHeight }]}>
        <DiscoveryCover card={card} w={coverWidth} h={coverHeight} />
      </View>
      <View style={st.featureInfo}>
        <Text style={st.featureTitle} numberOfLines={3}>{card.title}</Text>
        <Text style={st.featureAuthor} numberOfLines={1}>{card.author.nickname}</Text>
        <View style={st.featureNote}>
          <Feather name={testID === 'library-most-read-book' ? 'eye' : 'calendar'} size={13} color={W.gold} />
          <Text style={st.featureNoteText} numberOfLines={2}>{note}</Text>
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={W.muted} />
    </Pressable>
  );
}

const useShelfStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    section: { marginTop: 4, marginBottom: 22 },
    sectionTitle: { fontFamily: F.serifBold, fontSize: 21, color: W.ink, marginHorizontal: 18, marginBottom: 10 },
    featureCard: { marginHorizontal: 18, padding: 10, borderRadius: 17, borderWidth: 1, borderColor: W.border, backgroundColor: W.card, flexDirection: 'row', alignItems: 'center', gap: 13 },
    featureCover: { overflow: 'hidden', borderRadius: 6, borderWidth: 1, borderColor: W.border },
    featureInfo: { flex: 1, gap: 6 },
    featureTitle: { fontFamily: F.serifBold, fontSize: 17, lineHeight: 22, color: W.ink },
    featureAuthor: { fontFamily: F.body, fontSize: 12.5, color: W.muted },
    featureNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
    featureNoteText: { flex: 1, fontFamily: F.med, fontSize: 11.5, color: W.muted },
    empty: { marginHorizontal: 18, padding: 15, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: W.border, alignItems: 'center', gap: 8 },
    emptyText: { marginHorizontal: 18, fontFamily: F.body, fontSize: 13, color: W.muted, textAlign: 'center' },
  });
});

const useSStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
  note: { fontFamily: F.body, fontSize: 12.5, color: W.muted, marginHorizontal: 18, marginBottom: 10 },
  empty: { alignItems: 'center', gap: 10, margin: 16, padding: 26, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: W.border },
  emptyTitle: { fontFamily: F.serifBold, fontSize: 17, color: W.ink },
  });
});
