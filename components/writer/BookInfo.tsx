import React, { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { makeStyles } from '@/hooks/useTheme';
import type { WriterDocumentAgeRating, WriterDocumentCompletion } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Sheet } from '@/components/bulletins/common';
import { GENRES, LANGUAGES, TITLE_MAX, DESC_MAX } from '@/lib/writer-text';
import { useWriterPalette, writerPalette, Chip, Segmented, Label } from '@/components/writer/parts';
import type { WriterBookApi } from '@/components/writer/useWriterBook';

type Genre = (typeof GENRES)[number];

export function BookInfo({ api }: { api: WriterBookApi }) {
  const W = useWriterPalette();
  const bi = useBiStyles();
  const doc = api.rec!.doc;
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const tl = doc.title.trim().length;
  const titleErr = touched && (tl < 2 ? 'Kitap adı en az 2 karakter olmalı.' : null);
  const [genreNote, setGenreNote] = useState<string | null>(null);

  const choose = (g: Genre) => {
    if (doc.genres.includes(g)) { setGenreNote(null); setOpen(false); return; }
    if (doc.genres.length >= 3) { setGenreNote('En fazla 3 tür seçebilirsin. Önce birini kaldır.'); return; }
    setGenreNote(null);
    api.edit((d) => (d.genres.includes(g) || d.genres.length >= 3 ? d : { ...d, genres: [...d.genres, g] }));
    setOpen(false);
  };
  const remove = (g: Genre) => { setGenreNote(null); api.edit((d) => ({ ...d, genres: d.genres.filter((x) => x !== g) })); };
  const langs = LANGUAGES.includes(doc.language) ? LANGUAGES : [doc.language, ...LANGUAGES];
  const summary = [doc.language, doc.ageRating === 'all' ? 'Herkese Uygun' : '+' + doc.ageRating, doc.completion === 'completed' ? 'Tamamlandı' : 'Devam Ediyor'].join(' · ');

  return (
    <View style={bi.card}>
      <Label right={doc.title.length + ' / ' + TITLE_MAX}>Kitap Adı</Label>
      <TextInput testID="writer-title" value={doc.title} maxLength={TITLE_MAX} onBlur={() => setTouched(true)}
        onChangeText={(t) => api.edit((d) => ({ ...d, title: t }))} placeholder="Kitabının adı" placeholderTextColor={W.muted}
        accessibilityLabel="Kitap adı" style={[bi.title, !!titleErr && { borderColor: W.danger }]} />
      {titleErr ? <Text style={bi.err}>{titleErr}</Text> : null}

      <Label right={doc.genres.length + ' / 3'}>Kategori</Label>
      <Pressable testID="writer-category-open" accessibilityRole="button" accessibilityLabel="Kategori seç"
        accessibilityState={{ expanded: open }} aria-expanded={open}
        onPress={() => { Keyboard.dismiss(); tap(); setGenreNote(null); setOpen(true); }}
        style={({ pressed }) => [bi.field, { opacity: pressed ? 0.75 : 1 }]}>
        <Text style={[bi.fieldText, !doc.genres.length && { color: W.muted }]} numberOfLines={2}>
          {doc.genres.length ? doc.genres.join(', ') : 'Kategori seç'}
        </Text>
        <Feather name="chevron-down" size={18} color={W.ink} />
      </Pressable>
      {doc.genres.length ? (
        <View style={bi.wrap}>
          {doc.genres.map((g) => (
            <Pressable key={g} testID={'writer-category-remove-' + g} accessibilityRole="button" accessibilityLabel={g + ' kategorisini kaldır'}
              onPress={() => { tap(); remove(g); }} hitSlop={4} style={({ pressed }) => [bi.tag, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={bi.tagText}>{g}</Text>
              <Feather name="x" size={14} color={W.ink} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={[bi.hint, genreNote && { color: W.danger }]}>{genreNote ?? 'En az 1, en fazla 3 kategori. Kaldırmak için etiketin çarpısına dokun.'}</Text>

      <Label right={doc.description.length + ' / ' + DESC_MAX}>Açıklama / Tanıtım</Label>
      <TextInput testID="writer-description" value={doc.description} maxLength={DESC_MAX} multiline textAlignVertical="top"
        onChangeText={(t) => api.edit((d) => ({ ...d, description: t }))} placeholder="Kitabını kısaca tanıt..." placeholderTextColor={W.muted}
        accessibilityLabel="Kitap açıklaması" style={bi.desc} />

      <Pressable testID="writer-more-toggle" accessibilityRole="button" accessibilityLabel="Diğer ayarlar"
        accessibilityState={{ expanded: more }} aria-expanded={more} onPress={() => { tap(); setMore((v) => !v); }}
        style={({ pressed }) => [bi.more, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={{ flex: 1 }}>
          <Text style={bi.moreTitle}>Diğer ayarlar</Text>
          <Text style={bi.hintTight} numberOfLines={1}>{summary}</Text>
        </View>
        <Feather name={more ? 'chevron-up' : 'chevron-down'} size={18} color={W.ink} />
      </Pressable>

      {more ? <>
        <Label>Yaş / İçerik Uyarısı</Label>
        <Segmented<WriterDocumentAgeRating> testID="writer-age" value={doc.ageRating} onChange={(v) => api.edit((d) => ({ ...d, ageRating: v }))}
          options={[{ v: 'all', label: 'Herkese Uygun' }, { v: '13', label: '+13' }, { v: '18', label: '+18' }]} />
        {doc.ageRating === '18' ? <Text style={bi.hint}>Kapakta küçük bir +18 etiketi görünecek.</Text> : null}

        <Label>Dil</Label>
        <View style={bi.wrap}>{langs.map((l) => <Chip key={l} label={l} on={doc.language === l} onPress={() => api.edit((d) => ({ ...d, language: l }))} testID={'lang-' + l} />)}</View>

        <Label>Durum</Label>
        <Segmented<WriterDocumentCompletion> testID="writer-completion" value={doc.completion} onChange={(v) => api.edit((d) => ({ ...d, completion: v }))}
          options={[{ v: 'ongoing', label: 'Devam Ediyor' }, { v: 'completed', label: 'Tamamlandı' }]} />
      </> : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title={'Kategori seç (' + doc.genres.length + ' / 3)'} testID="writer-category-sheet">
        {genreNote ? <Text style={[bi.err, { marginTop: 0, marginBottom: 6 }]} accessibilityLiveRegion="polite">{genreNote}</Text> : null}
        {GENRES.map((g) => {
          const on = doc.genres.includes(g);
          return (
            <Pressable key={g} testID={'genre-' + g} accessibilityRole="checkbox" accessibilityLabel={g}
              accessibilityState={{ checked: on, selected: on }} aria-checked={on} aria-selected={on}
              onPress={() => { tap(); choose(g); }} style={({ pressed }) => [bi.opt, on && { backgroundColor: W.cream }, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[bi.optText, on && { fontFamily: F.semi }]}>{g}</Text>
              {on ? <Feather name="check" size={18} color={W.gold} /> : null}
            </Pressable>
          );
        })}
        <Pressable testID="writer-category-cancel" accessibilityRole="button" accessibilityLabel="Kapat"
          onPress={() => setOpen(false)} style={({ pressed }) => [bi.close, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={bi.moreTitle}>Kapat</Text>
        </Pressable>
      </Sheet>
    </View>
  );
}

const useBiStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 14, padding: 16, paddingTop: 2, backgroundColor: W.paper, borderRadius: 20, borderWidth: 1, borderColor: W.line },
  title: { fontFamily: F.serifBold, fontSize: 20, color: W.ink, borderBottomWidth: 1.5, borderColor: W.gold, paddingVertical: 8 },
  desc: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: W.ink, minHeight: 92, backgroundColor: W.cream, borderRadius: 12, padding: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  hint: { fontFamily: F.body, fontSize: 11.5, color: W.muted, marginTop: 6 },
  hintTight: { fontFamily: F.body, fontSize: 11.5, color: W.muted, marginTop: 2 },
  err: { fontFamily: F.med, fontSize: 12, color: W.danger, marginTop: 6 },
  field: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: W.cream, borderRadius: 12, borderWidth: 1, borderColor: W.line, paddingHorizontal: 12 },
  fieldText: { flex: 1, fontFamily: F.med, fontSize: 14, color: W.ink },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: W.gold },
  tagText: { fontFamily: F.semi, fontSize: 13, color: W.ink },
  more: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, marginTop: 16, paddingTop: 10, borderTopWidth: 1, borderColor: W.line },
  moreTitle: { fontFamily: F.semi, fontSize: 14, color: W.ink },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46, paddingHorizontal: 12, borderRadius: 10 },
  optText: { fontFamily: F.med, fontSize: 15, color: W.ink },
  close: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: W.line },
  });
});
