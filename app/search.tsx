import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetDiscoveryBooks, getGetDiscoveryBooksQueryKey, useGetPeople, getGetPeopleQueryKey, type CommunityPerson, type DiscoveryBookCard } from '@workspace/api-client-react';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { F, tap, webBottom } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { actorRequest, scoped } from '@/components/profile/hooks';
import { Skeleton, StateCard } from '@/components/profile/kit';
import { BookResultRow, LoadMore, PersonRow, useDebouncedValue } from '@/components/discovery/parts';
import { RECOMMENDATION_CATEGORIES, HOME_BOOK_CATEGORIES, discoveryCategoryTitle, resolveDiscoveryShelf, SORTS, SORT_LABEL, type DiscoveryCategoryId, type DiscoveryShelf, type Sort } from '@/lib/discovery-shelves';

type Tab = 'books' | 'people';
type BookCategory = DiscoveryCategoryId;

export default function Search() {
  const p = useLocalSearchParams<{ section?: string; sort?: string; tab?: string; category?: string }>();
  const shelf = resolveDiscoveryShelf(p.section, p.sort);
  const initialTab: Tab = p.tab === 'people' ? 'people' : 'books';
  const initialCategory = [...RECOMMENDATION_CATEGORIES, ...HOME_BOOK_CATEGORIES].find((category) => category.id === p.category)?.id ?? null;
  return <Discovery key={initialTab + ':' + shelf.id + ':' + (initialCategory ?? 'all')} initialShelf={shelf} initialTab={initialTab} initialCategory={initialCategory} />;
}

