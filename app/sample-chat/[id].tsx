import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { SAMPLE_CHATS } from '@/data/sample-chats';
import { SAMPLE_CHAT_LIMIT, parseSampleChat, sampleChatKey, type SampleChatLine } from '@/lib/sample-chat';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Empty, F, ScreenHeader } from '@/components/ui';

export default function SampleChatRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { isLoaded, userId } = useAuth();
  const chat = SAMPLE_CHATS.find((item) => item.id === id);
  if (!chat) return <View style={{ flex: 1 }}><ScreenHeader title="Örnek sohbet" /><Empty icon="message-circle" title="Sohbet bulunamadı" text="Mesajlar sayfasından bir örnek sohbet seçebilirsin." /></View>;
  if (!isLoaded) return <View><Text>Oturum kontrol ediliyor…</Text></View>;
  return <SampleChat key={(userId ?? 'guest') + ':' + chat.id} owner={userId ?? 'guest'} chat={chat} />;
}

function SampleChat({ owner, chat }: { owner: string; chat: (typeof SAMPLE_CHATS)[number] }) {
  const c = useColors();
  const [lines, setLines] = useState<SampleChatLine[]>([]);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const current = useRef<SampleChatLine[]>([]);
  const locked = useRef(false);
  const alive = useRef(true);
  const key = sampleChatKey(owner, chat.id);
  useEffect(() => {
    let active = true;
    alive.current = true;
    setStatus('loading'); setError(null);
    AsyncStorage.getItem(key).then((raw) => {
      const restored = parseSampleChat(raw);
      if (active) { current.current = restored; setLines(restored); setStatus('ready'); }
    }).catch(() => {
      if (active) { setStatus('error'); setError('Örnek sohbetin cihaz kaydı okunamadı. Kayıt silinmedi; yeniden dene.'); }
    });
    return () => { active = false; alive.current = false; };
  }, [key, attempt]);

  const send = async () => {
    const text = body.trim();
    if (!text || text.length > 1000 || status !== 'ready' || locked.current || current.current.length >= SAMPLE_CHAT_LIMIT) return;
    locked.current = true; setBusy(true); setError(null);
    const next = [...current.current, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 10), body: text, createdAt: new Date().toISOString() }];
    try {
      // Capture the account's storage key; commit before displaying a successful save.
      await AsyncStorage.setItem(key, JSON.stringify(next));
      if (alive.current) {
        current.current = next; setLines(next); setBody(''); input.current?.focus();
      }
    } catch {
      if (alive.current) setError('Mesaj bu cihaza kaydedilemedi. Yazdığın metin korunuyor; tekrar dene.');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1, backgroundColor: c.background }}>
    <ScreenHeader title="Örnek sohbet" />
    <Text style={[s.name, { color: c.brown }]}>{chat.name}</Text>
    <Text style={[s.notice, { color: c.mutedForeground }]}>Bu bir denemedir. Gerçek kişiye gönderilmez; eklediklerin bu cihazda hesabına bağlı saklanır.</Text>
    {status === 'loading' ? <Text style={[s.notice, { color: c.mutedForeground }]}>Cihaz kaydı açılıyor…</Text> : null}
    <FlatList inverted data={[...lines].reverse()} keyExtractor={(line) => line.id}
      style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
      renderItem={({ item }) => <View testID={'sample-chat-line-' + item.id} style={[s.bubble, { backgroundColor: c.brown, alignSelf: 'flex-end' }]}><Text style={[s.text, { color: c.paper }]}>{item.body}</Text><Text style={[s.meta, { color: c.paper }]}>Bu cihazda kaydedildi</Text></View>}
      ListFooterComponent={<View style={[s.bubble, { alignSelf: 'flex-start', backgroundColor: c.paper, borderWidth: 1, borderColor: c.border }]}><Text style={[s.text, { color: c.brown }]}>{chat.body}</Text><Text style={[s.meta, { color: c.mutedForeground }]}>Örnek mesaj</Text></View>} />
    {error ? <View style={s.error}><Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text>{status === 'error' ? <Pressable testID="sample-chat-retry" accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)}><Text style={{ color: c.gold }}>Yeniden dene</Text></Pressable> : null}</View> : null}
    {lines.length >= SAMPLE_CHAT_LIMIT ? <Text style={[s.notice, { color: c.mutedForeground }]}>Bu örnek sohbetin 200 mesajlık cihaz sınırına ulaştın.</Text> : null}
    <View style={[s.composer, { borderColor: c.border }]}>
      <TextInput ref={input} testID="sample-chat-input" accessibilityLabel="Örnek mesaj yaz" placeholder="Örnek mesaj yaz…" placeholderTextColor={c.mutedForeground}
        value={body} onChangeText={setBody} maxLength={1000} multiline editable={status === 'ready' && !busy && lines.length < SAMPLE_CHAT_LIMIT}
        style={[s.input, { color: c.brown, backgroundColor: c.paper, borderColor: c.border }]} />
      <Pressable testID="sample-chat-send" accessibilityRole="button" accessibilityLabel="Örnek mesaja ekle" accessibilityState={{ disabled: busy || status !== 'ready' || !body.trim() || lines.length >= SAMPLE_CHAT_LIMIT }} disabled={busy || status !== 'ready' || !body.trim() || lines.length >= SAMPLE_CHAT_LIMIT} onPress={() => void send()} style={{ padding: 12, opacity: busy || !body.trim() ? 0.4 : 1 }}>
        <Feather name={busy ? 'clock' : 'send'} size={24} color={c.brown} />
      </Pressable>
    </View>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  name: { marginHorizontal: 18, fontFamily: F.serifBold, fontSize: 20 },
  notice: { marginHorizontal: 18, marginVertical: 8, fontFamily: F.body, fontSize: 12, lineHeight: 18 },
  bubble: { maxWidth: '87%', borderRadius: 16, padding: 13, gap: 7 },
  text: { fontFamily: F.body, fontSize: 15, lineHeight: 22 },
  meta: { fontFamily: F.body, fontSize: 10, opacity: 0.8 },
  composer: { borderTopWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, minHeight: 46, maxHeight: 110, borderWidth: 1, borderRadius: 16, padding: 12, fontFamily: F.body, fontSize: 14 },
  error: { paddingHorizontal: 18, gap: 8, paddingVertical: 8 },
});
