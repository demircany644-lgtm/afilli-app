import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Btn, b } from '@/components/bulletins/common';
import { AuthShell, Field, PasswordField, FormError, authMsg, goAfterAuth, st } from '@/components/bulletins/Auth';

export default function SignUp() {
  const auth = useAuth();
  const [email, setEmail] = useState(''), [nick, setNick] = useState(''), [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);
  const submit = async () => {
    if (lock.current) return;
    setErr(null);
    if (nick.trim().length < 3 || nick.trim().length > 15) { setErr('Takma ad 3–15 karakter olmalı.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Geçerli bir e-posta adresi yaz.'); return; }
    if (password.length < 8) { setErr('Şifre en az 8 karakter olmalı.'); return; }
    if (!accepted) { setErr('Devam etmek için topluluk kurallarını kabul et.'); return; }
    lock.current = true; setBusy(true);
    try { await auth.register(email, nick, password, true); goAfterAuth(); }
    catch (error) { setErr(authMsg(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  if (auth.isSignedIn) return <AuthShell title="Hoş geldin" sub="Hesabın açık."><Btn label="Ana Sayfaya git" onPress={goAfterAuth} /></AuthShell>;
  return <AuthShell title="Kayıt ol" sub="Takma adın, e-posta adresin ve şifrenle Afilli’ye katıl.">
    <Field label="Takma ad" value={nick} onChangeText={setNick} maxLength={15} autoComplete="nickname" editable={!busy} testID="signup-nick" />
    <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
      autoComplete="email" maxLength={254} editable={!busy} testID="signup-email" />
    <PasswordField label="Şifre" value={password} onChangeText={setPassword} autoComplete="new-password"
      maxLength={128} editable={!busy} testID="signup-password" />
    <Text style={st.sub}>Şifren en az 8 karakter olmalı; özel karakter şartı yok.</Text>
    <Text style={st.sub}>Başkalarının haklarına saygı göster; izinsiz içerik, taciz ve kişisel bilgi paylaşma.</Text>
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted, disabled: busy }} disabled={busy}
      onPress={() => setAccepted(value => !value)} testID="signup-rules" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44 }}>
      <Feather name={accepted ? 'check-square' : 'square'} color={b.text} size={22} />
      <Text style={[st.sub, { flex: 1 }]}>Topluluk kurallarını kabul ediyorum.</Text>
    </Pressable>
    <FormError text={err} />
    <Btn label="Kayıt ol" busy={busy} onPress={() => void submit()} testID="signup-submit" />
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><Text style={st.sub}>Zaten hesabın var mı?</Text>
      <Pressable accessibilityRole="link" disabled={busy} onPress={() => router.replace('/sign-in')}><Text style={st.link}>Giriş yap</Text></Pressable>
    </View>
  </AuthShell>;
}
