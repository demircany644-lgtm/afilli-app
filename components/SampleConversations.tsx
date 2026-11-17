import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SAMPLE_CHATS } from '@/data/sample-chats';
import { useColors } from '@/hooks/useColors';
import { F } from '@/components/ui';

export function SampleConversations() {
  const c = useColors();
  return <View style={s.wrap} testID="sample-conversations">
    <Text style={[s.title, { color: c.brown }]}>Örnek sohbetler</Text>
    <Text style={[s.note, { color: c.mutedForeground }]}>Denemek için hazırlanmıştır; gerçek kişilere mesaj gönderilmez.</Text>
    {SAMPLE_CHATS.map((chat) => <Pressable key={chat.id} testID={'sample-conversation-' + chat.id} accessibilityRole="button" accessibilityLabel={chat.name} onPress={() => router.push({ pathname: '/sample-chat/[id]', params: { id: chat.id } })} style={({ pressed }) => [s.row, { backgroundColor: c.paper, borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}>
      <Feather name="message-circle" size={22} color={c.gold} />
      <View style={{ flex: 1, gap: 4 }}><Text style={[s.name, { color: c.brown }]}>{chat.name}</Text><Text style={[s.note, { color: c.mutedForeground }]}>{chat.preview}</Text></View>
      <Feather name="chevron-right" size={17} color={c.mutedForeground} />
    </Pressable>)}
  </View>;
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 18, paddingVertical: 12, gap: 8 },
  title: { fontFamily: F.serifBold, fontSize: 20 },
  name: { fontFamily: F.semi, fontSize: 14 },
  note: { fontFamily: F.body, fontSize: 12, lineHeight: 18 },
  row: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
