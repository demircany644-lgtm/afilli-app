import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { makeStyles } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { Btn } from '@/components/bulletins/common';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Banner, FadeIn, useWriterPalette, writerPalette } from '@/components/writer/parts';

export type WriterStartProps = { onLibrary: () => void; onCreate: () => void; busy: boolean; error: string | null };

/** Stage-3 entry for Kitap Yaz: two choices. Presentational only; parent owns routing, creation, busy and error. */
export function WriterStart({ onLibrary, onCreate, busy, error }: WriterStartProps) {
  const W = useWriterPalette();
  const s = useStyles();
  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: 60 }}>
        <Text style={s.h} accessibilityRole="header">Kitap Yaz</Text>
        <Text style={s.lead}>Ne yapmak istediğini seç. Bu sayfayı açmak yeni bir kitap oluşturmaz.</Text>

        <FadeIn>
          <Pressable testID="writer-start-library" accessibilityRole="button" accessibilityLabel="Kitaplarım" accessibilityHint="Kayıtlı kitaplarını açar"
            accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { tap(); onLibrary(); }}
            style={({ pressed }) => [s.card, { opacity: busy ? 0.5 : pressed ? 0.85 : 1 }]}>
            <View style={s.iconLight}><Feather name="book-open" size={24} color={W.ink} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Kitaplarım</Text>
              <Text style={s.cardSub}>Başladığın kitaplara ve taslaklarına dön.</Text>
            </View>
            <Feather name="chevron-right" size={22} color={W.muted} />
          </Pressable>
        </FadeIn>

        <FadeIn delay={60}>
          <Pressable testID="writer-start-new" accessibilityRole="button" accessibilityLabel="Yeni Kitap Yaz" accessibilityHint="Yeni bir kitap oluşturur"
            accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => { tap(); onCreate(); }}
            style={({ pressed }) => [s.hero, { opacity: busy ? 0.6 : pressed ? 0.92 : 1 }, pressed && !busy && { transform: [{ scale: 0.99 }] }]}>
            <View style={s.heroIcon}><Feather name="feather" size={24} color={W.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle}>Yeni Kitap Yaz</Text>
              <Text style={s.heroSub}>{busy ? 'Kitap hazırlanıyor...' : 'Yalnızca bu seçeneğe dokunduğunda yeni kitap oluşturulur.'}</Text>
            </View>
            {busy ? <ActivityIndicator size="small" color={W.paper} /> : <Feather name="arrow-right" size={22} color={W.paper} />}
          </Pressable>
        </FadeIn>

        {error ? (
          <Banner testID="writer-start-error" icon="alert-triangle" tone="err" title="Yeni kitap oluşturulamadı" text={error}>
            <Btn label="Tekrar dene" ghost disabled={busy} onPress={onCreate} testID="writer-start-retry" />
          </Banner>
        ) : null}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    h: { fontFamily: F.serifBold, fontSize: 24, color: W.ink, marginHorizontal: 18, marginTop: 20 },
    lead: { fontFamily: F.body, fontSize: 13.5, lineHeight: 19, color: W.muted, marginHorizontal: 18, marginTop: 6, marginBottom: 4 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginTop: 12, padding: 18, borderRadius: 22, backgroundColor: W.paper, borderWidth: 1, borderColor: W.line },
    iconLight: { width: 52, height: 52, borderRadius: 26, backgroundColor: W.soft, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { fontFamily: F.serifBold, fontSize: 20, color: W.ink },
    cardSub: { fontFamily: F.body, fontSize: 12.5, lineHeight: 18, color: W.muted, marginTop: 3 },
    hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginTop: 12, padding: 18, borderRadius: 22, backgroundColor: W.ink },
    heroIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: W.gold, alignItems: 'center', justifyContent: 'center' },
    heroTitle: { fontFamily: F.serifBold, fontSize: 20, color: W.paper },
    heroSub: { fontFamily: F.body, fontSize: 12.5, lineHeight: 18, color: W.paper, opacity: 0.85, marginTop: 3 },
  });
});
