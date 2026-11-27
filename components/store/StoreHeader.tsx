import React, { type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F, tap } from '@/components/ui';
import colors from '@/constants/colors';

export function StoreHeader({ title, backFallback, right }: { title: string; backFallback: string; right?: ReactNode }) {
  const inset = useSafeAreaInsets();
  const P = colors.store;
  return (
    <View style={[s.header, { paddingTop: (Platform.OS === 'web' ? 67 : inset.top) + 4 }]}>
      <Pressable testID="store-back" accessibilityRole="button" accessibilityLabel="Geri" onPress={() => {
        tap();
        router.canGoBack() ? router.back() : router.replace(backFallback as never);
      }} style={s.back}>
        <Feather name="chevron-left" size={24} color={P.goldLight} />
      </Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={[s.title, { color: P.goldLight }]}>{title}</Text>
      <View style={s.right}>{right}</View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: F.serifBold, fontSize: 25 },
  right: { flexDirection: 'row', alignItems: 'center', minWidth: 42, justifyContent: 'flex-end' },
});
