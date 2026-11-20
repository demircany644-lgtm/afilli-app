import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { LavaBackdrop } from '@/components/theme/LavaBackdrop';

export function TabTitle({ title, sub }: { title: string; sub?: string }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: (Platform.OS === 'web' ? 67 : ins.top) + 8, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: c.chrome.bg, overflow: 'hidden' }}>
      {c.isLava ? <LavaBackdrop still /> : null}
      <Text style={[s.t, { color: c.chrome.text }]}>{title}</Text>
      {sub && <Text style={[s.s, { color: c.isLava ? 'rgba(251,244,234,0.78)' : c.mutedForeground }]}>{sub}</Text>}
    </View>
  );
}
const s = StyleSheet.create({ t: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28 }, s: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 4 } });
