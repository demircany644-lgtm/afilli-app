import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { Empty, GoldButton, ScreenHeader, webBottom } from '@/components/ui';
import { BookRow } from '@/components/BookList';
import { getBook } from '@/data/catalog';
import { useTheme } from '@/hooks/useTheme';

/** The former on-device author showcase remains available; its records are not moved or deleted. */
export default function PersonalStorefront() {
  const c = useColors();
  const t = useTheme();
  const { store, addStoreItem, removeStoreItem, ready, storageError } = useApp();
  const example = getBook('son-yaprak');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const add = () => { if (!ready || !title.trim()) return; addStoreItem(title.trim(), note.trim()); setTitle(''); setNote(''); setOpen(false); };
  return (
    <View style={{ flex: 1, backgroundColor: t.magazine.background }}>
      <ScreenHeader title="Kişisel vitrin" right={<Pressable testID="storefront-toggle-form" accessibilityLabel="Eser ekle" hitSlop={8} onPress={() => setOpen((o) => !o)} style={{ padding: 8 }}><Feather name={open ? 'x' : 'plus'} size={22} color={c.brown} /></Pressable>} />
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ padding: 18, paddingBottom: 40 + webBottom, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={[s.intro, { color: t.magazine.muted }]}>Bu cihazda daha önce oluşturduğun kişisel eser vitrini. Ürün mağazası ve sepetten ayrıdır.</Text>
        {example ? <View testID="storefront-example"><Text style={[s.title, { color: t.magazine.text, marginBottom: 10 }]}>Örnek vitrin</Text><BookRow book={example} testID="storefront-example-book" /><Text style={[s.note, { color: t.magazine.muted }]}>Bu örnek eser sana ait değildir ve satın alma işlemi içermez.</Text></View> : null}
        {storageError ? <Text accessibilityRole="alert" style={{ color: c.destructive }}>{storageError}</Text> : null}
        {open ? <View style={[s.form, { backgroundColor: t.magazine.card, borderColor: t.magazine.gold }]}>
          <TextInput testID="storefront-title" value={title} onChangeText={setTitle} placeholder="Eser adı" placeholderTextColor={t.magazine.muted} style={[s.input, { borderColor: t.magazine.border, color: t.magazine.text, backgroundColor: t.magazine.background }]} />
          <TextInput testID="storefront-note" value={note} onChangeText={setNote} placeholder="Kısa açıklama" placeholderTextColor={t.magazine.muted} multiline style={[s.input, { borderColor: t.magazine.border, color: t.magazine.text, backgroundColor: t.magazine.background, minHeight: 70 }]} />
          <GoldButton label="Vitrine ekle" icon="plus" testID="storefront-add" disabled={!ready || !title.trim()} onPress={add} />
        </View> : null}
        {store.length === 0 && !open ? <Empty icon="shopping-bag" title="Kişisel vitrinin boş" text="Daha önceki gibi eserlerini bu alanda düzenleyebilirsin.">
          <GoldButton label="Eser ekle" icon="plus" testID="storefront-open-form" onPress={() => setOpen(true)} style={{ marginTop: 8 }} />
        </Empty> : store.map((it) => (
          <View key={it.id} style={[s.item, { backgroundColor: t.magazine.card, borderColor: t.magazine.border }]}>
            <View style={[s.spine, { backgroundColor: t.magazine.gold }]} />
            <View style={{ flex: 1 }}><Text style={[s.title, { color: t.magazine.text }]}>{it.title}</Text>{!!it.note && <Text style={[s.note, { color: t.magazine.muted }]}>{it.note}</Text>}</View>
            <Pressable testID={'storefront-remove-' + it.id} disabled={!ready} accessibilityLabel="Kaldır" hitSlop={10} onPress={() => removeStoreItem(it.id)}><Feather name="trash-2" size={18} color={c.destructive} /></Pressable>
          </View>
        ))}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const s = StyleSheet.create({
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  form: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 14, padding: 14 },
  spine: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 17 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
});
