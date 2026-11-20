import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useGetMyProfile, getGetMyProfileQueryKey } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { useApp } from '@/context/AppContext';
import { COLOR_THEMES, MAX_VOLUME, THEME_NAMES, useAppearance, type ThemeId } from '@/context/AppearanceContext';
import { F, tap } from '@/components/ui';
import { Sheet } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, TopBar, SectionLabel , useKitStyles } from '@/components/profile/kit';
import { DeleteAccountSheet, DeletionCleanupNotice } from '@/components/profile/DeleteAccount';
import { useAuth } from '@/context/AuthContext';
import { go, scoped, useOwnerGuard, withIdentity } from '@/components/profile/hooks';

function Row({ icon, label, sub, onPress, testID, danger }: { icon: keyof typeof Feather.glyphMap; label: string; sub?: string; onPress: () => void; testID: string; danger?: boolean }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [st.row, { backgroundColor: pressed ? P.input : 'transparent' }]}>
      <Feather name={icon} size={18} color={danger ? P.danger : P.gold} />
      <View style={{ flex: 1 }}>
        <Text style={[st.label, danger && { color: P.danger }]}>{label}</Text>
        {sub ? <Text style={st.sub}>{sub}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={P.muted} />
    </Pressable>
  );
}

function Choice({ label, sub, selected, onPress, testID }: { label: string; sub: string; selected: boolean; onPress: () => void; testID: string }) {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected, checked: selected }} aria-checked={selected} accessibilityLabel={label} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [st.row, { backgroundColor: pressed ? P.input : 'transparent' }]}>
      <View style={[st.radio, selected && { borderColor: P.gold }]}>{selected ? <View style={st.radioDot} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={st.label}>{label}</Text>
        <Text style={st.sub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function AppearanceSection() {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const a = useAppearance();
  const pct = Math.round(a.volume * 100);
  const steps = [0.03, 0.06, 0.09, 0.12, 0.15];
  const themes: { id: ThemeId; sub: string }[] = [
    { id: 'classic', sub: 'Krem kağıt, sade ve aydınlık' },
    { id: 'lava', sub: 'Siyah lav, canlı alevler, kor kıvılcımları' },
  ];
  return (<>
    <SectionLabel>Tema Rengi</SectionLabel>
    <Text style={[st.sub, { marginHorizontal: 20, marginTop: -6, marginBottom: 10 }]}>Uygulama rengini seç</Text>
    <View style={[k.card, st.swatchCard]} accessibilityRole="radiogroup" accessibilityLabel="Tema Rengi" testID="settings-theme-colors">
      {COLOR_THEMES.map((c) => {
        const on = a.theme === c.id;
        return (
          <Pressable key={c.id} testID={'settings-theme-color-' + c.id} accessibilityRole="radio" accessibilityLabel={c.label}
            accessibilityState={{ checked: on, selected: on }} aria-checked={on} aria-label={c.label}
            onPress={() => { tap(); a.setTheme(c.id); }} style={({ pressed }) => [st.swatchItem, { opacity: pressed ? 0.75 : 1 }]}>
            <View style={[st.swatchRing, { borderColor: on ? P.gold : 'transparent' }]}>
              <View style={[st.swatch, { backgroundColor: c.swatch }]}>
                {on ? <Feather name="check" size={20} color={c.dark ? '#FFF8EC' : '#2B211B'} /> : null}
              </View>
            </View>
            <Text numberOfLines={2} style={[st.swatchLabel, on && { fontFamily: F.semi, color: P.text }]}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
    <SectionLabel>Görünüm / Efekt</SectionLabel>
    {a.loadError ? <Notice tone="error" text={a.loadError + ' Varsayılan tema gösteriliyor.'} testID="settings-appearance-load-error" /> : null}
    {a.saveError ? <Notice tone="error" text={a.saveError} action={{ label: 'Tekrar dene', onPress: a.retrySave }} testID="settings-appearance-save-error" /> : null}
    <View style={k.card} accessibilityRole="radiogroup">
      {!a.ready ? <View style={st.row}><Text style={st.sub}>Görünüm ayarı yükleniyor...</Text></View> : null}
      {themes.map((t) => <Choice key={t.id} testID={'settings-theme-' + t.id} label={THEME_NAMES[t.id]} sub={t.sub} selected={a.theme === t.id} onPress={() => a.setTheme(t.id)} />)}
    </View>
    {a.isLava ? (<>
      <SectionLabel>Alev Sesi</SectionLabel>
      <View style={k.card}>
        <Pressable testID="settings-flame-sound" accessibilityRole="switch" accessibilityState={{ checked: a.sound }} accessibilityLabel={'Alev Sesi: ' + (a.sound ? 'Açık' : 'Kapalı')}
          onPress={() => { tap(); a.setSound(!a.sound); }} style={({ pressed }) => [st.row, { backgroundColor: pressed ? P.input : 'transparent' }]}>
          <Feather name={a.sound ? 'volume-1' : 'volume-x'} size={18} color={P.gold} />
          <View style={{ flex: 1 }}>
            <Text style={st.label}>Alev Sesi: {a.sound ? 'Açık' : 'Kapalı'}</Text>
            <Text style={st.sub}>Çok hafif odun çıtırtısı, döngüde çalar</Text>
          </View>
          <View style={[st.sw, a.sound && { backgroundColor: P.gold }]}><View style={[st.knob, a.sound && { alignSelf: 'flex-end' }]} /></View>
        </Pressable>
        {a.sound ? (
          <View style={[st.row, { flexDirection: 'column', alignItems: 'stretch' }]}>
            <Text style={st.label}>Ses Seviyesi: %{pct}</Text>
            <View style={st.steps} accessibilityRole="adjustable" accessibilityLabel={'Ses seviyesi yüzde ' + pct}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(e) => a.setVolume(a.volume + (e.nativeEvent.actionName === 'increment' ? 0.03 : -0.03))}>
              {steps.map((v) => (
                <Pressable key={v} testID={'settings-volume-' + Math.round(v * 100)} accessibilityLabel={'Yüzde ' + Math.round(v * 100)} hitSlop={6}
                  onPress={() => { tap(); a.setVolume(v); }} style={[st.step, { height: 10 + v * 140, backgroundColor: v <= a.volume + 0.001 ? P.gold : P.input }]} />
              ))}
            </View>
            <Text style={st.sub}>En fazla %{Math.round(MAX_VOLUME * 100)}. Uygulama arka plana geçince ses durur.</Text>
            <Text testID="settings-sound-state" style={[st.sub, a.soundState === 'error' && { color: P.danger }]}>
              {a.soundState === 'playing' ? 'Ses çalıyor.' : a.soundState === 'loading' ? 'Ses hazırlanıyor...' : a.soundState === 'blocked' ? 'Tarayıcı sesi otomatik başlatmaya izin vermedi.' : a.soundState === 'error' ? 'Ses çalınamadı' + (a.soundError ? ': ' + a.soundError : '.') : a.active ? '' : 'Uygulama arka planda; ses duraklatıldı.'}
            </Text>
            {a.soundState === 'blocked' || a.soundState === 'error' ? <FoilButton variant="outline" icon="play" label="Sesi başlat" testID="settings-sound-retry" onPress={a.retrySound} style={{ flex: 0, marginTop: 8 }} /> : null}
          </View>
        ) : null}
      </View>
      <Text style={[st.sub, { marginHorizontal: 20, marginTop: 8 }]}>
        {a.reduceMotion ? 'Hareketi azalt açık: alevler durağan gösteriliyor.' : a.lowPower === true ? 'Düşük güç modu algılandı: animasyonlar yavaşlatıldı.' : a.lowPower === null ? 'Bu cihazda düşük güç modu algılanamıyor; animasyonlar hafif tutuluyor.' : 'Animasyonlar hafif ve yavaş çalışır.'}
      </Text>
    </>) : null}
  </>);
}

function ProfileSettings() {
  const { magazine: P } = useTheme();
  const st = useStStyles();
  const k = useKitStyles();
  const { ready, userId, person, signOut } = useCommunity();
  const { legacyAvailable, importLocalData, storageError, retryLoad } = useApp();
  const me = useGetMyProfile({ query: { enabled: ready && !!userId, queryKey: scoped(getGetMyProfileQueryKey(), userId) } });
  const alive = useOwnerGuard(userId);
  const mine = ready && me.data && me.data.id === userId ? me.data : undefined;
  const isAdmin = !!mine?.isAdmin;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<{ name: string; bio: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const { role } = useAuth();

  const doImport = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await importLocalData();
      if (!alive()) return;
      setImported(r);
      setConfirm(false);
    } catch { if (alive()) setErr('Eski veriler aktarılamadı. Cihazdaki veriler silinmedi; tekrar dene.'); }
    finally { if (alive()) setBusy(false); }
  };
  const leave = async (thenSignIn: boolean) => {
    setSigningOut(true); setErr(null);
    try { await signOut(thenSignIn ? '/sign-in' : '/profile'); if (thenSignIn) router.replace('/sign-in'); else router.replace('/profile'); }
    catch { setErr('Çıkış yapılamadı. İnternet bağlantısı yok, tekrar dene.'); }
    finally { setSigningOut(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <TopBar back title="Ayarlar" />
        <DeletionCleanupNotice />
        {err ? <Notice tone="error" text={err} testID="settings-error" /> : null}

        <SectionLabel>Hesap</SectionLabel>
        <View style={k.card}>
          {userId ? (<>
            <View style={st.row}>
              <Feather name="user" size={18} color={P.gold} />
              <View style={{ flex: 1 }}>
                <Text style={st.label}>{mine?.nickname ?? (ready ? person?.nickname : undefined) ?? 'Hesabın'}</Text>
                <Text style={st.sub}>{mine ? '@' + mine.handle : 'Oturum açık'}{role === 'superadmin' ? '  ·  En Üst Yetkili' : role === 'admin' ? '  ·  Yönetici' : ''}</Text>
              </View>
            </View>
            <Row icon="edit-2" label="Profili Düzenle" testID="settings-edit-profile" onPress={() => go('/profile-edit')} />
            <Row icon="repeat" label="Hesap değiştir" sub="Çıkış yapıp başka bir hesapla gir" testID="settings-switch-account" onPress={() => leave(true)} />
            <Row icon="log-out" label={signingOut ? 'Çıkış yapılıyor...' : 'Çıkış yap'} testID="settings-sign-out" danger onPress={() => leave(false)} />
          </>) : (<>
            <Row icon="log-in" label="Giriş yap" sub="Profilin ve mesajların hesabınla eşitlenir" testID="settings-sign-in" onPress={() => go('/sign-in')} />
            <Row icon="user-plus" label="Hesap oluştur" testID="settings-sign-up" onPress={() => go('/sign-up')} />
          </>)}
        </View>

        <AppearanceSection />

        <SectionLabel>Bu cihazdaki veriler</SectionLabel>
        <View style={[k.card, { padding: 16, gap: 10 }]}>
          {storageError ? (<>
            <Text style={[st.sub, { color: P.danger }]}>{storageError}</Text>
            <FoilButton variant="outline" label="Yeniden yükle" icon="refresh-cw" testID="settings-storage-retry" onPress={retryLoad} style={{ flex: 0 }} />
          </>) : null}
          {imported ? (<>
            <Text style={st.label}>Eski verilerin bu hesaba aktarıldı.</Text>
            {imported.name || imported.bio ? (<>
              <Text style={st.sub}>Eski adın "{imported.name}"{imported.bio ? ' ve tanıtımın' : ''} profiline otomatik yazılmadı. İstersen düzenleyicide gözden geçirip kaydedebilirsin.</Text>
              <FoilButton label="Profil düzenleyicide kullan" icon="edit-2" testID="settings-import-prefill"
                onPress={() => router.push({ pathname: '/profile-edit', params: { prefillName: imported.name, prefillBio: imported.bio } } as never)} style={{ flex: 0 }} />
            </>) : null}
          </>) : legacyAvailable && userId ? (<>
            <Text style={st.label}>Bu cihazda hesapsız kullanılan eski Afilli verileri var.</Text>
            <Text style={st.sub}>Kitaplık ilerlemen, kayıtların ve taslakların yalnızca sen onaylarsan bu hesaba aktarılır.</Text>
            <FoilButton label="Eski verileri bu hesaba aktar" icon="download" testID="settings-import" onPress={() => setConfirm(true)} style={{ flex: 0 }} />
          </>) : legacyAvailable ? (
            <Text style={st.sub}>Bu cihazda eski veriler var. Aktarmak için önce giriş yap.</Text>
          ) : (
            <Text style={st.sub}>Kitaplık, kayıtlar ve taslaklar bu cihazda hesabına göre ayrı saklanır. Aktarılacak eski veri yok.</Text>
          )}
        </View>

        {userId ? (<>
          <SectionLabel>Hesabı sil</SectionLabel>
          <View style={k.card}>
            <Row icon="trash-2" label="Hesabımı kalıcı olarak sil" sub="Kitapların, gönderilerin ve sohbetlerin geri alınamaz biçimde silinir" testID="settings-delete-account" danger onPress={() => setDeletionOpen(true)} />
          </View>
        </>) : null}

        {isAdmin ? (<>
          <SectionLabel>Yönetim</SectionLabel>
          <View style={k.card}>
            <Row icon="shield" label="Yönetim paneli" sub="Genel durum, hesaplar, içerik denetimi ve geçmiş" testID="settings-admin-panel" onPress={() => go('/admin')} />
            <Row icon="instagram" label="Instagram Linki" sub="Uygulamanın ortak Instagram hesabı" testID="settings-admin" onPress={() => go('/social-admin')} />
          </View>
        </>) : null}

      </ScrollView>
      <Sheet visible={confirm} onClose={() => { if (!busy) setConfirm(false); }} title="Eski verileri aktar" testID="settings-import-sheet">
        <View style={{ padding: 18, gap: 12 }}>
          <Text style={st.sub}>Bu cihazdaki eski kitaplık ilerlemesi, kayıtlar ve taslaklar şu anki hesabına bağlanacak. Adın ve tanıtımın otomatik değiştirilmez.</Text>
          <FoilButton label="Aktar" icon="download" testID="settings-import-confirm" busy={busy} onPress={doImport} style={{ flex: 0 }} />
          <FoilButton variant="outline" label="Vazgeç" testID="settings-import-cancel" disabled={busy} onPress={() => setConfirm(false)} style={{ flex: 0 }} />
        </View>
      </Sheet>
      {userId ? <DeleteAccountSheet visible={deletionOpen} onClose={() => setDeletionOpen(false)} /> : null}
    </View>
  );
}

const useStStyles = makeStyles((t) => {
  const { magazine: P } = t;
  return StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
  label: { fontFamily: F.semi, fontSize: 15, color: P.text },
  swatchCard: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 14 },
  swatchItem: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
  swatchRing: { width: 54, height: 54, borderRadius: 27, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(120,100,80,0.35)' },
  swatchLabel: { fontFamily: F.med, fontSize: 11.5, lineHeight: 15, color: P.muted, textAlign: 'center' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: P.border, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: P.gold },
  sw: { width: 44, height: 26, borderRadius: 13, backgroundColor: P.input, padding: 3, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: P.card },
  steps: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10, marginBottom: 6, height: 34 },
  step: { flex: 1, borderRadius: 4 },
  sub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: P.muted, marginTop: 2 },
  });
});

export default withIdentity(ProfileSettings);
