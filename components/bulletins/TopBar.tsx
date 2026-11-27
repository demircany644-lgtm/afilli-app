import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F, tap } from '@/components/ui';


/** Keşfet and Mesaj are home-only; non-home headers may keep the profile action. */
export function TopBar({ title, backTo = '/', icons = true }: { title: string; backTo?: Href; icons?: boolean }) {
  const { magazine: b } = useTheme();
  const st = useStStyles();
  const insets = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? 67 : insets.top;
  const icon = (name: keyof typeof Feather.glyphMap, path: Href, label: string) => (
    <Pressable key={label} testID={'bulletins-' + name} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      onPress={() => { tap(); router.push(path); }} style={({ pressed }) => [st.icon, { opacity: pressed ? 0.6 : 1 }]}>
      <Feather name={name} size={20} color={b.text} />
    </Pressable>
  );
  return (
    <View style={[st.bar, { paddingTop: top + 4 }]}>
      <View style={st.side}>
        <Pressable testID="bulletins-back" accessibilityRole="button" accessibilityLabel="Geri" hitSlop={10}
          onPress={() => { tap(); if (router.canGoBack()) router.back(); else router.navigate(backTo); }} style={st.icon}>
          <Feather name="arrow-left" size={24} color={b.text} />
        </Pressable>
      </View>
      <Text style={st.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
      <View style={[st.side, { justifyContent: 'flex-end' }]}>
        {icons ? icon('user', '/profile', 'Profil') : null}
      </View>
    </View>
  );
}

const useStStyles = makeStyles((t) => {
  const { magazine: b } = t;
  return StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8, backgroundColor: b.background, borderBottomWidth: 1, borderColor: b.border },
  side: { width: 108, flexDirection: 'row', alignItems: 'center' },
  icon: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: F.serifBold, fontSize: 20, color: b.text },
  });
});
