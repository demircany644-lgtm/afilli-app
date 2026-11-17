import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { requestPasswordCode } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { Btn } from '@/components/bulletins/common';
import { AuthShell, Field, PasswordField, FormError, authMsg, goAfterAuth, st } from '@/components/bulletins/Auth';

export default function SignIn() {
  const auth = useAuth();
  const [step, setStep] = useState<'form' | 'forgot' | 'reset'>('form');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [challengeId, setChallenge] = useState(''), [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null), [info, setInfo] = useState<string | null>(null);
  const lock = useRef(false);
  const run = async () => {
    if (lock.current) return;
    setErr(null); setInfo(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Geçerli bir e-posta adresi yaz.'); return; }
    if (step !== 'forgot' && (!password || (step === 'reset' && password.length < 8))) {
      setErr(step === 'reset' ? 'Yeni şifre en az 8 karakter olmalı.' : 'Şifreni yaz.'); return;
    }
    lock.current = true; setBusy(true);
    try {
      if (step === 'forgot') {
        const result = await requestPasswordCode({ email: email.trim().toLowerCase() }, { credentials: 'include' });
        setChallenge(result.challengeId); setInfo(result.message); setCode(''); setPassword(''); setStep('reset');
      } else if (step === 'reset') {
        if (!/^[0-9]{6}$/.test(code)) { setErr('E-postadaki altı haneli kodu yaz.'); return; }
        await auth.resetPassword(challengeId, code, password); goAfterAuth();
      } else { await auth.login(email, password); goAfterAuth(); }
    } catch (error) { setErr(authMsg(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  if (auth.isSignedIn) return <AuthShell title="Giriş yapıldı" sub="Hesabın açık."><Btn label="Ana Sayfaya git" onPress={goAfterAuth} /></AuthShell>;
  return <AuthShell title={step === 'form' ? 'Giriş yap' : 'Şifre belirle'} sub={step === 'form'
    ? 'E-posta adresin ve şifrenle Afilli’ye devam et.'
    : 'Eski hesabını koruyarak şifre belirle veya şifreni yenile.'}>
    {auth.offline ? <Text style={st.sub}>Bağlantı yok veya oturum doğrulanamadı. Uygulama açık kalır; giriş için internet gerekir.</Text> : null}
    <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
      autoComplete="email" editable={!busy && step !== 'reset'} maxLength={254} testID="signin-email" />
    {step === 'reset' ? <Field label="Altı haneli kod" value={code} onChangeText={setCode} keyboardType="number-pad"
      autoComplete="one-time-code" maxLength={6} editable={!busy} testID="reset-code" /> : null}
    {step !== 'forgot' ? <PasswordField label={step === 'reset' ? 'Yeni şifre' : 'Şifre'} value={password}
      onChangeText={setPassword} autoComplete={step === 'reset' ? 'new-password' : 'current-password'}
      maxLength={128} editable={!busy} testID={step === 'reset' ? 'reset-password' : 'signin-password'} /> : null}
    <FormError text={err} />{info ? <Text style={st.sub} accessibilityLiveRegion="polite">{info}</Text> : null}
    <Btn label={step === 'form' ? 'Giriş yap' : step === 'forgot' ? 'Kod gönder' : 'Şifreyi değiştir ve giriş yap'}
      busy={busy} onPress={() => void run()} testID={step === 'form' ? 'signin-submit' : step === 'forgot' ? 'reset-send' : 'reset-submit'} />
    {step === 'form' ? <>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setErr(null); setStep('forgot'); setPassword(''); }}>
        <Text style={st.link}>Şifremi unuttum / Eski hesabıma geçiş</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><Text style={st.sub}>Hesabın yok mu?</Text>
        <Pressable accessibilityRole="link" disabled={busy} onPress={() => router.replace('/sign-up')}><Text style={st.link}>Kayıt ol</Text></Pressable>
      </View>
    </> : <Btn label={step === 'reset' ? 'Yeni kod iste' : 'Girişe dön'} ghost disabled={busy}
      onPress={() => { setStep(step === 'reset' ? 'forgot' : 'form'); setErr(null); setInfo(null); setPassword(''); }} />}
  </AuthShell>;
}
