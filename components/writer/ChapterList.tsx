import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { makeStyles } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import type { WriterChapter } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Sheet, SheetRow, Btn } from '@/components/bulletins/common';
import { chapterStats, newChapter, CHAPTER_TITLE_MAX, MAX_CHAPTER_CHARS } from '@/lib/writer-text';
import { chapterWindow, CHAPTER_PAGE_SIZE } from '@/lib/writer-chapter-pages';
import { useWriterPalette, writerPalette, Confirm, type ToastMsg } from '@/components/writer/parts';
import type { WriterBookApi } from '@/components/writer/useWriterBook';

const ROW = 70;
type Props = { api: WriterBookApi; activeId: string; onSelect: (id: string) => void; onAdd: () => void; onPublication: (ch: WriterChapter, action: 'publishChapter' | 'draftChapter') => void; actionsLocked: string | null; toast: (m: ToastMsg) => void };

export function ChapterList({ api, activeId, onSelect, onAdd, onPublication, actionsLocked, toast }: Props) {
  const W = useWriterPalette();
  const cl = useClStyles();
  const rec = api.rec!;
  const chapters = rec.doc.chapters;
  const bookPublic = rec.publication === 'published';
  const [menu, setMenu] = useState<WriterChapter | null>(null);
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const [del, setDel] = useState<WriterChapter | null>(null);
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const [requestedPage, setPage] = useState(0);
  const activePage = Math.floor(Math.max(0, chapters.findIndex(ch => ch.id === activeId)) / CHAPTER_PAGE_SIZE);
  const window = chapterWindow(chapters.length, requestedPage);
  useEffect(() => { setPage(activePage); }, [activeId, activePage]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= chapters.length || from === to) return;
    api.edit((d) => { const list = [...d.chapters]; const [x] = list.splice(from, 1); list.splice(to, 0, x); return { ...d, chapters: list }; });
    toast({ text: 'Bölüm ' + (to + 1) + '. sıraya taşındı.', tone: 'ok', at: Date.now() });
  };
  const remove = (ch: WriterChapter) => {
    let nextId: string | null = null;
    let accepted = false;
    api.edit((d) => {
      const idx = d.chapters.findIndex(c => c.id === ch.id);
      if (idx < 0) return d;
      let list = d.chapters.filter((c) => c.id !== ch.id);
      if (!list.length) list = [newChapter(1)];
      nextId = list[Math.min(idx, list.length - 1)].id;
      accepted = true;
      return { ...d, chapters: list };
    });
    setDel(null);
    if (!accepted) {
      toast({ text: 'Bölüm silinemedi. Önce kayıt veya hesap sorununu çöz.', tone: 'warn', at: Date.now() });
      return;
    }
    if (ch.id === activeId && nextId) onSelect(nextId);
    toast({ text: 'Bölüm silindi. Kaydedene kadar bulutta duruyor.', tone: 'ok', at: Date.now() });
  };
  const target = drag ? Math.max(window.start, Math.min(window.end - 1, drag.from + Math.round(drag.dy / ROW))) : -1;
  const pager = (position: string) => window.pages > 1 ? (
    <View style={cl.pager}>
      <Btn label="Önceki" ghost disabled={window.page === 0 || !!drag} testID={'chapter-page-' + position + '-previous'}
        onPress={() => setPage(window.page - 1)} style={{ flex: 1 }} />
      <Text style={cl.pageText} accessibilityLiveRegion="polite">{window.page + 1} / {window.pages}</Text>
      <Btn label="Sonraki" ghost disabled={window.page === window.pages - 1 || !!drag} testID={'chapter-page-' + position + '-next'}
        onPress={() => setPage(window.page + 1)} style={{ flex: 1 }} />
    </View>
  ) : null;

  return (
    <View style={cl.card}>
      <View style={cl.head}>
        <Text style={cl.title} accessibilityRole="header">Bölümler <Text style={cl.count}>- {chapters.length} bölüm</Text></Text>
      </View>
      <Text style={cl.hint}>Bölümü açmak için adına dokun. Ad değiştirmek, taşımak veya silmek için yanındaki menüyü aç.</Text>
      {pager('top')}
      <View style={{ height: (window.end - window.start) * ROW }}>
        {chapters.slice(window.start, window.end).map((ch, rowIndex) => {
          const i = window.start + rowIndex;
          let shift = 0;
          if (drag && i !== drag.from) { if (drag.from < i && i <= target) shift = -ROW; if (target <= i && i < drag.from) shift = ROW; }
          return (
            <ChapterRow key={ch.id} ch={ch} index={i} rowIndex={rowIndex} active={ch.id === activeId} bookPublic={bookPublic}
              offset={drag?.from === i ? drag.dy : shift} dragging={drag?.from === i}
              onPress={() => onSelect(ch.id)} onMenu={() => setMenu(ch)}
              onDrag={(dy) => setDrag({ from: i, dy })} onDrop={(dy) => { setDrag(null); move(i, Math.max(window.start, Math.min(window.end - 1, i + Math.round(dy / ROW)))); }}
              onMove={(d) => move(i, i + d)} total={chapters.length} />
          );
        })}
      </View>
      {pager('bottom')}
      <Pressable testID="chapter-add" accessibilityRole="button" accessibilityLabel="Yeni bölüm ekle" onPress={() => { tap(); onAdd(); }}
        style={({ pressed }) => [cl.add, pressed && { opacity: 0.7 }]}>
        <Feather name="plus" size={18} color={W.ink} /><Text style={cl.addText}>Yeni Bölüm Ekle</Text>
      </Pressable>

      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.title || 'Bölüm'} testID="chapter-menu">
        {menu ? (() => {
          const i = chapters.findIndex((c) => c.id === menu.id);
          const pub = menu.status === 'published';
          return (
            <>
              <SheetRow icon="edit-3" label="Düzenle" testID="chapter-edit" onPress={() => { onSelect(menu.id); setRename({ id: menu.id, title: menu.title }); setMenu(null); }} />
              {pub ? <SheetRow icon="eye-off" label="Taslağa Al" testID="chapter-draft" disabled={!!actionsLocked} onPress={() => { onPublication(menu, 'draftChapter'); setMenu(null); }} />
                : <SheetRow icon="send" label={bookPublic ? 'Yayınla' : 'Yayınlanacak olarak seç'} testID="chapter-publish" disabled={!!actionsLocked} onPress={() => { onPublication(menu, 'publishChapter'); setMenu(null); }} />}
              {actionsLocked ? <Text style={cl.lock}>{actionsLocked}</Text> : null}
              <SheetRow icon="arrow-up" label="Yukarı taşı" testID="chapter-up" disabled={i <= 0} onPress={() => { move(i, i - 1); setMenu(null); }} />
              <SheetRow icon="arrow-down" label="Aşağı taşı" testID="chapter-down" disabled={i >= chapters.length - 1} onPress={() => { move(i, i + 1); setMenu(null); }} />
              <SheetRow icon="trash-2" label="Bölüm sil" danger testID="chapter-delete" onPress={() => { setDel(menu); setMenu(null); }} />
            </>
          );
        })() : null}
      </Sheet>
      <Sheet visible={!!rename} onClose={() => setRename(null)} title="Bölüm adı" testID="chapter-rename">
        {rename ? (
          <View style={{ gap: 10, paddingVertical: 6 }}>
            <TextInput testID="chapter-title-input" autoFocus value={rename.title} maxLength={CHAPTER_TITLE_MAX} onChangeText={(t) => setRename({ ...rename, title: t })}
              placeholder="Örn: Bölüm 1 - Giriş" placeholderTextColor={W.muted} style={cl.input} accessibilityLabel="Bölüm adı" />
            <Text style={cl.hint}>{rename.title.length} / {CHAPTER_TITLE_MAX}</Text>
            <Btn label="Kaydet" icon="check" testID="chapter-title-save" onPress={() => {
              const t = rename.title.trim() || 'Bölüm ' + (chapters.findIndex((c) => c.id === rename.id) + 1);
              api.edit((d) => ({ ...d, chapters: d.chapters.map((c) => c.id === rename.id ? { ...c, title: t } : c) }));
              setRename(null);
            }} />
          </View>
        ) : null}
      </Sheet>
      <Confirm visible={!!del} title="Emin misin?" confirm="Sil" danger onCancel={() => setDel(null)} onConfirm={() => del && remove(del)}
        text={'"' + (del?.title ?? '') + '" bölümü ve içindeki metin silinecek. Geri Al bu işlemi geri getirmez.'} />
    </View>
  );
}

