import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Empty, SampleTag, ScreenHeader, webBottom } from '@/components/ui';
import { CopyGuard, CopyProtectionHint } from '@/components/writer/CopyGuard';
import { getBook } from '@/data/catalog';

const noCopy = Platform.OS === 'web' ? ({ userSelect: 'none', WebkitUserSelect: 'none' } as object) : {};

/** Static sample reader, remounted per account so one owner's saved chapter never leaks into another's. */
export default function Reader() {
  const { userId } = useAuth();
  const { id, c } = useLocalSearchParams<{ id: string; c?: string }>();
  return <SampleReader key={(userId ?? 'guest') + ':' + id} id={String(id ?? '')} explicit={c} />;
}

function SampleReader({ id, explicit }: { id: string; explicit?: string }) {
  const c = useColors();
  const { openBook, isSaved, toggleSave, ready, library } = useApp();
  const b = getBook(id);
  const [idx, setIdx] = useState<number | null>(() => {
    const n = Number(explicit);
    return explicit != null && Number.isInteger(n) && n >= 0 ? n : null;
  });
  const [size, setSize] = useState(18);
  // Without an explicit ?c, resume this owner's saved chapter once their device record is loaded.
  useEffect(() => {
    if (idx !== null || !ready || !b) return;
    const saved = library[b.id];
    setIdx(typeof saved === 'number' && saved >= 0 ? saved : 0);
  }, [idx, ready, b, library]);
  const total = b?.chapters.length ?? 0;
  const cur = idx === null ? null : Math.min(idx, Math.max(0, total - 1));
  useEffect(() => { if (b && total && ready && cur !== null) openBook(b.id, cur); }, [b?.id, cur, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b?.chapters.length) return <View style={{ flex: 1, backgroundColor: c.background }}><ScreenHeader title="Örnek okuma" /><Empty icon="book" title="Bölüm bulunamadı" text="Bu örnek bölüm kaldırılmış olabilir." /></View>;
  if (cur === null) return <View style={{ flex: 1, backgroundColor: c.paper }}><ScreenHeader title={b.title} /><Text style={[s.loading, { color: c.mutedForeground }]}>Kaldığın yer açılıyor…</Text></View>;
  const ch = b.chapters[cur];
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ScreenHeader title={b.title} right={
        <View style={{ flexDirection: 'row' }}>
          <Pressable testID="font-smaller" accessibilityRole="button" accessibilityLabel="Yazıyı küçült" onPress={() => setSize((x) => Math.max(14, x - 2))} style={s.tb}><Text style={[s.aa, { color: c.brown, fontSize: 13 }]}>A</Text></Pressable>
          <Pressable testID="font-larger" accessibilityRole="button" accessibilityLabel="Yazıyı büyüt" onPress={() => setSize((x) => Math.min(26, x + 2))} style={s.tb}><Text style={[s.aa, { color: c.brown }]}>A</Text></Pressable>
          <Pressable testID="reader-save" accessibilityRole="button" accessibilityLabel={isSaved(b.id) ? 'Kaydı kaldır' : 'Kaydet'} accessibilityState={{ selected: isSaved(b.id) }} disabled={!ready} onPress={() => toggleSave(b.id)} style={s.tb}><Feather name="bookmark" size={19} color={isSaved(b.id) ? c.gold : c.brown} /></Pressable>
        </View>} />
      <ScrollView contentContainerStyle={{ padding: 26, paddingBottom: 60 + webBottom }}>
        <View style={[s.sample, { borderColor: c.gold }]} testID="sample-banner">
          <Text style={[s.sampleText, { color: c.brown }]}>Örnek metin · Afilli okuma deneyimini tanıtmak için hazırlanmıştır, gerçek bir yayın değildir.</Text>
        </View>
        <Text style={[s.ch, { color: c.gold }]}>{ch.title}</Text>
        <View style={s.orn}><View style={[s.rule, { backgroundColor: c.gold }]} /><View style={[s.dot, { backgroundColor: c.gold }]} /><View style={[s.rule, { backgroundColor: c.gold }]} /></View>
        <CopyGuard><Text selectable={false} testID="sample-body" style={[s.body, noCopy, { color: c.foreground, fontSize: size, lineHeight: size * 1.65 }]}>{ch.body}</Text></CopyGuard>
        <Text style={[s.count, { color: c.mutedForeground }]}>Bölüm {cur + 1} / {total}</Text>
        <View style={s.nav}>
          <Pressable testID="prev-chapter" accessibilityRole="button" accessibilityState={{ disabled: cur <= 0 }} disabled={cur <= 0} onPress={() => setIdx(cur - 1)} style={{ opacity: cur <= 0 ? 0.3 : 1 }}><Text style={[s.nl, { color: c.brown }]}>Önceki bölüm</Text></Pressable>
          <Pressable testID="next-chapter" accessibilityRole="button" accessibilityState={{ disabled: cur >= total - 1 }} disabled={cur >= total - 1} onPress={() => setIdx(cur + 1)} style={{ opacity: cur >= total - 1 ? 0.3 : 1 }}><Text style={[s.nl, { color: c.brown }]}>Sonraki bölüm</Text></Pressable>
        </View>
        <CopyProtectionHint />
        <SampleTag />
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  tb: { padding: 8 },
  aa: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19 },
  loading: { textAlign: 'center', marginTop: 40, fontFamily: 'Inter_400Regular' },
  sample: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, padding: 10, marginBottom: 22 },
  sampleText: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center' },
  ch: { fontFamily: 'Inter_600SemiBold', fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center' },
  orn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginVertical: 16 },
  rule: { width: 28, height: 1 },
  dot: { width: 5, height: 5, borderRadius: 3, transform: [{ rotate: '45deg' }] },
  body: { fontFamily: 'PlayfairDisplay_400Regular_Italic' },
  count: { textAlign: 'center', marginTop: 30, fontFamily: 'Inter_400Regular', fontSize: 12 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 20 },
  nl: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
