import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReaderProfile } from '@workspace/api-client-react';
import { router } from 'expo-router';
import { F } from '@/components/ui';
import { mediaUrl } from '@/components/bulletins/common';
import { GoldAvatar, StatCard, StatusLine } from './kit';
import { OfficialInstagramIcon } from './SocialRow';
import { ConnectionsSheet } from './ConnectionsSheet';
import { compactCount } from './hooks';

const WRITER_BADGE_NAMES = {
  successful: 'Afilli Başarılı Yazar',
  master: 'Afilli Usta Yazar',
  popular: 'Afilli Popüler Yazar',
} as const;
const PREMIUM_FRAME_COLORS: Record<string, string> = {
  classic: '#C9A24B', gold: '#C9A24B', rose: '#B86678', midnight: '#69657F',
};
const PREMIUM_BACKGROUND_COLORS: Record<string, [string, string, ...string[]]> = {
  classic: ['#F7F0E2', '#E8D8BA'],
  linen: ['#F3E6D4', '#D8C6A7', '#F9F2E5'],
  wine: ['#541727', '#8A2D46', '#2F1020'],
  starlight: ['#171726', '#38314C', '#676184'],
};

/** Every profile displays the same centrally configured official icon, if set. */
export function ProfileHeader({ profile, actions, onBooks }: { profile: ReaderProfile; actions: React.ReactNode; onBooks: () => void; viewerIsAdmin?: boolean }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const [list, setList] = useState<null | 'followers' | 'following'>(null);
  const crown = profile.premium ? 'premium' : profile.popular ? 'popular' : null;
  const preferences = profile.premium ? profile.premiumPreferences : null;
  const frameColor = PREMIUM_FRAME_COLORS[preferences?.profileFrame ?? 'classic'];
  const background = PREMIUM_BACKGROUND_COLORS[preferences?.profileBackground ?? 'classic'];
  const presence = { online: profile.online, typing: profile.typing, lastSeen: profile.lastSeen };
  const bioLines = profile.bio.split('\n').map((l) => l.trim()).filter(Boolean);
  const badgeNames = profile.writerBadges.map((badge) => WRITER_BADGE_NAMES[badge]);
  return (
    <View>
      <View style={[st.coverWrap, preferences && preferences.profileFrame !== 'classic' && { borderColor: frameColor, borderWidth: 2 }]}>
        {profile.cover ? <Image source={{ uri: mediaUrl(profile.cover) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Kapak fotoğrafı" />
          : <LinearGradient colors={background} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        {profile.cover && preferences && preferences.profileBackground !== 'classic' ? <LinearGradient
          colors={preferences?.profileBackground === 'wine' ? ['rgba(84,23,39,0.20)', 'rgba(47,16,32,0.20)']
            : preferences?.profileBackground === 'starlight' ? ['rgba(23,23,38,0.18)', 'rgba(56,49,76,0.18)']
              : ['rgba(243,230,212,0.20)', 'rgba(216,198,167,0.20)']}
          style={StyleSheet.absoluteFill} /> : null}
        <LinearGradient colors={['transparent', P.background]} style={[StyleSheet.absoluteFill, { top: '45%' }]} />
      </View>
      <View style={st.center}>
        {preferences?.profileFrame && preferences.profileFrame !== 'classic' ? (
          <View style={[st.avatarFrame, { borderColor: frameColor }]}>
            <GoldAvatar nickname={profile.nickname} avatar={profile.avatar} size={112} crown={crown} presence={presence} />
          </View>
        ) : <GoldAvatar nickname={profile.nickname} avatar={profile.avatar} size={118} crown={crown} presence={presence} />}
        {crown ? (
          <View style={st.badge} testID="profile-crown-badge">
            <Text style={st.badgeText}>{crown === 'premium' ? 'Afilli Premium' : 'Çok Okunan Yazar'}</Text>
          </View>
        ) : null}
        {badgeNames.length ? <View testID="profile-writer-badges" style={st.writerBadges}>
          {badgeNames.map((name) => <View key={name} style={st.writerBadge}><Text style={st.writerBadgeText}>{name}</Text></View>)}
        </View> : null}
        <Text style={st.name} accessibilityRole="header" testID="profile-name">{profile.nickname}</Text>
        <Text style={st.handle}>@{profile.handle}</Text>
        <OfficialInstagramIcon />
        <StatusLine presence={presence} />
        {bioLines.map((l, i) => <Text key={i} style={st.bio}>{l}</Text>)}
        {profile.quote ? <Text style={st.quote}>"{profile.quote}"</Text> : null}
        {profile.isAdmin ? <Text style={st.role}>Afilli ekibi</Text> : null}
        <Pressable testID="profile-premium-link" accessibilityRole="link" onPress={() => router.push('/premium')} style={st.premiumLink}>
          <Text style={st.premiumLinkText}>{profile.isMe && profile.premium ? 'Premium görünüm tercihlerini düzenle' : profile.isMe ? 'Afilli Premium başvurusu' : 'Afilli Premium ve yazar rozetleri'}</Text>
        </Pressable>
      </View>
      <View style={st.stats}>
        <StatCard testID="profile-stat-books" icon="book-open-page-variant" value={compactCount(profile.bookCount)} label="Kitap" onPress={onBooks} />
        <StatCard testID="profile-stat-followers" icon="account-group" value={compactCount(profile.followersCount)} label="Takipçi" onPress={() => setList('followers')} />
        <StatCard testID="profile-stat-following" icon="account-heart" value={compactCount(profile.followingCount)} label="Takip" onPress={() => setList('following')} />
      </View>
      <View style={st.actions}>{actions}</View>
      <ConnectionsSheet profileId={profile.id} kind={list} onClose={() => setList(null)} />
    </View>
  );
}

const useStStyles = makeStyles((t) => {
  const { magazine: P, social: S } = t;
  return StyleSheet.create({
  // +76 dp from 120 dp is approximately 2 cm on the common Android 160 dpi baseline.
  coverWrap: { height: 196, marginHorizontal: 18, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: P.border },
  center: { alignItems: 'center', marginTop: -62, paddingHorizontal: 24, gap: 4 },
  avatarFrame: { padding: 2, borderWidth: 2, borderRadius: 66, backgroundColor: P.card, marginBottom: 4 },
  badge: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: P.gold, backgroundColor: P.card },
  badgeText: { fontFamily: F.semi, fontSize: 11, letterSpacing: 0.6, color: S.foilDeep, textTransform: 'uppercase' },
  writerBadges: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  writerBadge: { borderWidth: 1, borderColor: S.foilMid, backgroundColor: P.card, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3 },
  writerBadgeText: { fontFamily: F.semi, fontSize: 11, color: S.foilDeep },
  premiumLink: { paddingHorizontal: 12, paddingVertical: 5, marginTop: 2 },
  premiumLinkText: { fontFamily: F.semi, fontSize: 12, color: S.foilDeep },
  name: { fontFamily: F.serifBold, fontSize: 32, color: P.text, textAlign: 'center', marginTop: 6, textShadowColor: 'rgba(201,162,75,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  handle: { fontFamily: F.med, fontSize: 14, color: S.foilDeep, marginBottom: 4 },
  bio: { fontFamily: F.med, fontSize: 14, color: P.text, textAlign: 'center', lineHeight: 21, marginTop: 4 },
  quote: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 15, color: P.muted, textAlign: 'center', lineHeight: 22, marginTop: 2 },
  role: { fontFamily: F.semi, fontSize: 11, color: P.muted, marginTop: 4 },
  stats: { flexDirection: 'row', gap: 10, marginHorizontal: 18, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 10, marginHorizontal: 18, marginTop: 14 },
  });
});
