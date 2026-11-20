import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { makeStyles } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAuthoredBook, getGetAuthoredBookQueryKey, useGetWriterBook, getGetWriterBookQueryKey, setAuthoredBookLike,
  useGetReadingPosition, getGetReadingPositionQueryKey,
  type AuthoredBook, type WriterChapter,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { MagazineScrollView, type MagazineScrollHandle } from '@/components/MagazineUI';
import { TopBar } from '@/components/bulletins/TopBar';
import { Avatar, Btn, apiError, goSignIn, OFFLINE } from '@/components/bulletins/common';
import { scoped, actorRequest, useOwnerGuard, compactCount } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { useApp } from '@/context/AppContext';
import { useWriterPalette, writerPalette, WriterCover, useCoverUri, Banner, Skeleton, FadeIn } from '@/components/writer/parts';
import { HtmlView } from '@/components/writer/HtmlView';
import { BookComments } from '@/components/writer/BookComments';
import { CopyGuard, CopyProtectionHint } from '@/components/writer/CopyGuard';
import { chapterStats, escapeHtml, AGE_LABEL } from '@/lib/writer-text';
import { progressStore, useProgress } from '@/lib/reading-progress';
import { useSavedBookSetter } from '@/lib/book-subscriptions';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Reader instance is keyed by book + live owner: an account switch remounts it with no carried-over progress. */
export default function AuthoredBookScreen() {
  const { id, preview, focusComment, chapter } = useLocalSearchParams<{ id: string; preview?: string; focusComment?: string; chapter?: string }>();
  const bookId = String(id ?? '');
  const { ready, userId } = useCommunity();
  const owner = ready ? userId ?? 'guest' : 'pending';
  return <Reader key={bookId + ':' + owner} bookId={bookId} preview={preview === '1'} focusComment={focusComment ? String(focusComment) : null} notifChapter={chapter ? String(chapter) : null} />;
}

