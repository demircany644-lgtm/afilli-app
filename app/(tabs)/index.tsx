import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useDirectMessages } from '@/context/DirectMessagesContext';
import { useCommunity } from '@/context/CommunityContext';
import { tap } from '@/components/ui';
import { mediaUrl } from '@/components/bulletins/common';
import { FeatherBookMark } from '@/components/home/Marks';
import { useGetDiscoveryBooks, getGetDiscoveryBooksQueryKey, useGetPromotedBooks, getGetPromotedBooksQueryKey, type DiscoveryBookCard } from '@workspace/api-client-react';
import { actorRequest, compactCount, scoped } from '@/components/profile/hooks';
import { DiscoveryCover, SHELVES, openBook } from '@/components/discovery/parts';
import colors from '@/constants/colors';
import Animated, { useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useAppearance } from '@/context/AppearanceContext';
import { LavaBackdrop, CoverGlow } from '@/components/theme/LavaBackdrop';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { homeCategoryCarouselLayout, homeCoverLayout } from '@/lib/home-cover-layout';
import { HOME_BOOK_CATEGORIES, RECOMMENDATION_RANKS, type DiscoveryCategoryId, type DiscoveryShelf, type HomeBookCategory } from '@/lib/discovery-shelves';

const LV = colors.lava;

const PILLS = [
  { key: 'store', label: 'Mağazam', href: '/store' },
  { key: 'premium', label: 'Abonelik Yap', href: '/premium' },
  { key: 'dergi', label: 'Dergi', href: '/dergi' },
  { key: 'bulten', label: 'Bültenler', href: '/bultenler' },
  { key: 'ozel', label: 'Özel', href: '/ozel' },
] as const;

function HeaderBtn({ icon, label, testID, onPress, dot, ink }: { icon: 'search' | 'chat'; label: string; testID: string; onPress: () => void; dot?: boolean; ink: string }) {
  const st = useStyles();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [st.hbtn, pressed && { opacity: 0.6 }]}>
      {icon === 'chat' ? <MaterialCommunityIcons name="message-processing-outline" size={27} color={ink} /> : <Feather name="search" size={25} color={ink} />}
      {dot ? <View testID="messages-unread-dot" style={st.badge} /> : null}
    </Pressable>
  );
}

/** Real account photo when one exists; otherwise a neutral initials disc. */
function ProfileButton({ ink }: { ink: string }) {
  const st = useStyles();
  const { person } = useCommunity();
  const name = person?.nickname?.trim() ?? '';
  const initials = name ? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toLocaleUpperCase('tr-TR') : '';
  return (
    <Pressable testID="open-profile" accessibilityRole="button" accessibilityLabel="Profil" hitSlop={6}
      onPress={() => { tap(); router.navigate('/profile'); }} style={({ pressed }) => [st.avatar, pressed && { opacity: 0.7 }]}>
      {person?.avatar ? <Image source={{ uri: mediaUrl(person.avatar) }} style={st.avatarImg} accessibilityIgnoresInvertColors />
        : initials ? <Text style={st.avatarText}>{initials}</Text>
        : <Feather name="user" size={20} color={ink} />}
    </Pressable>
  );
}

