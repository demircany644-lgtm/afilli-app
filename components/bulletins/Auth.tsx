import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { F } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { TopBar } from '@/components/bulletins/TopBar';
import { b, Btn } from '@/components/bulletins/common';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

/** Prefer the server's Turkish error without logging credentials or codes. */
export function authMsg(e: unknown, fallback = 'Bağlantı kurulamadı. Yeniden dene.') {
  if (!e || typeof e !== 'object') return fallback;
  const x = e as { data?: { error?: string }; message?: string };
  return x.data?.error || (x.message && !x.message.includes('fetch') ? x.message : fallback) || fallback;
}
export function guardAuthAction(action: () => Promise<void>, report: (message: string) => void) {
  return () => { void action().catch((error: unknown) => report(authMsg(error))); };
}

export function goAfterAuth() { router.replace('/'); }

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const { error } = useCommunity();
  return (
    <View style={{ flex: 1, backgroundColor: b.background }}>
      <TopBar title={title} backTo="/bultenler" icons={false} />
      <KeyboardAwareScrollViewCompat contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <View style={st.card}>
          <Text style={st.kicker}>AFİLLİ TOPLULUK</Text>
          <Text style={st.title} accessibilityRole="header">{title}</Text>
          <Text style={st.sub}>{sub}</Text>
          {error ? <Text style={st.err}>{error}</Text> : null}
          {children}
        </View>
        <Pressable accessibilityRole="button" testID="auth-cancel" onPress={() => router.navigate('/bultenler')} style={st.cancel}>
          <Feather name="arrow-left" size={15} color={b.muted} /><Text style={st.cancelText}>Vazgeç, Bültenler'e dön</Text>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput placeholderTextColor={b.muted} style={[st.input, !!error && { borderColor: b.danger }]} accessibilityLabel={label} {...props} />
      {error ? <Text style={st.err}>{error}</Text> : null}
    </View>
  );
}

export function FormError({ text }: { text: string | null }) {
  return text ? <Text style={st.err} accessibilityLiveRegion="polite" testID="auth-error">{text}</Text> : null;
}

export function PasswordField(props: TextInputProps & { label: string; error?: string | null }) {
  const [visible, setVisible] = useState(false);
  return <View style={{ gap: 6 }}>
    <Field {...props} secureTextEntry={!visible} autoCapitalize="none" />
    <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Şifreyi gizle' : 'Şifreyi göster'}
      onPress={() => setVisible(value => !value)} style={{ minHeight: 36, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <Feather name={visible ? 'eye-off' : 'eye'} color={b.text} size={18} />
      <Text style={st.link}>{visible ? 'Şifreyi gizle' : 'Şifreyi göster'}</Text>
    </Pressable>
  </View>;
}

export const st = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 40, maxWidth: 460, width: '100%', alignSelf: 'center' },
  card: { backgroundColor: b.card, borderRadius: 22, padding: 20, gap: 14, borderWidth: 1.5, borderColor: b.gold },
  kicker: { fontFamily: F.semi, fontSize: 10, letterSpacing: 2, color: b.gold },
  title: { fontFamily: F.serifBold, fontSize: 28, color: b.text },
  sub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: b.muted },
  label: { fontFamily: F.semi, fontSize: 12, color: b.text },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: b.border, backgroundColor: b.background, paddingHorizontal: 12, fontFamily: F.body, fontSize: 15, color: b.text },
  err: { color: b.danger, fontFamily: F.med, fontSize: 13, lineHeight: 18 },
  link: { fontFamily: F.semi, fontSize: 13, color: b.text, textDecorationLine: 'underline' },
  div: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: b.border },
  cancel: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', padding: 16 },
  cancelText: { fontFamily: F.med, fontSize: 13, color: b.muted },
});
