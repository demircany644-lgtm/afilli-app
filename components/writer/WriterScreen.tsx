import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { makeStyles } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetWriterLibraryQueryKey, getGetPublishedBooksQueryKey, getGetAuthoredBookQueryKey, getGetAuthoredBooksQueryKey, type WriterChapter } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Btn, apiError, goSignIn } from '@/components/bulletins/common';
import { KeyboardAwareScrollViewCompat, type ScrollViewHandle } from '@/components/KeyboardAwareScrollViewCompat';
import { useCommunity } from '@/context/CommunityContext';
import { useWriterBook } from '@/components/writer/useWriterBook';
import { CoverCard } from '@/components/writer/CoverCard';
import { BookInfo } from '@/components/writer/BookInfo';
import { WriterChapterFields } from '@/components/writer/WriterChapterFields';
import { ChapterList } from '@/components/writer/ChapterList';
import { EditorPanel } from '@/components/writer/EditorPanel';
import { useWriterPalette, writerPalette, Toast, Banner, Confirm, Skeleton, FadeIn, type ToastMsg } from '@/components/writer/parts';
import { newChapter, publishProblems, type Problem } from '@/lib/writer-text';
import { isDirty } from '@/lib/writer-store';

export function WriterScreen({ owner, id, offline }: { owner: string; id: string; offline: boolean }) {
  const W = useWriterPalette();
  const ws = useWsStyles();
  const api = useWriterBook(owner, id, offline);
  const qc = useQueryClient();
  const { person } = useCommunity();
  const { height } = useWindowDimensions();
  const [toastMsg, setToast] = useState<ToastMsg>(null);
  const toast = (m: ToastMsg) => setToast(m);
  const [active, setActive] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [night, setNight] = useState(false);
  const [areaH, setAreaH] = useState(0);
  const [statusH, setStatusH] = useState(0);
  const [editorChromeH, setEditorChromeH] = useState(150);
  const focusRef = useRef(focus); focusRef.current = focus;
  const scrollRef = useRef<ScrollViewHandle | null>(null);
  const receiveScroll = useCallback((handle: ScrollViewHandle | null) => { scrollRef.current = handle; }, []);
  useEffect(() => { if (focus) scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [focus]);
  // Escape / Android back leave the expanded writing view only; nothing is discarded and no navigation happens.
  useEffect(() => {
    if (!focus) return;
    const sub = Platform.OS === 'android' ? BackHandler.addEventListener('hardwareBackPress', () => { if (focusRef.current) { setFocus(false); return true; } return false; }) : null;
    let off: (() => void) | undefined;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && focusRef.current) setFocus(false); };
      document.addEventListener('keydown', k); off = () => document.removeEventListener('keydown', k);
    }
    return () => { sub?.remove(); off?.(); };
  }, [focus]);
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'unpublish' | 'delete' | 'resolve' | 'chapter'>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [confirm, setConfirm] = useState<null | 'delete' | 'unpublish'>(null);
  const [management, setManagement] = useState<'info' | 'chapters'>('info');
  const rec = api.rec;
  const chapters = rec?.doc.chapters ?? [];
  const activeIdx = Math.max(0, chapters.findIndex((c) => c.id === active));
  const chapter = chapters[activeIdx];
  const author = person?.nickname ?? (owner === 'guest' ? 'Misafir yazar' : 'Sen');
  const live = useMemo(() => rec ? problemsFor(rec.doc, !!rec.doc.cover || !!rec.coverLocal) : [], [rec]);

  const refreshServer = () => {
    void qc.invalidateQueries({ queryKey: getGetWriterLibraryQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetPublishedBooksQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAuthoredBooksQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAuthoredBookQueryKey(id) });
  };
  const fail = (e: unknown, fb: string) => toast({ text: (e as Error)?.message && !(e as { status?: number }).status ? (e as Error).message : apiError(e, fb), tone: 'err', at: Date.now() });

  if (api.loading) return <View style={{ padding: 16, gap: 12 }}><Skeleton h={180} /><Skeleton h={220} /><Skeleton h={320} /></View>;
  if (api.loadError || !rec || !chapter) {
    return (
      <View style={ws.center}>
        <Feather name="book-open" size={30} color={W.danger} />
        <Text style={ws.h}>Kitap açılamadı</Text>
        <Text style={ws.p}>{api.loadError ?? 'Bilinmeyen hata.'} Cihazındaki kayıt değiştirilmedi.</Text>
        <Btn label="Tekrar dene" icon="refresh-cw" onPress={() => void api.reload()} />
        <Btn label="Kitaplarıma dön" ghost onPress={() => router.replace({ pathname: '/write', params: { shelf: '1' } })} />
      </View>
    );
  }
  if (api.claimedAway) {
    // No link to the claiming account's copy and no guest text shown.
    return (
      <View style={ws.center} testID="writer-claimed-away">
        <Feather name="lock" size={30} color={W.ink} />
        <Text style={ws.h}>Bu taslak bir hesaba aktarıldı</Text>
        <Text style={ws.p}>Bu cihazdaki misafir kopyası artık kapalı. Taslağı aktaran hesapla giriş yaparak devam edebilirsin.</Text>
        <Btn label="Kitaplarıma dön" ghost onPress={() => router.replace({ pathname: '/write', params: { shelf: '1' } })} />
      </View>
    );
  }
  const published = rec.publication === 'published';
  const addChapter = (showList = true) => {
    const ch = newChapter(chapters.length + 1);
    let accepted = false;
    api.edit(d => { accepted = true; return { ...d, chapters: [...d.chapters, ch] }; });
    if (!accepted) {
      toast({ text: 'Yeni bölüm eklemeden önce kayıt veya hesap sorununu çöz.', tone: 'warn', at: Date.now() });
      return;
    }
    setActive(ch.id);
    setManagement(showList ? 'chapters' : 'info');
    toast({ text: ch.title + ' eklendi.', tone: 'ok', at: Date.now() });
  };
  const locked = !api.signed ? 'Yayın işlemleri için giriş yapmalısın.' : offline ? 'Bağlantı yok. Yayın işlemleri internet gerektirir.'
    : api.localConflict ? 'Önce yerel çakışmayı çöz.' : rec.conflict ? 'Önce sürüm çakışmasını çöz.' : api.coverBusy ? 'Kapak yüklenirken bekle.' : busy ? 'Bir işlem sürüyor.' : null;

  const saveDraft = async () => {
    setBusy('save');
    try {
      // Receive the editor's latest text before reporting a manual save.
      await api.flushRef.current?.();
      if (!(await api.persistNow())) { toast({ text: 'Bu kitap başka bir sekmede değişti. Metnin ayrı bir kopya olarak kaydedildi.', tone: 'err', at: Date.now() }); return; }
      if (!api.signed) { toast({ text: 'Taslak kaydedildi (yalnızca bu cihazda).', tone: 'ok', at: Date.now() }); return; }
      if (offline) { toast({ text: 'Taslak cihaza kaydedildi. Bağlantı gelince buluta gönderilecek.', tone: 'warn', at: Date.now() }); return; }
      const r = await api.sync();
      const l = api.liveRef.current;
      if (r === 'conflict') toast({ text: 'Bu kitap başka bir cihazda değişti. Aşağıdan çöz.', tone: 'err', at: Date.now() });
      else if (r === 'offline') toast({ text: 'Bağlantı kurulamadı. Taslak cihazda saklı.', tone: 'warn', at: Date.now() });
      else if (r === 'error') toast({ text: l?.lastError ?? 'Buluta kaydedilemedi. Taslak cihazda saklı.', tone: 'err', at: Date.now() });
      else if (l && (isDirty(l) || l.pending)) toast({ text: 'Taslak cihaza kaydedildi; son değişiklikler birazdan gönderilecek.', tone: 'ok', at: Date.now() });
      else { toast({ text: 'Taslak kaydedildi', tone: 'ok', at: Date.now() }); refreshServer(); }
    } catch (e) { fail(e, 'Taslak kaydedilemedi.'); } finally { setBusy(null); }
  };
  const publish = async () => {
    const p = live;
    setProblems(p);
    if (p.length) { toast({ text: p[0].text, tone: 'err', at: Date.now() }); return; }
    if (!api.signed) { toast({ text: 'Yayınlamak için giriş yap. Taslağın bu cihazda kalır.', tone: 'warn', at: Date.now() }); return; }
    if (locked) { toast({ text: locked, tone: 'warn', at: Date.now() }); return; }
    setBusy('publish');
    try { await api.act('publish'); refreshServer(); toast({ text: published ? 'Güncellendi' : 'Kitabın yayınlandı!', tone: 'ok', at: Date.now() }); }
    catch (e) { fail(e, 'Yayınlanamadı.'); } finally { setBusy(null); }
  };
  const chapterAction = async (ch: WriterChapter, action: 'publishChapter' | 'draftChapter') => {
    if (locked) { toast({ text: locked, tone: 'warn', at: Date.now() }); return; }
    setBusy('chapter');
    try {
      await api.act(action, ch.id);
      refreshServer();
      const after = api.liveRef.current;
      toast({ text: action === 'publishChapter' ? (published ? '"' + ch.title + '" yayınlandı.' : '"' + ch.title + '" yayınlanacak olarak seçildi.')
        : published && after?.publication === 'draft' ? 'Son yayındaki bölüm gizlendi; kitap taslağa döndü.' : '"' + ch.title + '" taslağa alındı.', tone: 'ok', at: Date.now() });
    } catch (e) { fail(e, 'Bölüm durumu değiştirilemedi.'); } finally { setBusy(null); }
  };
  const doConfirm = async () => {
    const what = confirm;
    if (!what) return;
    setBusy(what);
    try {
      if (what === 'unpublish') { await api.act('unpublish'); refreshServer(); toast({ text: 'Kitap yayından kaldırıldı. Metin, beğeni ve yorumlar duruyor.', tone: 'ok', at: Date.now() }); }
      else { await api.remove(); refreshServer(); router.replace({ pathname: '/write', params: { shelf: '1' } }); return; }
      setConfirm(null);
    } catch (e) { setConfirm(null); fail(e, what === 'delete' ? 'Kitap silinemedi.' : 'Yayından kaldırılamadı.'); } finally { setBusy(null); }
  };

  const v = api.view;
  const vIcon = v.kind === 'saved' ? 'check' : v.kind === 'saving' ? 'loader' : v.kind === 'offline' ? 'cloud-off' : v.kind === 'local' ? 'smartphone' : v.kind === 'dirty' ? 'clock' : 'alert-triangle';
  // Focus: body takes the measured area above the bottom nav (shrinks with keyboard), minus status bar and toolbar/counter chrome.
  const measured = areaH > 0 ? areaH - statusH - editorChromeH - 18 : height - 300;
  const editorH = focus ? Math.max(120, Math.floor(measured)) : Math.max(380, Math.round(height * 0.6));

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
      <View style={ws.status} testID="writer-status" onLayout={(e) => setStatusH(e.nativeEvent.layout.height)}>
        <Feather name={vIcon} size={14} color={v.kind === 'saved' ? W.ok : ['error', 'conflict', 'storage'].includes(v.kind) ? W.danger : W.muted} />
        <Text style={ws.statusText} numberOfLines={1}>{v.text}</Text>
        <View style={{ flex: 1 }} />
        <View style={[ws.pubPill, published && { backgroundColor: W.ok }]}><Text style={[ws.pubText, published && { color: W.paper }]}>{published ? 'Yayında' : 'Taslak'}</Text></View>
        {!focus ? <Pressable testID="writer-open-shelf" accessibilityRole="button" accessibilityLabel="Tüm kitaplarım ve taslaklarım" hitSlop={8} onPress={() => { tap(); router.push({ pathname: '/write', params: { shelf: '1' } }); }} style={ws.shelfBtn}>
          <Feather name="layers" size={14} color={W.ink} /><Text style={ws.pubText}>Kitaplarım</Text>
        </Pressable> : null}
        {focus ? <Pressable testID="writer-focus-save" onPress={() => { tap(); if (!busy && !api.frozen) void saveDraft(); }} disabled={!!busy || api.frozen || !!api.localConflict}
          accessibilityRole="button" accessibilityLabel="Taslağı kaydet" accessibilityState={{ busy: busy === 'save', disabled: !!busy || api.frozen || !!api.localConflict }}
          style={({ pressed }) => [ws.focusBtn, ws.focusSave, { opacity: (busy && busy !== 'save') || api.frozen || api.localConflict ? 0.45 : pressed ? 0.7 : 1 }]}>
          {busy === 'save' ? <ActivityIndicator size="small" color={W.ink} /> : <Feather name="save" size={16} color={W.ink} />}<Text style={ws.focusText}>Kaydet</Text>
        </Pressable> : null}
        {focus ? <Pressable testID="writer-focus-exit" onPress={() => { tap(); setFocus(false); }} accessibilityRole="button" accessibilityLabel="Tam ekrandan çık" hitSlop={4} style={ws.focusBtn}><Feather name="minimize-2" size={18} color={W.ink} /></Pressable> : null}
      </View>
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: focus ? 12 : 60 }} bottomOffset={20} keyboardShouldPersistTaps="handled"
        onScrollReady={receiveScroll} onContentSizeChange={() => { if (focus) scrollRef.current?.scrollTo({ y: 0, animated: false }); }}>
        {api.storageError ? <Banner icon="hard-drive" tone="err" title="Cihaza kaydedilemedi" text={api.storageError}><Btn label="Yeniden dene" ghost onPress={() => void api.persistNow().catch(() => undefined)} /></Banner> : null}
        {api.localConflict ? (
          <Banner icon="copy" tone="err" title="Başka bir sekmede değişti" testID="writer-local-conflict"
            text="Bu kitap bu cihazda başka bir sekmede/pencerede değiştirildi. Hiçbir şey silinmedi: senin son metnin ayrı bir yerel kopya olarak kaydedildi. Düzenleme, seçim yapana kadar durduruldu.">
            <Btn label="Kopyamı aç" icon="file-text" testID="writer-open-copy" onPress={() => router.replace({ pathname: '/write', params: { book: api.localConflict! } })} />
            <Btn label="Güncel sürümü burada aç" icon="refresh-cw" ghost testID="writer-reload-current" onPress={() => void api.reloadAfterLocalConflict()} />
          </Banner>
        ) : null}
        {rec.conflict ? (
          <Banner icon="git-branch" tone="err" title="Sürüm çakışması" testID="writer-conflict"
            text="Bu kitap başka bir cihazda değiştirildi. Hiçbir şey üzerine yazılmadı. Buluttaki sürümü açabilirsin; buradaki metin ayrı bir yerel kitap olarak saklanır.">
            <Btn label="Bulut sürümünü aç, yerelimi sakla" icon="download-cloud" busy={busy === 'resolve'} disabled={offline || !!busy || !!api.localConflict} onPress={async () => {
              setBusy('resolve');
              try { await api.resolve(); toast({ text: 'Bulut sürümü açıldı. Yerel metnin "yerel kopya" olarak Kitaplarım\'da.', tone: 'ok', at: Date.now() }); }
              catch (e) { fail(e, 'Bulut sürümü alınamadı.'); } finally { setBusy(null); }
            }} />
          </Banner>
        ) : null}
        {!focus && !api.signed ? <Banner icon="smartphone" tone="info" title="Misafir taslağı" text="Bu kitap yalnızca bu cihazda saklanıyor. Buluta kaydetmek ve yayınlamak için giriş yap; giriş yapınca bu taslağı Kitap Yaz sayfasından hesabına açıkça aktarabilirsin."><Btn label="Giriş yap" ghost onPress={goSignIn} /></Banner> : null}
        {!focus && offline && api.signed ? <Banner icon="cloud-off" tone="warn" title="Çevrimdışısın" text="Yazmaya devam et; her şey bu cihaza kaydediliyor. Bağlantı gelince aynı kayıt buluta gönderilir." /> : null}

        {!focus ? (
          <FadeIn>
            <View style={ws.management} testID="writer-management">
              <Text style={ws.h} accessibilityRole="header">Kitap yönetimi</Text>
              <Text style={ws.bookName}>{rec.doc.title || 'Adsız kitap'} · {chapters.length} bölüm</Text>
              <Btn label="Kitabı düzenle" icon="edit-3" ghost={management !== 'info'} testID="writer-manage-edit"
                onPress={() => setManagement('info')} />
              <Btn label="Mevcut bölümleri görüntüle" icon="list" ghost={management !== 'chapters'} testID="writer-manage-chapters"
                onPress={() => setManagement('chapters')} />
              <Btn label="Yeni bölüm ekle" icon="plus" ghost testID="writer-manage-add"
                disabled={!!busy || !!api.localConflict} onPress={addChapter} />
              <Btn label="Kitabı sil" icon="trash-2" ghost testID="writer-delete"
                disabled={!!busy || (api.signed && offline)} onPress={() => setConfirm('delete')} />
            </View>
            {management === 'info' ? <>
              <CoverCard api={api} author={author} offline={offline} toast={toast} />
              <BookInfo api={api} />
            </> : <ChapterList api={api} activeId={chapter.id} onSelect={setActive} onAdd={addChapter}
              onPublication={(ch, a) => void chapterAction(ch, a)} actionsLocked={locked} toast={toast} />}
          </FadeIn>
        ) : null}

        {!focus ? <WriterChapterFields key={chapter.id} chapter={chapter} count={chapters.length}
          onTitleChange={title => api.edit(doc => ({ ...doc, chapters: doc.chapters.map(ch => ch.id === chapter.id ? { ...ch, title } : ch) }))}
          onAdd={() => addChapter(false)} onSave={() => void saveDraft()} busy={busy === 'save'}
          disabled={!!busy || api.frozen || !!api.localConflict} /> : null}

        <EditorPanel api={api} chapter={chapter} index={activeIdx} owner={owner} offline={offline} height={editorH}
          night={night} setNight={setNight} focus={focus} setFocus={setFocus} toast={toast} onChromeHeight={setEditorChromeH} />

        {!focus ? (
          <View style={ws.actions}>
            {problems.length ? (
              <View style={ws.problems} accessibilityRole="alert">
                {problems.map((p) => <View key={p.key} style={ws.prob}><Feather name="alert-circle" size={14} color={W.danger} /><Text style={ws.probText}>{p.text}</Text></View>)}
              </View>
            ) : null}
            <Btn label="Taslak Kaydet" icon="save" ghost testID="writer-save" busy={busy === 'save'} disabled={!!busy && busy !== 'save'} onPress={() => void saveDraft()} />
            <Pressable testID="writer-publish" accessibilityRole="button" accessibilityLabel={published ? 'Güncellemeyi yayınla' : 'Yayınla'} disabled={!!busy}
              onPress={() => { tap(); void publish(); }} style={({ pressed }) => [ws.publish, { opacity: busy && busy !== 'publish' ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
              {busy === 'publish' ? <ActivityIndicator color={W.ink} /> : <Feather name="send" size={19} color={W.ink} />}
              <Text style={ws.publishText}>{published ? 'Güncellemeyi Yayınla' : 'Yayınla'}</Text>
            </Pressable>
            <Text style={ws.hint}>{published ? 'Kaydettiğin değişiklikler yalnızca sende görünür; okurlar "Güncellemeyi Yayınla" deyince yeni hâli görür. Beğeni ve yorumlar silinmez.'
              : 'Taslaklar yalnızca sende, Kitaplarım > Taslaklar bölümünde görünür.'}</Text>
            <View style={ws.row}>
              {published ? <Btn label="Oku" icon="book-open" ghost onPress={() => router.push({ pathname: '/authored-book/[id]', params: { id } })} style={{ flex: 1 }} /> : null}
              {published ? <Btn label="Yayından Kaldır" icon="eye-off" ghost testID="writer-unpublish" disabled={!!locked} onPress={() => setConfirm('unpublish')} style={{ flex: 1 }} /> : null}
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>
      <Toast msg={toastMsg} />
      <Confirm visible={confirm === 'unpublish'} title="Yayından kaldırılsın mı?" confirm="Kaldır" busy={busy === 'unpublish'} onCancel={() => setConfirm(null)} onConfirm={() => void doConfirm()}
        text="Kitap okurlardan gizlenir. Metnin, beğeniler ve yorumlar silinmez; istediğinde yeniden yayınlayabilirsin." />
      <Confirm visible={confirm === 'delete'} title="Emin misin?" confirm="Sil" danger busy={busy === 'delete'} onCancel={() => setConfirm(null)} onConfirm={() => void doConfirm()}
        text={api.signed ? 'Kitap bu cihazdan ve (gönderildiyse) buluttan kalıcı olarak silinecek. Silme sunucuda doğrulanmazsa kitap cihazında kalır.' : 'Bu cihazdaki kitap kalıcı olarak silinecek.'} />
    </View>
  );
}
function problemsFor(doc: Parameters<typeof publishProblems>[0], cover: boolean) { return publishProblems(doc, cover); }

const useWsStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
  center: { alignItems: 'center', gap: 12, padding: 28, margin: 16, backgroundColor: W.paper, borderRadius: 20 },
  h: { fontFamily: F.serifBold, fontSize: 20, color: W.ink },
  p: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: W.ink, textAlign: 'center' },
  management: { marginHorizontal: 16, marginTop: 14, padding: 14, gap: 10, backgroundColor: W.paper, borderRadius: 20, borderWidth: 1, borderColor: W.line },
  bookName: { fontFamily: F.body, fontSize: 13, color: W.muted },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: W.cream, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: W.border },
  statusText: { fontFamily: F.med, fontSize: 12.5, color: W.ink, flexShrink: 1 },
  shelfBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 26, borderRadius: 8, borderWidth: 1, borderColor: W.line, backgroundColor: W.paper },
  pubPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: W.input },
  pubText: { fontFamily: F.semi, fontSize: 10.5, color: W.ink },
  actions: { marginHorizontal: 16, marginTop: 20, gap: 10 },
  problems: { gap: 6, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: W.danger, backgroundColor: W.paper },
  prob: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  probText: { fontFamily: F.med, fontSize: 13, color: W.danger },
  publish: { height: 58, borderRadius: 16, backgroundColor: W.gold, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, shadowColor: W.deep, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  publishText: { fontFamily: F.serifBold, fontSize: 19, color: W.ink },
  hint: { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: W.muted, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8 },
  focusBtn: { minWidth: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  focusSave: { paddingHorizontal: 12, backgroundColor: W.gold },
  focusText: { fontFamily: F.semi, fontSize: 13, color: W.ink },
  });
});