function ShelfCover({ b, w, h, lava, testID }: { b: DiscoveryBookCard; w: number; h: number; lava: boolean; testID?: string }) {
  const st = useStyles();
  return (
    <Pressable testID={testID ?? 'home-book-' + b.id} accessibilityRole="button" accessibilityLabel={b.title + ', ' + b.author.nickname + (b.genres.length ? ', ' + b.genres.join(', ') : '')}
      onPress={() => { tap(); openBook(b.id); }}
      style={({ pressed }) => [st.coverWrap, { width: w, height: h, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={st.coverClip}><DiscoveryCover card={b} w={w} h={h} /></View>
      <View pointerEvents="none" style={st.sheen} />
      {lava ? <CoverGlow w={w} /> : null}
    </Pressable>
  );
}

/** One real shelf: first server page for its sort/category; Tümü continues in Keşfet. */
type HomeShelf = DiscoveryShelf & {
  routeSection?: string;
  compact?: boolean;
  category?: DiscoveryCategoryId;
  hideWhenEmpty?: boolean;
  showAll?: boolean;
};

function Shelf({ sec, w, h, pad, lava, ink, link }: { sec: HomeShelf; w: number; h: number; pad: number; lava: boolean; ink: string; link: string }) {
  const st = useStyles();
  const H = useTheme().home;
  const { ready, userId } = useCommunity();
  const params = { sort: sec.sort, ...(sec.category ? { category: sec.category } : {}) };
  const q = useGetDiscoveryBooks(params, { query: {
    enabled: ready, queryKey: scoped(getGetDiscoveryBooksQueryKey(params), userId), staleTime: 60_000, refetchInterval: 60_000,
  }, request: actorRequest(userId) });
  const featured = useGetPromotedBooks({ query: {
    enabled: ready && sec.id === 'oneriler',
    queryKey: scoped(getGetPromotedBooksQueryKey(), userId),
    staleTime: 30_000,
    refetchInterval: sec.id === 'oneriler' ? 60_000 : false,
  }, request: actorRequest(userId) });
  const promoted = sec.id === 'oneriler' ? featured.data ?? [] : [];
  const promotedIds = new Set(promoted.map(book => book.id));
  const items = [...new Map([...(q.data?.items ?? [])].map((book) => [book.id, book])).values()];
  const railItems = sec.id === 'oneriler' ? items.filter(book => !promotedIds.has(book.id)) : items;
  if (sec.hideWhenEmpty && q.data && items.length === 0) return null;
  const muted = lava ? LV.headline : H.muted;
  const cover = homeCoverLayout(h);
  return (
    <View testID={'home-section-' + sec.id} style={st.section}>
      <View style={[st.secRow, { paddingHorizontal: pad }]}>
        <Text numberOfLines={sec.compact ? 2 : 1} accessibilityRole="header" style={[st.sec, sec.compact && st.rankTitle, { color: ink }, lava && st.secLava]}>{sec.title}</Text>
        {sec.showAll === false ? null : (
          <Pressable testID={'home-all-' + sec.id} accessibilityRole="link" accessibilityLabel={sec.title + ', tümünü Keşfet\'te gör'} hitSlop={8}
            onPress={() => { tap(); router.push({ pathname: '/search', params: { section: sec.routeSection ?? sec.id, sort: sec.sort } }); }}
            style={({ pressed }) => [st.all, pressed && { opacity: 0.6 }]}>
            <Text style={[st.allText, { color: link }]}>Tümü</Text>
            <Feather name="chevron-right" size={17} color={link} />
          </Pressable>
        )}
      </View>
      {promoted.length ? <View style={[st.promotedList, { paddingHorizontal: pad }]}>
        {promoted.map(book => <Pressable key={book.id} testID={'home-promoted-book-' + book.id}
          accessibilityRole="link" accessibilityLabel={`${book.title}, ${book.author.nickname}, ücretli tanıtım değil, ücretsiz yönetici onaylı öneri`}
          onPress={() => { tap(); openBook(book.id); }}
          style={({ pressed }) => [st.promotedCard, { backgroundColor: H.card, borderColor: H.border, opacity: pressed ? 0.86 : 1 }]}>
          <DiscoveryCover card={book} w={52} h={74} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={2} style={[st.promotedTitle, { color: ink }]}>{book.title}</Text>
            <Text numberOfLines={1} style={[st.promotedAuthor, { color: muted }]}>{book.author.nickname}</Text>
          </View>
          <Feather name="chevron-right" size={17} color={link} />
        </Pressable>)}
      </View> : null}
      {!ready || q.isLoading ? (
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: pad, paddingBottom: 14 }} accessibilityLabel={sec.title + ' yükleniyor'}>
          {[0, 1, 2].map((i) => <View key={i} style={[st.ghost, { width: w, height: h }]} />)}
        </View>
      ) : q.isError ? (
        <Pressable testID={'home-retry-' + sec.id} accessibilityRole="button" accessibilityLabel={sec.title + ' yüklenemedi, tekrar dene'} onPress={() => { tap(); void q.refetch(); }}
          style={[st.shelfNote, { marginHorizontal: pad, height: h }]}>
          <Feather name="refresh-cw" size={18} color={muted} />
          <Text style={[st.shelfNoteText, { color: muted }]}>Raf yüklenemedi. Tekrar denemek için dokun.</Text>
        </Pressable>
      ) : railItems.length === 0 ? (
        promoted.length > 0 ? null : sec.hideWhenEmpty ? null : (
        <View style={[st.shelfNote, { marginHorizontal: pad, height: h }]} testID={'home-empty-' + sec.id}>
          <Feather name="feather" size={18} color={muted} />
          <Text style={[st.shelfNoteText, { color: muted }]}>Bu raf, yazarlar ilk kitaplarını yayımladığında dolacak.</Text>
        </View>)
      ) : (
        <View style={{ height: cover.frameHeight, marginTop: cover.marginTop, overflow: 'visible' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={w + 12} snapToAlignment="start"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: cover.scrollHeight }}
            testID={'home-shelf-' + sec.id} contentContainerStyle={{ paddingHorizontal: pad, gap: 12, paddingBottom: 14, paddingTop: 2 }}>
            {railItems.map((b) => <ShelfCover key={b.id} b={b} w={w} h={cover.height} lava={lava} />)}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function RecommendationDetails({ w, h, pad, lava, ink, link }: { w: number; h: number; pad: number; lava: boolean; ink: string; link: string }) {
  return (
    <View testID="home-recommendation-details">
      {RECOMMENDATION_RANKS.map((sec) => (
        <Shelf key={sec.id} sec={sec} w={w} h={h} pad={pad} lava={lava} ink={ink} link={link} />
      ))}
    </View>
  );
}

function CategoryBookSection({ category, pad, ink, link, coverWidth, coverHeight, gap, lava }: {
  category: HomeBookCategory;
  pad: number;
  ink: string;
  link: string;
  coverWidth: number;
  coverHeight: number;
  gap: number;
  lava: boolean;
}) {
  const st = useStyles();
  const t = useTheme();
  const { ready, userId } = useCommunity();
  const params = { sort: category.sort, category: category.id };
  const q = useGetDiscoveryBooks(params, { query: {
    enabled: ready,
    queryKey: scoped(getGetDiscoveryBooksQueryKey(params), userId),
    staleTime: 60_000,
    refetchInterval: 60_000,
  }, request: actorRequest(userId) });
  const items = [...new Map((q.data?.items ?? []).map((book) => [book.id, book])).values()];

  if (q.data && items.length === 0) return null;

  return (
    <View testID={'home-category-section-' + category.id} style={st.section}>
      <View style={[st.secRow, { paddingHorizontal: pad }]}>
        <Text accessibilityRole="header" style={[st.sec, st.categoryHeading, { color: ink }]}>{category.title}</Text>
        <Pressable testID={'home-category-all-' + category.id} accessibilityRole="link"
          accessibilityLabel={category.title + ', tüm kitapları gör'} hitSlop={8}
          onPress={() => { tap(); router.push({ pathname: '/search', params: { category: category.id, sort: category.sort } }); }}
          style={({ pressed }) => [st.all, pressed && { opacity: 0.6 }]}>
          <Text style={[st.allText, { color: link }]}>Tümünü Gör</Text>
          <Feather name="chevron-right" size={17} color={link} />
        </Pressable>
      </View>
      {!ready || q.isLoading ? (
        <View style={{ flexDirection: 'row', gap, paddingHorizontal: pad, paddingTop: 2, paddingBottom: 14 }} accessibilityLabel={category.title + ' yükleniyor'}>
          {[0, 1, 2].map((i) => <View key={i} style={[st.ghost, { width: coverWidth, height: coverHeight }]} />)}
        </View>
      ) : q.isError ? (
        <Pressable testID={'home-category-retry-' + category.id} accessibilityRole="button"
          accessibilityLabel={category.title + ' yüklenemedi, tekrar dene'} onPress={() => { tap(); void q.refetch(); }}
          style={[st.categoryMessage, { marginHorizontal: pad, borderColor: t.magazine.border, backgroundColor: t.magazine.card }]}>
          <Feather name="refresh-cw" size={17} color={t.magazine.gold} />
          <Text style={[st.categoryMessageText, { color: t.magazine.text }]}>Kitaplar yüklenemedi. Tekrar dene.</Text>
        </Pressable>
      ) : items.length > 0 ? (
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={coverWidth + gap}
          snapToAlignment="start"
          testID={'home-category-shelf-' + category.id}
          contentContainerStyle={{ paddingHorizontal: pad, gap, paddingTop: 2, paddingBottom: 14 }}
        >
          {items.map((book) => (
            <ShelfCover
              key={book.id}
              b={book}
              w={coverWidth}
              h={coverHeight}
              lava={lava}
              testID={'home-category-book-' + category.id + '-' + book.id}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

export default function Home() {
  const { isLoaded, userId } = useAuth();
  const t = useTheme();
  if (!isLoaded) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.home.bg }}><Text style={{ color: t.home.muted }}>Oturum kontrol ediliyor…</Text></View>;
  if (!userId) return <Redirect href="/sign-in" />;
  return <HomeContent />;
}

function HomeContent() {
  const H = useTheme().home;
  const st = useStyles();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const unread = useDirectMessages().conversations.some((c) => c.unreadCount > 0);
  const { isLava: lava } = useAppearance();
  const ref = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
  const ink = lava ? LV.headline : H.ink;
  const link = lava ? LV.link : H.link;
  const top = Platform.OS === 'web' ? 67 : ins.top;
  const pad = width < 360 ? 14 : 18;
  const inner = Math.min(width, 560) - pad;
  const categoryCarousel = homeCategoryCarouselLayout(width, pad);
  // Two full covers plus a visible third edge so every shelf invites a sideways swipe.
  const coverW = Math.round(Math.min(190, (inner - 24) / 2.42));
  const coverH = Math.round(coverW * 1.2);

  return (
    <View style={{ flex: 1, backgroundColor: lava ? LV.bg : H.bg }}>
      {lava ? <LavaBackdrop scrollY={scrollY} /> : null}
      <View style={[st.header, { paddingTop: top + 6, paddingHorizontal: pad }]}>
        <Pressable testID="logo" accessibilityRole="button" accessibilityLabel="Afilli, en üste dön" onPress={() => ref.current?.scrollTo({ y: 0, animated: true })} style={({ pressed }) => [st.brand, pressed && { opacity: 0.7 }]}>
          <FeatherBookMark size={42} color={ink} bg={lava ? LV.bg : H.bg} />
          <Text style={[st.logoText, { color: ink }]}>Afilli</Text>
        </Pressable>
        <View style={st.actions}>
          <HeaderBtn icon="search" label="Keşfet ve ara" testID="open-search" onPress={() => router.push('/search')} ink={ink} />
          <HeaderBtn icon="chat" label={unread ? 'Mesajlar, okunmamış mesaj var' : 'Mesajlar'} testID="open-messages" dot={unread} onPress={() => router.push('/messages')} ink={ink} />
          <ProfileButton ink={ink} />
        </View>
      </View>
      <View style={[st.pills, { paddingHorizontal: pad }]}>
        {PILLS.map((p) => (
          <Pressable key={p.key} testID={'pill-' + p.key} accessibilityRole="button" accessibilityLabel={p.label}
            onPress={() => { tap(); router.push(p.href); }}
            style={({ pressed }) => [st.pill, lava && st.pillLava, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[st.pillText, lava && { color: LV.pillText }]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <Animated.ScrollView ref={ref} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        <Shelf sec={SHELVES[0]} w={coverW} h={coverH} pad={pad} lava={lava} ink={ink} link={link} />
        {HOME_BOOK_CATEGORIES.map((category) => (
          <CategoryBookSection
            key={category.id}
            category={category}
            pad={pad}
            ink={ink}
            link={link}
            coverWidth={categoryCarousel.coverWidth}
            coverHeight={categoryCarousel.coverHeight}
            gap={categoryCarousel.gap}
            lava={lava}
          />
        ))}
        <RecommendationDetails w={coverW} h={coverH} pad={pad} lava={lava} ink={ink} link={link} />
      </Animated.ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const H = t.home;
  const P = t.magazine;
  const lift = { shadowColor: '#2B1A0E', shadowOpacity: t.isDark ? 0.4 : 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 };
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, width: '100%', maxWidth: 560, alignSelf: 'center' },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    logoText: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 34, lineHeight: 42, letterSpacing: 0.3 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    hbtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    badge: { position: 'absolute', top: 6, right: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: P.danger, borderWidth: 1.5, borderColor: H.bg, alignItems: 'center', justifyContent: 'center' },
    avatar: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: P.input, borderWidth: 1.5, borderColor: t.social.foilMid },
    avatarImg: { width: '100%', height: '100%' },
    avatarText: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 16, color: H.ink },
    pills: { flexDirection: 'row', gap: 10, paddingTop: 6, paddingBottom: 10, width: '100%', maxWidth: 560, alignSelf: 'center' },
    pill: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 20, borderWidth: 1, borderColor: t.social.foilMid, backgroundColor: H.card, paddingHorizontal: 6, ...lift },
    pillLava: { backgroundColor: colors.lava.pill, borderColor: 'rgba(255,255,255,0.8)' },
    pillText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: H.ink },
    scroll: { paddingBottom: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
    section: { marginTop: 14 },
    secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
    sec: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 25, lineHeight: 32 },
    rankTitle: { flex: 1, flexShrink: 1, fontSize: 20, lineHeight: 25 },
    categoryHeading: { flex: 1, flexShrink: 1, fontSize: 21, lineHeight: 27 },
    secLava: { fontFamily: 'PlayfairDisplay_700Bold', textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } },
    all: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 32 },
    allText: { fontFamily: 'Inter_500Medium', fontSize: 16 },
    coverWrap: { borderRadius: 8, backgroundColor: H.border, shadowColor: '#2B1A0E', shadowOpacity: t.isDark ? 0.5 : 0.24, shadowRadius: 8, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
    coverClip: { flex: 1, borderRadius: 8, overflow: 'hidden' },
    ghost: { borderRadius: 8, backgroundColor: H.border, opacity: 0.45 },
    shelfNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: t.social.foilMid, paddingHorizontal: 18, marginBottom: 14 },
    shelfNoteText: { flexShrink: 1, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
    categoryMessage: { minHeight: 70, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' },
    categoryMessageText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, flexShrink: 1 },
    promotedList: { gap: 8, marginBottom: 12 },
    promotedCard: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 7 },
    promotedTitle: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 15, lineHeight: 19 },
    promotedAuthor: { fontFamily: 'Inter_400Regular', fontSize: 12 },
    sheen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 8, borderWidth: 1, borderTopColor: 'rgba(255,255,255,0.45)', borderLeftColor: 'rgba(255,255,255,0.3)', borderRightColor: 'rgba(0,0,0,0.12)', borderBottomColor: 'rgba(0,0,0,0.2)' },
  });
});