function Reader({ bookId, preview, focusComment, notifChapter }: { bookId: string; preview: boolean; focusComment: string | null; notifChapter: string | null }) {
  const W = useWriterPalette();
  const st = useStStyles();
  const { userId, ready } = useCommunity();
  const app = useApp();
  const guard = useOwnerGuard(userId);
  const qc = useQueryClient();
  const scrollRef = useRef<MagazineScrollHandle>(null);
  const pageY = useRef(0);
  const key = scoped(getGetAuthoredBookQueryKey(bookId), userId);
  const q = useGetAuthoredBook(bookId, { query: { enabled: ready && !!bookId, queryKey: key, retry: 1 }, request: actorRequest(userId) });
  const notFound = (q.error as { status?: number } | null)?.status === 404;
  const wantPreview = !!userId && (preview || notFound);
  const w = useGetWriterBook(bookId, { query: { enabled: ready && wantPreview, queryKey: scoped(getGetWriterBookQueryKey(bookId), userId), retry: false }, request: actorRequest(userId) });
  const draft = wantPreview && w.data ? w.data : null;
  const book = q.data;
  const [night, setNight] = useState(false);
  const [fontSize, setFontSize] = useState(17);
  const likeLock = useRef(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeErr, setLikeErr] = useState<string | null>(null);

  const chapters: WriterChapter[] = useMemo(() => {
    if (draft) return draft.document.chapters;
    if (!book) return [];
    const pub = (book.chapters ?? []).filter((c) => c.status === 'published');
    if (pub.length) return pub;
    if (book.body?.trim()) return [{ id: 'legacy', title: book.title, status: 'published', html: book.body.split(/\n{2,}/).map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('') }];
    return [];
  }, [draft, book]);
  const realChapters = chapters.length > 0 && chapters[0].id !== 'legacy';

  // Durable progress: only published reader truth, only for a signed-in owner, never for draft preview.
  const progressOn = ready && !!userId && !!book && !draft && !wantPreview && realChapters;
  const progress = useProgress(userId, bookId);
  const [queueReady, setQueueReady] = useState(false);
  useEffect(() => {
    if (!progressOn || !userId) return;
    let alive = true;
    void progressStore.settled(userId, bookId).then(() => { if (alive) setQueueReady(true); });
    return () => { alive = false; };
  }, [progressOn, userId, bookId]);
  const posKey = scoped(getGetReadingPositionQueryKey(bookId), userId);
  const pos = useGetReadingPosition(bookId, { query: { enabled: progressOn && queueReady, queryKey: posKey, retry: 1, staleTime: 0, refetchOnMount: 'always' }, request: actorRequest(userId) });

  const [chId, setChId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [missing, setMissing] = useState(false);
  const lastSaved = useRef<string | null>(null);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [hydrateAttempt, setHydrateAttempt] = useState(0);
  useEffect(() => {
    if (hydrated || chapters.length === 0) return;
    if (!progressOn) {
      // Guests, drafts and legacy single-body books read locally without server progress.
      if (!q.isLoading && (!wantPreview || !w.isLoading)) setChId((c) => c ?? chapters[0].id);
      return;
    }
    if (pos.isError) { setChId(c => c ?? chapters[0].id); return; }
    if (!pos.data || !pos.isFetchedAfterMount || pos.isFetching || !queueReady || !userId) return;
    const position = pos.data;
    let alive = true;
    void (async () => {
      const pending = await progressStore.pending(userId, bookId);
      if (!alive || !guard()) return;
      const validPending = pending && chapters.some(c => c.id === pending.chapterId);
      const saved = position.chapterId && chapters.some(c => c.id === position.chapterId) ? position.chapterId : null;
      if (pending && !validPending) await progressStore.discard(userId, bookId, pending);
      if (!alive || !guard()) return;
      progressStore.seed(userId, bookId, position.resumed ? saved : null);
      lastSaved.current = validPending ? pending.chapterId : position.resumed ? saved : null;
      setMissing(position.chapterMissing || !!pending && !validPending);
      setChId(validPending ? pending.chapterId : saved ?? chapters[0].id);
      setHydrateError(null); setHydrated(true);
      if (validPending) void progressStore.request(userId, bookId, pending.chapterId);
    })().catch(e => {
      if (alive && guard()) { setHydrateError(apiError(e, 'Cihazdaki okuma konumu alınamadı.')); setChId(c => c ?? chapters[0].id); }
    });
    return () => { alive = false; };
  }, [hydrated, chapters, progressOn, pos.data, pos.isError, pos.isFetching, pos.isFetchedAfterMount, queueReady, userId, bookId, guard, hydrateAttempt, q.isLoading, wantPreview, w.isLoading]);
  const saveState: SaveState = progress.status === 'paused' ? 'error' : progress.status;
  const saveErr = progress.error ?? progress.storageError ?? (progress.status === 'paused' ? 'Konum hesabın yeniden açıldığında gönderilecek.' : null);
  const lastKnownChapter = progress.desired ?? lastSaved.current;
  const persist = (cid: string) => {
    if (hydrated && progressOn && userId && cid !== 'legacy' && guard()) void progressStore.request(userId, bookId, cid);
  };

  const cur = chapters.find((c) => c.id === chId) ?? null;
  const curIdx = cur ? chapters.indexOf(cur) : -1;
  const select = (id: string, scroll = true) => {
    if (progressOn && !hydrated && !pos.isError && !hydrateError) return;
    setChId(id); setMissing(false);
    persist(id);
    if (scroll) requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, pageY.current - 12), animated: true }));
  };
  const startReading = () => { tap(); if (cur) select(cur.id); };

  const meta = draft ? { title: draft.document.title, description: draft.document.description, genres: draft.document.genres as string[], age: draft.document.ageRating, completion: draft.document.completion, lang: draft.document.language }
    : book ? { title: book.title, description: book.description ?? '', genres: book.genres ?? [], age: book.ageRating ?? 'all', completion: book.completion ?? 'ongoing', lang: book.language ?? 'Türkçe' } : null;
  const cover = useCoverUri(draft ? draft.document.cover : book?.coverUrl ?? null, null, draft ? 'private' : 'published');
  const perChapter = useMemo(() => chapters.map((c) => chapterStats(c.html)), [chapters]);
  const stats = perChapter.reduce((a, s) => ({ words: a.words + s.words, minutes: a.minutes + s.minutes }), { words: 0, minutes: 0 });
  const [listOpen, setListOpen] = useState(false);
  const showList = listOpen || chapters.length <= 8;

  const like = async () => {
    if (!book || !userId) { goSignIn(); return; }
    if (likeLock.current) return;
    likeLock.current = true;
    setLikeBusy(true); setLikeErr(null);
    try {
      const next = await setAuthoredBookLike(bookId, { liked: !book.liked }, actorRequest(userId));
      if (guard()) qc.setQueryData<AuthoredBook>(key, next);
    } catch (e) { if (guard()) setLikeErr(apiError(e, 'Beğeni kaydedilemedi.')); } finally { likeLock.current = false; if (guard()) setLikeBusy(false); }
  };
  const saved = app.isSaved(bookId);
  const saver = useSavedBookSetter();
  const bookmarkBusy = saver.busyId === bookId;
  const bookmarkErr = saver.error?.id === bookId ? saver.error.message : null;
  // Server subscription first; the local bookmark flips only after success.
  const bookmark = () => { tap(); void saver.set(bookId, !saved); };
  // Notification deep link: offered only after reading position settles, never auto-switched.
  const [chapterDismissed, setChapterDismissed] = useState(false);
  const positionSettled = !progressOn || hydrated || pos.isError || !!hydrateError;
  const notifTarget = notifChapter && !chapterDismissed && positionSettled && chId ? chapters.find((c) => c.id === notifChapter) ?? null : null;
  const bg = night ? W.night : W.cream;
  const loading = !ready || q.isLoading || (wantPreview && w.isLoading);
  const positionFailed = progressOn && !hydrated && (pos.isError || !!hydrateError);
  const positionPending = progressOn && !hydrated && !positionFailed;
  const resumeLabel = progressOn && hydrated && lastKnownChapter && curIdx > 0 ? 'Okumaya devam et' : 'Oku';
  const nightInk = night ? { color: '#EADBC4' } : null;

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <TopBar title={draft ? 'Taslak önizleme' : 'Kitap'} backTo="/library" icons={false} />
      <MagazineScrollView ref={scrollRef} contentContainerStyle={st.wrap}>
        {loading ? <View style={{ gap: 12 }}><Skeleton h={260} /><Skeleton h={400} /></View>
          : !meta ? (
            <View style={st.empty}>
              <Feather name="book" size={28} color={W.danger} />
              <Text style={st.title}>{notFound ? 'Bu kitap bulunamadı ya da yayında değil.' : apiError(q.error, OFFLINE)}</Text>
              <Btn label="Tekrar dene" icon="refresh-cw" onPress={() => { void q.refetch(); if (wantPreview) void w.refetch(); }} />
            </View>
          ) : (
            <FadeIn>
              {draft ? <Banner icon="eye-off" tone="info" title="Taslak önizleme" text="Bunu yalnızca sen görüyorsun. Okuma konumu kaydedilmez. Okurlar yalnızca yayımladığın bölümleri görür.">
                <Btn label="Düzenle" icon="edit-3" ghost onPress={() => router.push({ pathname: '/write', params: { book: bookId } })} /></Banner> : null}
              <View style={st.hero}>
                <WriterCover uri={cover} title={meta.title} author={draft ? undefined : book?.author.nickname} w={150} adult={meta.age === '18'} completed={meta.completion === 'completed'} />
                <Text style={[st.title, nightInk]} accessibilityRole="header">{meta.title || 'Adsız kitap'}</Text>
                {book && !draft ? <Pressable accessibilityRole="link" accessibilityLabel={book.author.nickname + ' profilini aç'} onPress={() => router.push(('/people/' + book.author.id) as never)} style={st.byline}><Avatar person={book.author} size={26} /><Text style={[st.author, nightInk]}>{book.author.nickname}</Text></Pressable> : null}
                <Text style={st.meta}>{[...meta.genres, AGE_LABEL[meta.age] ?? meta.age, meta.lang, meta.completion === 'completed' ? 'Tamamlandı' : 'Devam ediyor'].join(' · ')}</Text>
                <Text style={st.meta}>{chapters.length} bölüm · {stats.words.toLocaleString('tr-TR')} kelime · {stats.minutes} dk</Text>
                {meta.description ? <Text style={[st.desc, nightInk]}>{meta.description}</Text> : null}

                {chapters.length > 0 ? (
                  <View style={st.cta}>
                    <Pressable testID="book-read" accessibilityRole="button" accessibilityLabel={resumeLabel + (cur ? ', ' + cur.title : '')} disabled={!cur}
                      onPress={startReading} style={({ pressed }) => [st.readBtn, { opacity: !cur ? 0.5 : pressed ? 0.85 : 1 }]}>
                      <Feather name="book-open" size={18} color={W.paper} />
                      <Text style={st.readText}>{resumeLabel}</Text>
                    </Pressable>
                    {book && !draft ? (
                      <Pressable testID="book-save" accessibilityRole="button" accessibilityState={{ selected: saved, disabled: !app.ready, busy: bookmarkBusy }} accessibilityLabel={saved ? 'Kaydı kaldır' : 'Kaydet'}
                        disabled={!app.ready || bookmarkBusy} onPress={bookmark} style={({ pressed }) => [st.saveBtn, saved && st.saveOn, { opacity: !app.ready || bookmarkBusy ? 0.5 : pressed ? 0.7 : 1 }]}>
                        <Feather name="bookmark" size={17} color={saved ? W.paper : W.ink} />
                        <Text style={[st.saveText, saved && { color: W.paper }]}>{bookmarkBusy ? (saved ? 'Kaldırılıyor' : 'Kaydediliyor') : saved ? 'Kaydedildi' : 'Kaydet'}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {cur && progressOn && hydrated && lastKnownChapter ? <Text style={st.meta}>Kaldığın yer: {curIdx + 1}. {cur.title}</Text> : null}
                {bookmarkErr || app.storageError ? <Text style={st.err} accessibilityLiveRegion="polite">{bookmarkErr ?? app.storageError}</Text> : null}

                {book && !draft ? (
                  <View style={st.actions}>
                    <Pressable testID="book-like" accessibilityRole="button" accessibilityState={{ selected: !!book.liked, busy: likeBusy }} accessibilityLabel={book.liked ? 'Beğeniyi geri al' : 'Beğen'}
                      disabled={likeBusy} onPress={() => { tap(); void like(); }} style={({ pressed }) => [st.likeBtn, book.liked && st.likeOn, pressed && { opacity: 0.7 }]}>
                      <Feather name="heart" size={16} color={book.liked ? W.paper : W.ink} />
                      <Text style={[st.likeText, book.liked && { color: W.paper }]}>{book.liked ? 'Beğendin' : 'Beğen'} · {compactCount(book.likeCount ?? 0)}</Text>
                    </Pressable>
                    <View style={st.stat} accessible accessibilityLabel={(book.readCount ?? 0) + ' okuma'}><Feather name="eye" size={15} color={W.muted} /><Text style={st.meta}>{compactCount(book.readCount ?? 0)}</Text></View>
                    <View style={st.stat} accessible accessibilityLabel={(book.commentCount ?? 0) + ' yorum'}><Feather name="message-circle" size={15} color={W.muted} /><Text style={st.meta}>{compactCount(book.commentCount ?? 0)}</Text></View>
                    {book.canEdit ? <Btn label="Düzenle" icon="edit-3" ghost onPress={() => router.push({ pathname: '/write', params: { book: bookId } })} /> : null}
                  </View>
                ) : null}
                {likeErr ? <Text style={st.err}>{likeErr}</Text> : null}
              </View>

              {missing ? <Banner testID="resume-missing" icon="info" tone="warn" title="Kaldığın bölüm artık yayında değil" text="Yazar o bölümü kaldırmış ya da taslağa almış. Okunabilir bir bölümden devam ediyorsun." /> : null}
              {positionFailed ? (
                <Banner testID="resume-error" icon="cloud-off" tone="warn" title="Kaldığın yer alınamadı" text={hydrateError ?? 'Okuyabilirsin, ancak konum alınana kadar ilerlemen kaydedilmez; böylece önceki konumun silinmez.'}>
                  <Btn label="Tekrar dene" ghost testID="resume-retry" onPress={() => { setHydrateError(null); setHydrateAttempt(n => n + 1); void pos.refetch(); }} />
                </Banner>
              ) : null}

              {notifTarget && notifTarget.id !== chId ? (
                <Banner testID="notification-chapter" icon="bell" tone="info" title="Bildirimdeki bölüm" text={(chapters.indexOf(notifTarget) + 1) + '. ' + (notifTarget.title || 'Adsız bölüm')}>
                  <Btn label="Bildirimin bölümüne git" testID="notification-chapter-go" icon="book-open" onPress={() => { tap(); setChapterDismissed(true); select(notifTarget.id); }} />
                  <Btn label="Burada kal" ghost onPress={() => setChapterDismissed(true)} />
                </Banner>
              ) : null}
              {chapters.length > 1 ? (
                <View style={[st.toc, night && st.nightCard]} testID="chapter-list">
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: showList }} disabled={chapters.length <= 8} onPress={() => { tap(); setListOpen(!listOpen); }} style={st.tocHead}>
                    <Text style={[st.tocTitle, nightInk]} accessibilityRole="header">Bölümler</Text>
                    <Text style={st.meta}>{chapters.length} bölüm</Text>
                    {chapters.length > 8 ? <Feather name={showList ? 'chevron-up' : 'chevron-down'} size={18} color={W.muted} /> : null}
                  </Pressable>
                  {(showList ? chapters : cur ? [cur] : []).map((c) => {
                    const i = chapters.indexOf(c);
                    const on = c.id === chId;
                    const here = progressOn && c.id === lastKnownChapter;
                    return (
                      <Pressable key={c.id} testID={'read-chapter-' + i} accessibilityRole="button" accessibilityState={{ selected: on }}
                        accessibilityLabel={`${i + 1}. bölüm, ${c.title}${on ? ', açık' : ''}${here ? ', kaldığın yer' : ''}`}
                        onPress={() => { tap(); select(c.id); }} style={({ pressed }) => [st.tocRow, on && st.tocOn, pressed && { opacity: 0.7 }]}>
                        <Text style={[st.tocNum, on && { color: W.paper }]}>{String(i + 1).padStart(2, '0')}</Text>
                        <Text style={[st.tocName, nightInk, on && { color: W.paper }]} numberOfLines={2}>{c.title || 'Adsız bölüm'}{draft && c.status === 'draft' ? ' (taslak)' : ''}</Text>
                        {here ? <Feather name="bookmark" size={13} color={on ? W.paper : W.gold} /> : null}
                        <Text style={[st.tocMin, on && { color: W.paper }]}>{perChapter[i]?.minutes ?? 0} dk</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={st.actions} accessibilityLabel="Okuma ayarları">
                <Btn label="A−" testID="authored-font-smaller" ghost disabled={fontSize <= 14} onPress={() => setFontSize(s => Math.max(14, s - 2))} />
                <Text style={st.meta}>{fontSize} punto</Text>
                <Btn label="A+" testID="authored-font-larger" ghost disabled={fontSize >= 28} onPress={() => setFontSize(s => Math.min(28, s + 2))} />
              </View>
              <View onLayout={(e) => { pageY.current = e.nativeEvent.layout.y; }} style={[st.page, night && st.nightCard]}>
                <View style={st.pageHead}>
                  <Text style={[st.chTitle, nightInk]}>{cur?.title ?? ''}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={night ? 'Gündüz modu' : 'Gece modu'} hitSlop={8} onPress={() => setNight(!night)}>
                    <Feather name={night ? 'sun' : 'moon'} size={18} color={night ? '#EADBC4' : W.ink} />
                  </Pressable>
                </View>
              {progressOn ? <SaveLine state={saveState} err={saveErr} onRetry={() => { if (userId && guard()) progressStore.retry(userId, bookId); }} /> : null}
                {positionPending || !cur ? <View style={{ gap: 10 }} accessibilityLabel="Kaldığın yer yükleniyor"><Skeleton h={18} /><Skeleton h={18} /><Skeleton h={18} /></View>
                  : !perChapter[curIdx]?.empty || /<img\b/i.test(cur.html) ? <HtmlView html={cur.html} night={night} fontSize={fontSize} owner={userId} privatePreview={!!draft} />
                  : <Text style={st.meta}>Bu bölümde henüz metin yok.</Text>}
                {chapters.length > 1 && cur ? (
                  <View style={st.nav}>
                    <Btn label="Önceki" testID="authored-prev" icon="chevron-left" ghost disabled={curIdx <= 0} onPress={() => select(chapters[curIdx - 1].id)} style={{ flex: 1 }} />
                    <Btn label="Sonraki" testID="authored-next" icon="chevron-right" ghost disabled={curIdx >= chapters.length - 1} onPress={() => select(chapters[curIdx + 1].id)} style={{ flex: 1 }} />
                  </View>
                ) : null}
                <CopyProtectionHint />
              </View>
              {book && !draft ? <BookComments key={bookId} bookId={bookId} focusId={focusComment} chapterId={cur && cur.id !== 'legacy' ? cur.id : null} chapterTitle={cur?.title ?? null}
                onCount={() => { void qc.invalidateQueries({ queryKey: key }); }} /> : null}
            </FadeIn>
          )}
      </MagazineScrollView>
    </View>
  );
}

function SaveLine({ state, err, onRetry }: { state: SaveState; err: string | null; onRetry: () => void }) {
  const W = useWriterPalette();
  const st = useStStyles();
  if (state === 'idle') return null;
  if (state === 'error') return (
    <View style={st.saveLine} accessibilityLiveRegion="polite">
      <Feather name="alert-circle" size={13} color={W.danger} />
      <Text style={[st.saveLineText, { color: W.danger }]}>{err ?? 'Okuma konumu kaydedilemedi.'}</Text>
      <Pressable testID="position-retry" accessibilityRole="button" onPress={() => { tap(); onRetry(); }} hitSlop={8}><Text style={st.retry}>Tekrar dene</Text></Pressable>
    </View>
  );
  return (
    <View style={st.saveLine} accessibilityLiveRegion="polite">
      <Feather name={state === 'saving' ? 'loader' : 'check'} size={13} color={W.muted} />
      <Text style={st.saveLineText}>{state === 'saving' ? 'Kaldığın yer kaydediliyor…' : 'Kaldığın yer kaydedildi'}</Text>
    </View>
  );
}

const useStStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
  wrap: { padding: 16, paddingBottom: Platform.OS === 'web' ? 94 : 60, maxWidth: 720, width: '100%', alignSelf: 'center' },
  empty: { alignItems: 'center', gap: 12, padding: 28, backgroundColor: W.paper, borderRadius: 18 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  title: { fontFamily: F.serifBold, fontSize: 25, color: W.ink, textAlign: 'center', marginTop: 8 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author: { fontFamily: F.semi, fontSize: 14, color: W.ink },
  meta: { fontFamily: F.body, fontSize: 12, color: W.muted, textAlign: 'center' },
  desc: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: W.ink, textAlign: 'center', marginTop: 4, maxWidth: 520 },
  cta: { flexDirection: 'row', gap: 10, marginTop: 10, width: '100%', maxWidth: 420 },
  readBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 26, backgroundColor: W.ink },
  readText: { fontFamily: F.serifBold, fontSize: 18, color: W.paper, letterSpacing: 0.3 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: W.gold, backgroundColor: W.paper },
  saveOn: { backgroundColor: W.gold, borderColor: W.gold },
  saveText: { fontFamily: F.semi, fontSize: 14, color: W.ink },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 6 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: 19, borderWidth: 1, borderColor: W.border, backgroundColor: W.paper },
  likeOn: { backgroundColor: W.danger, borderColor: W.danger },
  likeText: { fontFamily: F.semi, fontSize: 13, color: W.ink },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  err: { fontFamily: F.med, fontSize: 12.5, color: W.danger, textAlign: 'center' },
  toc: { marginTop: 10, backgroundColor: W.paper, borderRadius: 18, borderWidth: 1, borderColor: W.line, paddingVertical: 6, overflow: 'hidden' },
  tocHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  tocTitle: { flex: 1, fontFamily: F.serifBold, fontSize: 18, color: W.ink },
  tocRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: W.line },
  tocOn: { backgroundColor: W.ink },
  tocNum: { fontFamily: F.semi, fontSize: 12, color: W.gold, width: 22 },
  tocName: { flex: 1, fontFamily: F.med, fontSize: 14, color: W.ink, paddingVertical: 10 },
  tocMin: { fontFamily: F.body, fontSize: 11.5, color: W.muted },
  nightCard: { backgroundColor: '#2A1F15', borderColor: '#3A2C1F' },
  page: { marginTop: 12, backgroundColor: W.paper, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: W.line },
  pageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  chTitle: { flex: 1, fontFamily: F.serifBold, fontSize: 20, color: W.ink },
  saveLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  saveLineText: { fontFamily: F.body, fontSize: 11.5, color: W.muted },
  retry: { fontFamily: F.semi, fontSize: 12, color: W.ink, textDecorationLine: 'underline' },
  nav: { flexDirection: 'row', gap: 10, marginTop: 18 },
  });
});
