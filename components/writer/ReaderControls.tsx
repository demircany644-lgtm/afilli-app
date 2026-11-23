import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { makeStyles } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { useWriterPalette, writerPalette } from '@/components/writer/parts';

export type ReaderChapter = { id: string; title: string; status: string; minutes?: number };
type Props = {
  chapters: ReaderChapter[]; currentId: string | null; disabled: boolean; fontSize: number; night: boolean; reading: boolean; bookTitle: string;
  onSelect: (id: string) => boolean; onFontChange: (delta: number) => void; onNightToggle: () => void; onDetails: () => void;
};
const NIGHT = { paper: '#2A1F15', line: '#3A2C1F', ink: '#EADBC4', muted: '#B9A58A' };
const ROW_H = 56;

/** Compact reader toolbar: chapter list (top-left), font size, night mode, and details exit while reading. */
export function ReaderControls({ chapters, currentId, disabled, fontSize, night, reading, bookTitle, onSelect, onFontChange, onNightToggle, onDetails }: Props) {
  const W = useWriterPalette();
  const st = useStyles();
  const insets = useSafeAreaInsets();
  const compact = useWindowDimensions().width < 420;
  const [open, setOpen] = useState(false);
  const listRef = useRef<FlatList<ReaderChapter>>(null);
  const ink = night ? NIGHT.ink : W.ink;
  const muted = night ? NIGHT.muted : W.muted;
  const paper = night ? NIGHT.paper : W.paper;
  const line = night ? NIGHT.line : W.line;
  const curIdx = chapters.findIndex((c) => c.id === currentId);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open || curIdx < 3) return;
    const t = setTimeout(() => listRef.current?.scrollToIndex({ index: curIdx, viewPosition: 0.4, animated: false }), 60);
    return () => clearTimeout(t);
  }, [open, curIdx]);

  const iconBtn = (icon: keyof typeof Feather.glyphMap, label: string, onPress: () => void, off: boolean, testID?: string, text?: string) => (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off }} disabled={off} hitSlop={4}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [st.icon, { borderColor: line, backgroundColor: paper, opacity: off ? 0.4 : pressed ? 0.7 : 1 }]}>
      {text ? <Text style={[st.aa, { color: ink }]}>{text}</Text> : <Feather name={icon} size={17} color={ink} />}
    </Pressable>
  );

  const settings = <View style={[st.controls, { justifyContent: 'flex-end' }]}>
    {iconBtn('minus', 'Yazıyı küçült', () => onFontChange(-2), fontSize <= 14, 'authored-font-smaller', 'A−')}
    <Text style={[st.size, { color: muted }]} accessibilityLabel={fontSize + ' punto'}>{fontSize}</Text>
    {iconBtn('plus', 'Yazıyı büyüt', () => onFontChange(2), fontSize >= 28, 'authored-font-larger', 'A+')}
    {iconBtn(night ? 'sun' : 'moon', night ? 'Gündüz modu' : 'Gece modu', onNightToggle, false, 'reader-night')}
  </View>;

  return (
    <View style={[st.bar, reading && { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 6 }]} accessibilityLabel="Okuma ayarları">
      <View style={st.controls}>
      <Pressable testID="chapter-list-open" accessibilityRole="button" accessibilityLabel={'Kitap Bölümleri' + (curIdx >= 0 ? ', ' + (curIdx + 1) + '. bölüm açık' : '')}
        accessibilityState={{ expanded: open }} disabled={chapters.length === 0} onPress={() => { tap(); setOpen(true); }}
        style={({ pressed }) => [st.listBtn, { backgroundColor: night ? NIGHT.ink : W.ink, opacity: chapters.length === 0 ? 0.5 : pressed ? 0.8 : 1 }]}>
        <Feather name="list" size={16} color={night ? NIGHT.paper : W.paper} />
        <Text style={[st.listText, { color: night ? NIGHT.paper : W.paper }]} numberOfLines={1}>Kitap Bölümleri</Text>
      </Pressable>
      <View style={st.spacer} />
      {reading ? iconBtn('info', 'Kitap bilgileri', onDetails, false, 'reader-details') : null}
      {!compact ? settings : null}
      </View>
      {compact ? settings : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={st.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Kapat" />
          <View testID="reader-chapter-sheet" accessibilityViewIsModal
            style={[st.sheet, { backgroundColor: paper, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 12) + 8 }]}>
            <View style={[st.grip, { backgroundColor: line }]} />
            <View style={st.head}>
              <View style={{ flex: 1 }}>
                <Text style={[st.title, { color: ink }]} accessibilityRole="header">Kitap Bölümleri</Text>
                <Text style={[st.sub, { color: muted }]} numberOfLines={1}>{(bookTitle || 'Adsız kitap') + ' · ' + chapters.length + ' bölüm'}</Text>
              </View>
              <Pressable testID="reader-chapter-close" onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kapat" style={st.close}>
                <Feather name="x" size={22} color={ink} />
              </Pressable>
            </View>
            {disabled ? <Text style={[st.note, { color: muted }]} accessibilityLiveRegion="polite">Kaldığın yer yükleniyor, birazdan bölüm seçebilirsin.</Text> : null}
            <FlatList ref={listRef} data={chapters} keyExtractor={(c) => c.id} style={st.list} initialNumToRender={20}
              getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
              onScrollToIndexFailed={({ index }) => listRef.current?.scrollToOffset({ offset: Math.max(0, (index - 2) * ROW_H), animated: false })}
              renderItem={({ item: c, index: i }) => {
                const on = c.id === currentId;
                const name = c.title?.trim() || 'Adsız bölüm';
                const draft = c.status === 'draft';
                return (
                  <Pressable testID={'read-chapter-' + i} accessibilityRole="button" disabled={disabled}
                    accessibilityState={{ selected: on, disabled }} accessibilityLabel={`${i + 1}. bölüm, ${name}${draft ? ', taslak' : ''}${on ? ', açık' : ''}`}
                    onPress={() => { tap(); if (onSelect(c.id)) close(); }}
                    style={({ pressed }) => [st.row, { borderTopColor: line, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }, on && { backgroundColor: night ? NIGHT.ink : W.ink }]}>
                    <Text style={[st.num, { color: on ? (night ? NIGHT.paper : W.gold) : W.gold }]}>{String(i + 1).padStart(2, '0')}</Text>
                    <Text style={[st.name, { color: on ? (night ? NIGHT.paper : W.paper) : ink }]} numberOfLines={2}>{name}</Text>
                    {draft ? <Text style={[st.draft, { borderColor: muted, color: on ? (night ? NIGHT.paper : W.paper) : muted }]}>Taslak</Text> : null}
                    {c.minutes != null ? <Text style={[st.min, { color: on ? (night ? NIGHT.paper : W.paper) : muted }]}>{c.minutes} dk</Text> : null}
                    {on ? <Feather name="check" size={15} color={night ? NIGHT.paper : W.gold} /> : null}
                  </Pressable>
                );
              }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    bar: { gap: 4, paddingVertical: 6, paddingHorizontal: 8 },
    controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    listBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 44, paddingHorizontal: 14, borderRadius: 22, flexShrink: 1 },
    listText: { fontFamily: F.semi, fontSize: 13.5, flexShrink: 1 },
    spacer: { flex: 1, minWidth: 4 },
    icon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    aa: { fontFamily: F.serifBold, fontSize: 15 },
    size: { fontFamily: F.semi, fontSize: 12, minWidth: 18, textAlign: 'center', fontVariant: ['tabular-nums'] },
    backdrop: { flex: 1, backgroundColor: 'rgba(43,29,18,0.5)', justifyContent: 'flex-end' },
    sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 2, borderColor: W.gold, paddingTop: 8, maxHeight: '82%', width: '100%', maxWidth: 720, alignSelf: 'center' },
    grip: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
    head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 10, gap: 10 },
    title: { fontFamily: F.serifBold, fontSize: 19 },
    sub: { fontFamily: F.body, fontSize: 12, marginTop: 2 },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    note: { fontFamily: F.med, fontSize: 12.5, paddingHorizontal: 18, paddingBottom: 8 },
    list: { flexGrow: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, height: ROW_H, paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth },
    num: { fontFamily: F.semi, fontSize: 12, width: 24, fontVariant: ['tabular-nums'] },
    name: { flex: 1, fontFamily: F.med, fontSize: 14.5 },
    draft: { fontFamily: F.semi, fontSize: 10, borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
    min: { fontFamily: F.body, fontSize: 11.5 },
  });
});
