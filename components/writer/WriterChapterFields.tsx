import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { WriterChapter } from '@workspace/api-client-react';
import { makeStyles } from '@/hooks/useTheme';
import { F } from '@/components/ui';
import { Btn } from '@/components/bulletins/common';
import { CHAPTER_TITLE_MAX } from '@/lib/writer-text';
import { useWriterPalette, writerPalette, Label } from '@/components/writer/parts';

type Props = { chapter: WriterChapter; count: number; onTitleChange: (value: string) => void; onAdd: () => void; onSave: () => void; busy: boolean; disabled: boolean };

export function WriterChapterFields({ chapter, count, onTitleChange, onAdd, onSave, busy, disabled }: Props) {
  const W = useWriterPalette();
  const s = useCfStyles();
  const title = chapter.title ?? '';
  return (
    <View style={s.card}>
      <Label right={title.length + ' / ' + CHAPTER_TITLE_MAX}>Bölüm Başlığı</Label>
      <TextInput testID="writer-chapter-title" value={title} maxLength={CHAPTER_TITLE_MAX} editable={!disabled}
        onChangeText={onTitleChange} placeholder="Bölümün adı" placeholderTextColor={W.muted}
        accessibilityLabel="Bölüm başlığı" style={s.title} />
      <Text style={s.hint}>Toplam {count} bölüm. Kaydetmek bölümü kitap bilgileriyle birlikte taslak olarak saklar; yayınlamaz.</Text>
      <View style={s.row}>
        <Btn label="Yeni bölüm oluştur" icon="plus" ghost testID="writer-form-add-chapter" disabled={disabled || busy} onPress={onAdd} style={s.btn} />
        <Btn label="Bölümü Kaydet" icon="save" testID="writer-form-save-chapter" busy={busy} disabled={disabled} onPress={onSave} style={s.btn} />
      </View>
    </View>
  );
}

const useCfStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    card: { marginHorizontal: 16, marginTop: 14, padding: 16, paddingTop: 2, backgroundColor: W.paper, borderRadius: 20, borderWidth: 1, borderColor: W.line },
    title: { fontFamily: F.serifBold, fontSize: 18, color: W.ink, borderBottomWidth: 1.5, borderColor: W.gold, paddingVertical: 8, minHeight: 44 },
    hint: { fontFamily: F.body, fontSize: 11.5, lineHeight: 16, color: W.muted, marginTop: 8 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
    btn: { flexGrow: 1, flexBasis: 150, minHeight: 44 },
  });
});