function Discovery({ initialShelf, initialTab, initialCategory }: { initialShelf: DiscoveryShelf; initialTab: Tab; initialCategory: BookCategory | null }) {
  const { magazine: P } = useTheme();
  const st = useStyles();
  const ins = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [shelf, setShelf] = useState<DiscoveryShelf>(initialShelf);
  const [category, setCategory] = useState<BookCategory | null>(initialCategory);
  const sort = shelf.sort;
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q);
  const shelfTitle = shelf.title;
  const categoryTitle = discoveryCategoryTitle(category);

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1, backgroundColor: P.background }}>
      <View style={[st.bar, { paddingTop: (Platform.OS === 'web' ? 67 : ins.top) + 8 }]}>
        <View style={st.field}>
          <Feather name="search" size={18} color={t_gold(P)} />
          <TextInput testID="search-input" value={q} onChangeText={setQ} maxLength={100}
            placeholder={tab === 'books' ? 'Kitap, yazar veya tür' : 'Okur veya yazar adı'} placeholderTextColor={P.muted}
            style={st.in} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel={tab === 'books' ? 'Kitap ara' : 'Kişi ara'} />
          {q ? <Pressable testID="search-clear" accessibilityRole="button" accessibilityLabel="Aramayı temizle" hitSlop={8} onPress={() => setQ('')}><Feather name="x-circle" size={18} color={P.muted} /></Pressable> : null}
        </View>
        <Pressable testID="search-cancel" accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={8}>
          <Text style={st.cancel}>Kapat</Text>
        </Pressable>
      </View>
      <View style={st.tabs} accessibilityRole="tablist">
        {([['books', 'Kitaplar', 'book-open'], ['people', 'Kişiler', 'users']] as const).map(([k, label, icon]) => (
          <Pressable key={k} testID={'discovery-tab-' + k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => { tap(); setTab(k); }}
            style={[st.tab, tab === k && st.tabOn]}>
            <Feather name={icon} size={15} color={tab === k ? P.card : P.text} />
            <Text style={[st.tabText, tab === k && { color: P.card }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 + webBottom, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <Text testID="discovery-title" accessibilityRole="header" style={st.heading}>{tab === 'people' ? 'Okurlar ve yazarlar' : search ? 'Arama sonuçları' : categoryTitle ?? shelfTitle}</Text>
        {tab === 'books' ? (
          <>
            <View style={st.categoryHeading}>
              <Text accessibilityRole="header" style={st.categoryTitle}>Kitap kategorileri</Text>
              <Pressable testID="discovery-category-all" accessibilityRole="button" accessibilityState={{ selected: category === null }}
                onPress={() => { tap(); setCategory(null); }}>
                <Text style={[st.categoryAll, category === null && { fontFamily: F.semi }]}>Tüm kitaplar</Text>
              </Pressable>
            </View>
            <View style={st.categoryList}>
              {RECOMMENDATION_CATEGORIES.map((item) => {
                const selected = category === item.id;
                return (
                  <Pressable key={item.id} testID={'discovery-category-' + item.id} accessibilityRole="button"
                    accessibilityState={{ selected }} accessibilityLabel={item.title}
                    onPress={() => { tap(); setCategory(item.id); }}
                    style={[st.categoryCard, selected && st.categoryCardOn]}>
                    <Text style={[st.categoryText, selected && st.categoryTextOn]}>{item.title}</Text>
                    <Feather name={selected ? 'check-circle' : 'chevron-right'} size={18} color={selected ? P.card : P.muted} />
                  </Pressable>
                );
              })}
            </View>
            <View style={st.sorts}>
              {SORTS.map((s) => (
                <Pressable key={s} testID={'discovery-sort-' + s} accessibilityRole="button" accessibilityState={{ selected: sort === s }} onPress={() => { tap(); setShelf(resolveDiscoveryShelf(undefined, s)); }}
                  style={[st.sort, sort === s && st.sortOn]}>
                  <Text style={[st.sortText, sort === s && { color: P.text, fontFamily: F.semi }]}>{SORT_LABEL[s]}</Text>
                </Pressable>
              ))}
            </View>
            <BookPages key={sort + '|' + search + '|' + (category ?? 'all')} sort={sort} search={search} category={category} />
          </>
        ) : <PeoplePages key={search} search={search} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const t_gold = (P: { gold: string }) => P.gold;

function ListSkeleton({ h }: { h: number }) {
  return <View style={{ paddingHorizontal: 18, gap: 10 }} accessibilityLabel="Yükleniyor">{[0, 1, 2, 3].map((i) => <Skeleton key={i} w="100%" h={h} r={16} />)}</View>;
}

/** Cursor-paged accumulation keyed by the query identity; remounts reset it. */
function useAccumulate<T extends { id: string }>(page: T[] | undefined, cursor: string | undefined) {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    if (!page) return;
    setItems((prev) => {
      if (!cursor) return page;
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...page.filter((p) => !seen.has(p.id))];
    });
  }, [page, cursor]);
  return items;
}

function BookPages({ sort, search, category }: { sort: Sort; search: string; category: BookCategory | null }) {
  const { ready, userId } = useCommunity();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const params = { sort, ...(search ? { search } : {}), ...(category ? { category } : {}), ...(cursor ? { cursor } : {}) };
  const q = useGetDiscoveryBooks(params, { query: { enabled: ready, queryKey: scoped(getGetDiscoveryBooksQueryKey(params), userId) }, request: actorRequest(userId) });
  const items = useAccumulate<DiscoveryBookCard>(q.data?.items, cursor);
  if ((!ready || q.isLoading) && !cursor) return <ListSkeleton h={100} />;
  if (q.isError && !cursor) return <StateCard testID="discovery-error" icon="wifi-off" title="Kitaplar yüklenemedi" text="Bağlantını kontrol edip tekrar dene." action={{ label: 'Tekrar dene', testID: 'discovery-retry', onPress: () => void q.refetch() }} />;
  if (items.length === 0 && q.data) return <StateCard testID="discovery-empty" icon="book"
    title={search ? 'Eşleşen kitap yok' : category ? 'Bu kategoride kitap yok' : 'Henüz yayımlanmış kitap yok'}
    text={search ? `"${search}" için bu filtrelerle eşleşen kitap bulunamadı.` : category ? 'Bu türe uygun yayımlanmış kitaplar olduğunda burada listelenecek.' : 'Yazarlar ilk kitaplarını yayımladığında burada görünecek.'} />;
  return (
    <View>
      {items.map((b) => <BookResultRow key={b.id} card={b} testID={'published-result-' + b.id} />)}
      <LoadMore testID="discovery-more" next={!!q.data?.nextCursor} busy={q.isFetching} error={q.isError}
        onMore={() => { if (q.isError) void q.refetch(); else if (q.data?.nextCursor) setCursor(q.data.nextCursor); }} />
      {!q.data?.nextCursor && !q.isError && items.length > 0 ? <EndMark /> : null}
    </View>
  );
}

function PeoplePages({ search }: { search: string }) {
  const { ready, userId } = useCommunity();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const params = { ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) };
  const q = useGetPeople(params, { query: { enabled: ready, queryKey: scoped(getGetPeopleQueryKey(params), userId) }, request: actorRequest(userId) });
  const items = useAccumulate<CommunityPerson>(q.data?.items, cursor);
  if ((!ready || q.isLoading) && !cursor) return <ListSkeleton h={64} />;
  if (q.isError && !cursor) return <StateCard testID="people-error" icon="wifi-off" title="Kişiler yüklenemedi" text="Bağlantını kontrol edip tekrar dene." action={{ label: 'Tekrar dene', testID: 'people-retry', onPress: () => void q.refetch() }} />;
  if (items.length === 0 && q.data) return <StateCard testID="people-empty" icon="users" title={search ? 'Kimse bulunamadı' : 'Henüz okur yok'} text={search ? `"${search}" ile eşleşen bir okur yok. Başka bir ad dene.` : 'İlk okurlar katıldığında burada görünecek.'} />;
  return (
    <View>
      {items.map((p) => <PersonRow key={p.id} person={p} />)}
      <LoadMore testID="people-more" next={!!q.data?.nextCursor} busy={q.isFetching} error={q.isError}
        onMore={() => { if (q.isError) void q.refetch(); else if (q.data?.nextCursor) setCursor(q.data.nextCursor); }} />
      {!q.data?.nextCursor && !q.isError && items.length > 0 ? <EndMark /> : null}
    </View>
  );
}

function EndMark() {
  const st = useStyles();
  return <View style={st.end} accessibilityLabel="Listenin sonu"><View style={st.endRule} /><Text style={st.endText}>Hepsi bu kadar</Text><View style={st.endRule} /></View>;
}

const useStyles = makeStyles((t) => {
  const P = t.magazine;
  return StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10, width: '100%', maxWidth: 640, alignSelf: 'center' },
    field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: t.social.foilMid, backgroundColor: P.card, borderRadius: 999, paddingHorizontal: 14, height: 46 },
    in: { flex: 1, fontFamily: F.body, fontSize: 15, height: 46, color: P.text },
    cancel: { fontFamily: F.med, fontSize: 15, color: P.text },
    tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 6, width: '100%', maxWidth: 640, alignSelf: 'center' },
    tab: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 20, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
    tabOn: { backgroundColor: P.text, borderColor: P.text },
    tabText: { fontFamily: F.med, fontSize: 14, color: P.text },
    heading: { fontFamily: F.serifBold, fontSize: 25, color: P.text, marginHorizontal: 20, marginTop: 10, marginBottom: 10 },
    categoryHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, marginTop: 2, marginBottom: 8 },
    categoryTitle: { fontFamily: F.serifBold, fontSize: 18, color: P.text },
    categoryAll: { fontFamily: F.med, fontSize: 13, color: P.gold },
    categoryList: { paddingHorizontal: 16, gap: 8, marginBottom: 14 },
    categoryCard: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
    categoryCardOn: { backgroundColor: P.text, borderColor: P.text },
    categoryText: { flex: 1, fontFamily: F.med, fontSize: 14, lineHeight: 19, color: P.text },
    categoryTextOn: { color: P.card, fontFamily: F.semi },
    sorts: { flexDirection: 'row', gap: 18, marginHorizontal: 20, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: P.border },
    sort: { paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
    sortOn: { borderBottomColor: t.social.foilMid },
    sortText: { fontFamily: F.med, fontSize: 14, color: P.muted },
    end: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 40, marginVertical: 16 },
    endRule: { flex: 1, height: 1, backgroundColor: P.border },
    endText: { fontFamily: F.serif, fontSize: 13, color: P.muted, fontStyle: 'italic' },
  });
});
