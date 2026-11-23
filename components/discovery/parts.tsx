import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { CommunityPerson, DiscoveryBookCard } from '@workspace/api-client-react';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { Avatar } from '@/components/bulletins/common';
import { useCoverUri } from '@/components/writer/parts';
import { compactCount } from '@/components/profile/hooks';

export { SHELVES, SORT_LABEL, type Sort } from '@/lib/discovery-shelves';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

export function useDebouncedValue(value: string, ms = 350): string {
  const [v, setV] = useState(value.trim());
  useEffect(() => { const t = setTimeout(() => setV(value.trim()), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function openBook(id: string) { router.push({ pathname: '/authored-book/[id]', params: { id } }); }

/** Real published cover, or a typeset paper plate when the author chose none. */
export function DiscoveryCover({ card, w, h }: { card: Pick<DiscoveryBookCard, 'title' | 'coverUrl' | 'author'>; w: number; h: number }) {
  const st = useStyles();
  const uri = useCoverUri(card.coverUrl ?? null, null, 'published');
  if (uri) return <Image source={{ uri }} style={{ width: w, height: h }} resizeMode="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[st.plate, { width: w, height: h }]}>
      <View style={st.plateRule} />
      <Text style={[st.plateTitle, { fontSize: Math.max(11, Math.round(w / 9)) }]} numberOfLines={4}>{card.title}</Text>
      <Text style={st.plateAuthor} numberOfLines={1}>{card.author.nickname}</Text>
      <View style={st.plateRule} />
    </View>
  );
}

export function BookResultRow({ card, testID }: { card: DiscoveryBookCard; testID: string }) {
  const st = useStyles();
  const { magazine: P } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={card.title + ', ' + card.author.nickname}
      onPress={() => { tap(); openBook(card.id); }} style={({ pressed }) => [st.row, { transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
      <View style={st.thumb}><DiscoveryCover card={card} w={54} h={78} /></View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={st.title} numberOfLines={2}>{card.title}</Text>
        <Text style={st.sub} numberOfLines={1}>{card.author.nickname}</Text>
        {card.genres.length ? <Text style={st.genre} numberOfLines={1}>{card.genres.join(' · ')}</Text> : null}
        <View style={st.stats}>
          <Feather name="eye" size={12} color={P.muted} /><Text style={st.stat}>{compactCount(card.readCount)}</Text>
          <Feather name="heart" size={12} color={P.muted} /><Text style={st.stat}>{compactCount(card.likeCount)}</Text>
          <Feather name="message-circle" size={12} color={P.muted} /><Text style={st.stat}>{compactCount(card.commentCount)}</Text>
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={P.muted} />
    </Pressable>
  );
}

export function PersonRow({ person }: { person: CommunityPerson }) {
  const st = useStyles();
  const { magazine: P } = useTheme();
  return (
    <Pressable testID={'people-row-' + person.id} accessibilityRole="link" accessibilityLabel={person.nickname + ' profilini aç'}
      onPress={() => { tap(); router.push(('/people/' + person.id) as never); }} style={({ pressed }) => [st.row, { minHeight: 64, transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
      <Avatar person={person} size={44} />
      <Text style={[st.title, { flex: 1, fontFamily: F.semi, fontSize: 15 }]} numberOfLines={1}>{person.nickname}</Text>
      <Feather name="chevron-right" size={18} color={P.muted} />
    </Pressable>
  );
}

export function LoadMore({ next, busy, error, onMore, testID }: { next: boolean; busy: boolean; error: boolean; onMore: () => void; testID: string }) {
  const st = useStyles();
  const { magazine: P } = useTheme();
  if (!next && !error) return null;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ busy }} disabled={busy} onPress={() => { tap(); onMore(); }}
      style={({ pressed }) => [st.more, { opacity: busy ? 0.6 : pressed ? 0.7 : 1 }]}>
      <Feather name={error ? 'refresh-cw' : 'chevrons-down'} size={15} color={error ? P.danger : P.text} />
      <Text style={[st.moreText, error && { color: P.danger }]}>{busy ? 'Yükleniyor…' : error ? 'Sonraki sayfa alınamadı, tekrar dene' : 'Daha fazla göster'}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => {
  const P = t.magazine;
  return StyleSheet.create({
    plate: { backgroundColor: P.card, borderWidth: 1, borderColor: t.social.foilMid, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 6 },
    plateRule: { width: '40%', height: 1, backgroundColor: t.social.foilMid },
    plateTitle: { fontFamily: F.serifBold, color: P.text, textAlign: 'center' },
    plateAuthor: { fontFamily: F.body, fontSize: 9.5, color: P.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 18, marginBottom: 10, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
    thumb: { borderRadius: 5, overflow: 'hidden' },
    title: { fontFamily: F.serifBold, fontSize: 16, color: P.text },
    sub: { fontFamily: F.body, fontSize: 12.5, color: P.muted },
    genre: { fontFamily: F.med, fontSize: 11.5, color: t.social.foilDeep },
    stats: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    stat: { fontFamily: F.body, fontSize: 11.5, color: P.muted, marginRight: 8 },
    note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 4 },
    noteText: { flex: 1, fontFamily: F.body, fontSize: 11.5, lineHeight: 16, color: P.muted },
    more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 18, marginVertical: 8, height: 44, borderRadius: 22, borderWidth: 1, borderColor: t.social.foilMid },
    moreText: { fontFamily: F.med, fontSize: 14, color: P.text },
  });
});