function ChapterRow({ ch, index, rowIndex, active, bookPublic, offset, dragging, onPress, onMenu, onDrag, onDrop, onMove, total }: {
  ch: WriterChapter; index: number; rowIndex: number; active: boolean; bookPublic: boolean; offset: number; dragging: boolean; total: number;
  onPress: () => void; onMenu: () => void; onDrag: (dy: number) => void; onDrop: (dy: number) => void; onMove: (d: -1 | 1) => void;
}) {
  const W = useWriterPalette();
  const cl = useClStyles();
  const stats = useMemo(() => chapterStats(ch.html), [ch.html]);
  const cb = useRef({ onDrag, onDrop }); cb.current = { onDrag, onDrop };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => cb.current.onDrag(g.dy),
    onPanResponderRelease: (_, g) => cb.current.onDrop(g.dy),
    onPanResponderTerminate: (_, g) => cb.current.onDrop(g.dy),
  }), []);
  const label = ch.status === 'published' ? (bookPublic ? 'Yayınlandı' : 'Yayınlanacak') : 'Taslak';
  const over = stats.chars > MAX_CHAPTER_CHARS;
  return (
    <View style={[cl.row, { top: rowIndex * ROW, transform: [{ translateY: offset }] }, active && cl.rowOn, dragging && cl.rowDrag]}
      accessible accessibilityLabel={'Bölüm ' + (index + 1) + ', ' + ch.title + ', ' + label + ', ' + stats.chars + ' karakter'}
      accessibilityActions={[{ name: 'activate' }, { name: 'moveUp', label: 'Yukarı taşı' }, { name: 'moveDown', label: 'Aşağı taşı' }, { name: 'menu', label: 'Seçenekler' }]}
      onAccessibilityAction={(e) => { const n = e.nativeEvent.actionName; if (n === 'activate') onPress(); if (n === 'moveUp' && index > 0) onMove(-1); if (n === 'moveDown' && index < total - 1) onMove(1); if (n === 'menu') onMenu(); }}>
      <View {...pan.panHandlers} style={cl.handle} testID={'chapter-drag-' + index}><Feather name="menu" size={16} color={W.muted} /></View>
      <Pressable testID={'chapter-' + index} onPress={() => { tap(); onPress(); }} style={cl.main}>
        <View style={[cl.num, active && { backgroundColor: W.gold }]}><Text style={cl.numText}>{index + 1}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={cl.name} numberOfLines={1}>{ch.title || 'Bölüm ' + (index + 1)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[cl.pill, ch.status === 'published' && { backgroundColor: bookPublic ? W.ok : W.gold }]}><Text style={[cl.pillText, ch.status === 'published' && { color: W.paper }]}>{label}</Text></View>
            <Text style={[cl.meta, over && { color: W.danger }]}>{stats.chars.toLocaleString('tr-TR')} karakter</Text>
          </View>
        </View>
      </Pressable>
      <Pressable testID={'chapter-menu-' + index} accessibilityRole="button" accessibilityLabel={ch.title + ' seçenekleri'} hitSlop={8} onPress={() => { tap(); onMenu(); }} style={cl.dots}>
        <Feather name="more-vertical" size={19} color={W.ink} />
      </Pressable>
    </View>
  );
}

const useClStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 14, padding: 14, backgroundColor: W.paper, borderRadius: 20, borderWidth: 1, borderColor: W.line },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: F.serifBold, fontSize: 19, color: W.ink },
  count: { fontFamily: F.body, fontSize: 14, color: W.muted },
  hint: { fontFamily: F.body, fontSize: 11.5, color: W.muted, marginTop: 2, marginBottom: 8 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  pageText: { fontFamily: F.med, fontSize: 12, color: W.ink },
  row: { position: 'absolute', left: 0, right: 0, height: ROW - 6, flexDirection: 'row', alignItems: 'center', borderRadius: 14, backgroundColor: W.cream, borderWidth: 1, borderColor: 'transparent' },
  rowOn: { borderColor: W.gold, backgroundColor: W.input },
  rowDrag: { zIndex: 10, elevation: 6, shadowColor: W.deep, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, backgroundColor: W.paper },
  handle: { width: 34, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: W.input, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: F.semi, fontSize: 12, color: W.ink },
  name: { fontFamily: F.semi, fontSize: 14.5, color: W.ink, marginBottom: 3 },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: W.input },
  pillText: { fontFamily: F.semi, fontSize: 10, color: W.ink },
  meta: { fontFamily: F.body, fontSize: 11, color: W.muted },
  dots: { width: 40, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: W.gold, marginTop: 6 },
  addText: { fontFamily: F.semi, fontSize: 14, color: W.ink },
  input: { fontFamily: F.serif, fontSize: 17, color: W.ink, borderBottomWidth: 1.5, borderColor: W.gold, paddingVertical: 8 },
  lock: { fontFamily: F.body, fontSize: 12, color: W.muted, paddingHorizontal: 4, paddingVertical: 4 },
  });
});
