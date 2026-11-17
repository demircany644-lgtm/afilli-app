import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useGetWriterLibrary, getGetWriterLibraryQueryKey, type WriterSummary } from '@workspace/api-client-react';
import { useApp } from '@/context/AppContext';
import { useCommunity } from '@/context/CommunityContext';
import { TabTitle } from '@/components/TabTitle';
import { BookRow } from '@/components/BookList';
import { Empty, GoldButton, F } from '@/components/ui';
import { Btn, apiError } from '@/components/bulletins/common';
import { scoped, actorRequest, withIdentity } from '@/components/profile/hooks';
import { getBook } from '@/data/catalog';
import { listRecords, type WriterRecord } from '@/lib/writer-store';
import { W, Segmented, Skeleton, Banner } from '@/components/writer/parts';
import { ShelfRow } from '@/components/writer/WriterShelf';

type Tab = 'reading' | 'mine' | 'published' | 'drafts';

function Library() {
  const { library, saved, removeFromLibrary, ready: shelfReady, storageError } = useApp();
  const { ready, userId } = useCommunity();
  const owner = ready ? userId ?? 'guest' : null;
  const [tab, setTab] = useState<Tab>('reading');
  const [removal, setRemoval] = useState<string | null>(null);
  const lib = useGetWriterLibrary({ query: { enabled: ready && !!userId && tab !== 'reading', queryKey: scoped(getGetWriterLibraryQueryKey(), userId) }, request: actorRequest(userId) });
  const [local, setLocal] = useState<WriterRecord[] | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    if (!owner) return;
    let on = true;
    listRecords(owner).then((l) => { if (on) { setLocal(l.records); setLocalErr(null); } }).catch((e: Error) => { if (on) setLocalErr(e.message); });
    return () => { on = false; };
  }, [owner]));

  const items = [...new Set([...saved, ...Object.keys(library)])]
    .map((id) => ({ b: getBook(id), ch: library[id] })).filter((x) => x.b);
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
        <TabTitle title="Kitaplarım" sub={tab === 'reading' ? 'Kaydettiğin ve okumaya başladığın kitaplar.' : 'Yazdığın kitaplar, taslaklar ve yayındakiler.'} />
        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
          <Segmented<Tab> testID="library-tabs" value={tab} onChange={setTab}
            options={[{ v: 'reading', label: 'Kitaplığım' }, { v: 'mine', label: 'Yazdıklarım' }, { v: 'published', label: 'Yayınlananlar' }, { v: 'drafts', label: 'Taslaklar' }]} />
        </View>
        {storageError ? <Banner icon="alert-triangle" tone="err" title="Kitaplık kaydı doğrulanamadı" text={storageError} /> : null}
        {tab === 'reading' ? (!shelfReady ? <View style={{ padding: 16 }}><Skeleton h={96} /></View> : items.length === 0 ? (
          <Empty icon="book" title="Rafların henüz boş" text="Bir kitapta Kitaplığıma Ekle'ye dokun veya okumaya başla.">
            <GoldButton label="Kitap keşfet" icon="search" testID="library-discover" onPress={() => router.push('/search')} style={{ marginTop: 8 }} />
          </Empty>
        ) : items.map(({ b, ch }) => <View key={b!.id}>
          <BookRow book={b!} sub={ch === undefined ? 'Kitaplığına eklendi' : 'Kaldığın yer: ' + (b!.chapters[ch]?.title ?? '')} testID={'library-' + b!.id} />
          {removal === b!.id ? <View style={s.removeConfirm}>
            <Text style={s.note}>Kitaplık kaydı ve okuma konumu kaldırılacak. Yazdığın kitaplar ve taslakların silinmez.</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn label="Vazgeç" ghost testID="library-remove-cancel" onPress={() => setRemoval(null)} />
              <Btn label="Kaldır" testID="library-remove-confirm" onPress={() => { removeFromLibrary(b!.id); setRemoval(null); }} />
            </View>
          </View> : <Pressable testID={'library-remove-' + b!.id} accessibilityRole="button" accessibilityLabel={b!.title + ', kitaplıktan kaldır'} onPress={() => setRemoval(b!.id)} style={s.remove}>
            <Feather name="bookmark" size={14} color={W.muted} /><Text style={s.removeText}>Kitaplıktan kaldır</Text>
          </Pressable>}
        </View>)) : (
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
                  onPress={() => pub ? router.push({ pathname: '/authored-book/[id]', params: { id } }) : router.push({ pathname: '/write', params: { book: id } })} />;
              })}
          </>
        )}
      </ScrollView>
    </View>
  );
}
export default withIdentity(Library);

const s = StyleSheet.create({
  remove: { alignSelf: 'flex-end', marginRight: 22, marginBottom: 12, marginTop: -6, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  removeText: { fontFamily: F.body, fontSize: 12, color: W.muted },
  removeConfirm: { marginHorizontal: 20, marginBottom: 16, gap: 10, alignItems: 'center' },
  note: { fontFamily: F.body, fontSize: 12.5, color: W.muted, marginHorizontal: 18, marginBottom: 10 },
  empty: { alignItems: 'center', gap: 10, margin: 16, padding: 26, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: W.border },
  emptyTitle: { fontFamily: F.serifBold, fontSize: 17, color: W.ink },
});
