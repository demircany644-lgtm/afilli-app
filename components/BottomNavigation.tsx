import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { tap } from '@/components/ui';
import { useGetBookNotifications, getGetBookNotificationsQueryKey } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { scoped, actorRequest } from '@/components/profile/hooks';
import { WriteDisc } from '@/components/home/Marks';
import colors from '@/constants/colors';
import { useAppearance } from '@/context/AppearanceContext';
import { useTheme } from '@/hooks/useTheme';

type NavItem = {
  path: Href;
  label: string;
  testID: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  activeIcon: keyof typeof MaterialCommunityIcons.glyphMap;
};

const ITEMS: NavItem[] = [
  { path: '/', label: 'Anasayfa', testID: 'tab-index', icon: 'home-outline', activeIcon: 'home' },
  { path: '/library', label: 'Kitaplarım', testID: 'tab-library', icon: 'bookshelf', activeIcon: 'bookshelf' },
  { path: '/write', label: 'Kitap Yaz', testID: 'tab-write', icon: 'feather', activeIcon: 'feather' },
  { path: '/saved', label: 'Bildirimler', testID: 'tab-saved', icon: 'bell-outline', activeIcon: 'bell' },
  { path: '/profile', label: 'Profil', testID: 'tab-profile', icon: 'account-outline', activeIcon: 'account' },
];

// A normal-flow sibling of the screen navigator: reserves its entire height,
// including the raised circle, so no scrollable content sits behind the bar.
export function BottomNavigation() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { ready, userId } = useCommunity();
  // Canonical server unread total for book notifications (chapter, book_like, book_comment, comment_reply).
  const book = useGetBookNotifications(undefined, { query: { enabled: ready && !!userId, queryKey: scoped(getGetBookNotificationsQueryKey(), userId), refetchInterval: 15000 }, request: actorRequest(userId) });
  const unreadCount = userId ? book.data?.unreadCount ?? 0 : 0;
  const hasUnread = unreadCount > 0;
  const { isLava } = useAppearance();
  const t = useTheme();
  const H = t.home;
  const bottom = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View testID="bottom-navigation" style={[styles.container, { backgroundColor: isLava ? colors.lava.bg : c.background, paddingBottom: bottom + 8 }]}>
      <View style={[styles.bar, { backgroundColor: isLava ? colors.lava.pill : H.navBar, borderColor: isLava ? c.border : t.social.foilMid, shadowColor: isLava ? colors.lava.flame : '#2B1A0E' }, isLava && { shadowOpacity: 0.45, shadowRadius: 14 }]}>
        {ITEMS.map((item, index) => {
          const active = pathname === item.path;
          const isWrite = index === 2;
          // Only the Profile tab turns gold when active; the rest keep the original brown.
          const color = isLava ? (active ? (index === 4 ? c.gold : c.brown) : c.mutedForeground) : active ? (index === 4 ? t.light.gold : H.ink) : t.light.mutedForeground;
          return (
            <Pressable
              key={item.testID}
              testID={item.testID}
              accessibilityRole="tab"
              accessibilityLabel={item.label + (index === 3 && hasUnread ? ', ' + unreadCount + ' okunmamış bildirim' : '')}
              accessibilityState={{ selected: active }}
              onPress={() => { tap(); router.navigate(item.path); }}
              style={({ pressed }) => [
                styles.item,
                isWrite && styles.writeItem,
                { opacity: pressed ? 0.75 : 1 },
              ]}
            >
              {isWrite ? (
                <>
                  <View style={[styles.writeCircle, { backgroundColor: isLava ? colors.lava.pill : H.navBar, borderColor: isLava ? 'transparent' : t.social.foilMid, shadowColor: '#000' }]}>
                    <WriteDisc size={70} disc={colors.home.disc} ring={colors.home.discRing} />
                  </View>
                  <Text numberOfLines={1} style={[styles.label, styles.writeLabel, { color: isLava ? colors.home.ink : H.ink, fontFamily: 'Inter_700Bold' }]}>Kitap Yaz</Text>
                </>
              ) : (
                <>
                  <View style={styles.icon}>
                    <MaterialCommunityIcons name={active ? item.activeIcon : item.icon} size={25} color={color} />
                    {index === 3 && hasUnread && (
                      <View testID="notification-unread-dot" style={[styles.dot, { backgroundColor: H.badge, borderColor: isLava ? c.background : H.navBar }]} />
                    )}
                  </View>
                  <Text numberOfLines={1} style={[styles.label, { color, fontFamily: active ? 'Inter_700Bold' : 'Inter_500Medium' }]}>{item.label}</Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexShrink: 0, paddingTop: 34, paddingHorizontal: 10 },
  bar: {
    height: 76, flexDirection: 'row', alignItems: 'stretch',
    borderRadius: 25, borderWidth: 1,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  item: { flex: 1, minWidth: 0, justifyContent: 'center', alignItems: 'center', gap: 4 },
  icon: { position: 'relative', width: 30, height: 29, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, lineHeight: 15, textAlign: 'center' },
  writeItem: { zIndex: 1, justifyContent: 'flex-end', paddingBottom: 10 },
  writeLabel: { marginTop: 0 },
  writeCircle: {
    position: 'absolute', top: -32, width: 80, height: 80, borderRadius: 40, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 6,
  },
  dot: { position: 'absolute', right: 0, top: 0, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
