import React, { useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { Cover, tap } from '@/components/ui';
import { FeatherBookMark } from '@/components/home/Marks';
import { HOME_SECTIONS, getBook, type Book } from '@/data/catalog';
import colors from '@/constants/colors';

const H = colors.home;

const PILLS = [
  { key: 'store', label: 'Mağazam', href: '/store' },
  { key: 'dergi', label: 'Dergi', href: '/dergi' },
  { key: 'bulten', label: 'Bültenler', href: '/bultenler' },
  { key: 'ozel', label: 'Özel', href: '/ozel' },
] as const;

function HeaderBtn({ icon, label, testID, onPress, badge, circle }: { icon: keyof typeof Feather.glyphMap; label: string; testID: string; onPress: () => void; badge?: number; circle?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [st.hbtn, pressed && { opacity: 0.6 }]}>
      {circle ? <MaterialCommunityIcons name="account-circle-outline" size={26} color={H.ink} /> : icon === 'message-circle' ? <MaterialCommunityIcons name="message-processing-outline" size={24} color={H.ink} /> : <Feather name={icon} size={22} color={H.ink} />}
      {!!badge && badge > 0 && <View style={st.badge}><Text style={st.badgeText}>{badge > 9 ? '9+' : badge}</Text></View>}
    </Pressable>
  );
}

function BookCard({ b, w }: { b: Book; w: number }) {
  const ch = Math.round(w * 1.22);
  return (
    <Pressable testID={'home-book-' + b.id} accessibilityRole="button" accessibilityLabel={b.title + ', ' + b.genre + ', ' + b.author}
      onPress={() => { tap(); router.push({ pathname: '/book/[id]', params: { id: b.id } }); }}
      style={({ pressed }) => [st.card, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={[st.coverWrap, { width: w, height: ch }]}>
        <View style={st.coverClip}><Cover book={b} w={w} h={ch} /></View>
        <View pointerEvents="none" style={st.sheen} />
      </View>
      <Text numberOfLines={2} style={st.title}>{b.title}</Text>
      <Text numberOfLines={1} style={st.genre}>{b.genre}</Text>
      <Text numberOfLines={1} style={st.author}>{b.author}</Text>
    </Pressable>
  );
}

export default function Home() {
  const { isLoaded, userId } = useAuth();
  if (!isLoaded) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: H.bg }}><Text style={st.genre}>Oturum kontrol ediliyor…</Text></View>;
  if (!userId) return <Redirect href="/sign-in" />;
  return <HomeContent />;
}

function HomeContent() {
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { unread } = useApp();
  const ref = useRef<ScrollViewInstance>(null);
  const top = Platform.OS === 'web' ? 67 : ins.top;
  const pad = width < 360 ? 12 : 18;
  const inner = Math.min(width, 520) - pad * 2;
  const coverW = Math.round((inner - 20) / 3 - 18);

  return (
    <View style={{ flex: 1, backgroundColor: H.bg }}>
      <View style={[st.header, { paddingTop: top + 4, paddingHorizontal: pad }]}>
        <Pressable testID="logo" accessibilityRole="button" accessibilityLabel="Afilli, en üste dön" onPress={() => ref.current?.scrollTo({ y: 0, animated: true })} style={({ pressed }) => [st.brand, pressed && { opacity: 0.7 }]}>
          <FeatherBookMark size={40} color={H.ink} />
          <Text style={st.logoText}>Afilli</Text>
        </Pressable>
        <View style={st.actions}>
          <HeaderBtn icon="search" label="Keşfet ve ara" testID="open-search" onPress={() => router.push('/search')} />
          <HeaderBtn icon="message-circle" label={unread ? 'Mesajlar, ' + unread + ' okunmamış' : 'Mesajlar'} testID="open-messages" badge={unread} onPress={() => router.push('/messages')} />
          <HeaderBtn icon="user" circle label="Profil" testID="open-profile" onPress={() => router.navigate('/profile')} />
        </View>
      </View>
      <View style={[st.pills, { paddingHorizontal: pad }]}>
        {PILLS.map((p) => (
          <Pressable key={p.key} testID={'pill-' + p.key} accessibilityRole="button" accessibilityLabel={p.label}
            onPress={() => { tap(); router.push(p.href); }}
            style={({ pressed }) => [st.pill, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={st.pillText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView ref={ref} contentContainerStyle={[st.scroll, { paddingHorizontal: pad }]} showsVerticalScrollIndicator={false}>
        {HOME_SECTIONS.map((sec) => (
          <View key={sec.id} testID={'home-section-' + sec.id} style={st.section}>
            <View style={st.secRow}>
              <Text style={st.sec}>{sec.title}</Text>
              <Pressable testID={'home-all-' + sec.id} accessibilityRole="link" accessibilityLabel={sec.title + ', tümünü gör'} hitSlop={8}
                onPress={() => { tap(); router.push({ pathname: '/search', params: { section: sec.id } }); }}
                style={({ pressed }) => [st.all, pressed && { opacity: 0.6 }]}>
                <Text style={st.allText}>Tümü</Text>
                <Feather name="chevron-right" size={14} color={H.link} />
              </Pressable>
            </View>
            <View style={st.grid}>
              {sec.ids.map((id) => { const b = getBook(id); return b ? <BookCard key={id} b={b} w={coverW} /> : null; })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const shadow = { shadowColor: H.ink, shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 };

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoText: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 34, lineHeight: 42, color: H.ink, letterSpacing: 0.3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hbtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: 0, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: H.badge, borderWidth: 1.5, borderColor: H.bg, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: H.badgeText, fontSize: 9, fontFamily: 'Inter_700Bold' },
  pills: { flexDirection: 'row', gap: 8, paddingTop: 4, paddingBottom: 8, width: '100%', maxWidth: 520, alignSelf: 'center' },
  pill: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', height: 32, borderRadius: 16, borderWidth: 1, borderColor: H.border, backgroundColor: H.card, paddingHorizontal: 6, ...shadow },
  pillText: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 14, color: H.ink },
  scroll: { paddingBottom: 24, width: '100%', maxWidth: 520, alignSelf: 'center' },
  section: { marginTop: 10 },
  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sec: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 21, lineHeight: 28, color: H.ink },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  allText: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 14, color: H.link },
  grid: { flexDirection: 'row', gap: 10 },
  card: { flex: 1, minWidth: 0, backgroundColor: H.card, borderRadius: 8, borderWidth: 1, borderColor: H.border, paddingTop: 8, paddingBottom: 9, paddingHorizontal: 8, alignItems: 'center', ...shadow },
  coverWrap: { borderRadius: 6, marginBottom: 7, marginTop: -2, backgroundColor: H.border, shadowColor: H.ink, shadowOpacity: 0.32, shadowRadius: 7, shadowOffset: { width: 0, height: 5 }, elevation: 7 },
  coverClip: { flex: 1, borderRadius: 6, overflow: 'hidden' },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 6, borderWidth: 1, borderTopColor: 'rgba(255,255,255,0.55)', borderLeftColor: 'rgba(255,255,255,0.35)', borderRightColor: 'rgba(0,0,0,0.12)', borderBottomColor: 'rgba(0,0,0,0.22)' },
  title: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 12, lineHeight: 17, minHeight: 34, color: H.ink, textAlign: 'center', alignSelf: 'stretch' },
  genre: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 13, color: H.muted, marginTop: 1 },
  author: { fontFamily: 'Inter_500Medium', fontSize: 10.5, lineHeight: 14, color: H.ink, marginTop: 5 },
});
