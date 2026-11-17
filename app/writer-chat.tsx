import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { tap } from '@/components/ui';
import { WriterChatFrame } from '@/components/WriterChatFrame';

export default function WriterChat() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const back = () => {
    tap();
    if (router.canGoBack()) router.back();
    else router.replace('/messages');
  };
  return (
    <View testID="writer-chat-screen" style={[s.screen, { backgroundColor: c.background, paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom }]}>
      <View style={[s.header, { paddingTop: Platform.OS === 'web' ? 67 : insets.top, borderBottomColor: c.border }]}>
        <Pressable testID="writer-chat-back" accessibilityRole="button" accessibilityLabel="Geri"
          onPress={back} style={({ pressed }) => [s.back, { opacity: pressed ? 0.6 : 1 }]}>
          <Feather name="chevron-left" size={26} color={c.brown} />
        </Pressable>
      </View>
      <WriterChatFrame />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  header: { paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
});
