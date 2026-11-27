import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import {
  useGetReaderChapter, getGetReaderChapterQueryKey, setReaderLike,
  type ReaderChapter, type ReaderParagraph,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { apiError, Btn, goSignIn } from '@/components/bulletins/common';
import { scoped, actorRequest, useOwnerGuard, compactCount } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { makeStyles } from '@/hooks/useTheme';
import { useWriterPalette, writerPalette, Banner, Skeleton } from './parts';
import { CommentThreads } from './BookComments';

/**
 * One aggregate chapter query (no per-paragraph polling). Controls attach only
 * when the server's contentHash equals SHA-256 of the exact HTML on screen,
 * so a registry ID is never shown next to different text.
 */
export function useChapterDiscussion({ bookId, chapterId, html, enabled, live, onStale }: {
  bookId: string; chapterId: string | null; html: string | null; enabled: boolean; live: boolean; onStale: () => void;
}) {
  const { userId, ready } = useCommunity();
  const key = scoped(getGetReaderChapterQueryKey(bookId, chapterId ?? ''), userId);
  const q = useGetReaderChapter(bookId, chapterId ?? '', {
    query: { enabled: ready && enabled && !!chapterId, queryKey: key, retry: 1, refetchInterval: live ? 5000 : false, refetchIntervalInBackground: false },
    request: actorRequest(userId),
  });
  const [hash, setHash] = useState<{ html: string; value: string } | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);
  const [hashAttempt, setHashAttempt] = useState(0);
  useEffect(() => {
    if (html == null || !enabled) return;
    let alive = true;
    setHashError(null);
    void digestStringAsync(CryptoDigestAlgorithm.SHA256, html).then((value) => { if (alive) setHash({ html, value: value.toLowerCase() }); })
      .catch(() => { if (alive) setHashError('Bölüm doğrulanamadı; paragraf yorumları ve beğenileri şu an gösterilemiyor.'); });
    return () => { alive = false; };
  }, [html, enabled, hashAttempt]);
  const retryHash = () => { setHashError(null); setHashAttempt((n) => n + 1); };
  const meta = q.data && q.data.chapterId === chapterId ? q.data : null;
  const shownHash = hash && hash.html === html ? hash.value : null;
  const matched = !!meta && !!shownHash && meta.contentHash.toLowerCase() === shownHash;
  const mismatch = !!meta && !!shownHash && !matched;
  const staleRef = useRef(onStale); staleRef.current = onStale;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!mismatch || !meta || !shownHash) return;
    const pair = meta.contentHash + ':' + shownHash;
    if (asked.current === pair) return;
    asked.current = pair;
    staleRef.current();
  }, [mismatch, meta, shownHash]);
  const byPath = useMemo(() => {
    const m = new Map<string, ReaderParagraph>();
    if (matched && meta) for (const p of meta.paragraphs) if (!p.archived) m.set(p.path, p);
    return m;
  }, [matched, meta]);
  return { q, key, meta, matched, mismatch, byPath, hashError, retryHash };
}

/** Reversible like for chapter (paragraphId null) or one live paragraph; one lock per target. */
export function useReaderLike(bookId: string, chapterId: string | null, key: readonly unknown[]) {
  const { userId } = useCommunity();
  const guard = useOwnerGuard(userId);
  const qc = useQueryClient();
  const locks = useRef(new Set<string>());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<{ id: string; text: string } | null>(null);
  // Each response is a whole-chapter snapshot. When likes on different targets overlap,
  // no single response is known to be newest, so none is written; the aggregate is refetched once all settle.
  const overlapped = useRef(false);
  const like = async (paragraphId: string | null, liked: boolean) => {
    if (!userId) { goSignIn(); return; }
    const id = paragraphId ?? 'chapter';
    if (!chapterId || locks.current.has(id)) return;
    if (locks.current.size > 0) overlapped.current = true;
    locks.current.add(id);
    setBusy(new Set(locks.current)); setErr(null);
    try {
      const next = await setReaderLike(bookId, chapterId, { liked, paragraphId }, actorRequest(userId));
      if (guard() && !overlapped.current && locks.current.size === 1) qc.setQueryData<ReaderChapter>(key, next);
    } catch (e) { if (guard()) setErr({ id, text: apiError(e, 'Beğeni kaydedilemedi.') }); }
    finally {
      locks.current.delete(id);
      if (locks.current.size === 0 && overlapped.current) { overlapped.current = false; if (guard()) void qc.invalidateQueries({ queryKey: key }); }
      if (guard()) setBusy(new Set(locks.current));
    }
  };
  return { like, busy, err };
}

export function HashErrorBanner({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <Banner testID="reader-hash-error" icon="alert-circle" tone="warn" title="Paragraf etkileşimleri açılamadı" text={text}>
      <Btn label="Tekrar dene" icon="refresh-cw" ghost testID="reader-hash-retry" onPress={onRetry} />
    </Banner>
  );
}

export function StaleChapterBanner({ onReload, busy }: { onReload: () => void; busy: boolean }) {
  return (
    <Banner testID="reader-stale" icon="refresh-cw" tone="info" title="Bölüm güncellendi"
      text="Yazar bu bölümü az önce değiştirdi. Okuma yerin korunuyor; paragraf yorumları yeni sürüm yüklenince görünecek.">
      <Btn label={busy ? 'Yükleniyor' : 'Yeni sürümü yükle'} icon="refresh-cw" ghost busy={busy} testID="reader-stale-reload" onPress={onReload} />
    </Banner>
  );
}

/** Quiet inline strip under a paragraph: comments toggle + like. */
export function ParagraphBar({ p, open, night, busy, error, onToggle, onLike }: {
  p: ReaderParagraph; open: boolean; night: boolean; busy: boolean; error: string | null; onToggle: () => void; onLike: () => void;
}) {
  const W = useWriterPalette();
  const st = useStyles();
  const ink = night ? '#EADBC4' : W.ink;
  const muted = night ? '#B8A68C' : W.muted;
  return (
    <View style={st.barWrap}>
      <View style={st.bar}>
        <Pressable testID={'para-toggle-' + p.id} accessibilityRole="button" accessibilityState={{ expanded: open }}
          accessibilityLabel={(open ? 'Paragraf yorumlarını kapat' : 'Paragraf yorumlarını aç') + ', ' + p.commentCount + ' yorum'}
          hitSlop={6} onPress={() => { tap(); onToggle(); }}
          style={({ pressed }) => [st.chip, open && { borderColor: W.gold, backgroundColor: night ? '#3A2C1F' : W.cream }, pressed && { opacity: 0.7 }]}>
          <Feather name="message-circle" size={14} color={open ? W.gold : muted} />
          <Text style={[st.chipText, { color: open ? ink : muted }]}>{p.commentCount > 0 ? compactCount(p.commentCount) : 'Yorum yap · 0'}</Text>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={13} color={open ? W.gold : muted} />
        </Pressable>
        <Pressable testID={'para-like-' + p.id} accessibilityRole="button" accessibilityState={{ selected: p.liked, busy }}
          accessibilityLabel={(p.liked ? 'Paragraf beğenisini geri al' : 'Paragrafı beğen') + ', ' + p.likeCount}
          disabled={busy} hitSlop={6} onPress={() => { tap(); onLike(); }}
          style={({ pressed }) => [st.chip, p.liked && { borderColor: W.danger }, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}>
          <Feather name="heart" size={14} color={p.liked ? W.danger : muted} />
          <Text style={[st.chipText, { color: p.liked ? W.danger : muted }]}>{p.likeCount > 0 ? compactCount(p.likeCount) : ''}</Text>
        </Pressable>
      </View>
      {error ? <Text style={st.err} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

/** The expanded discussion right below its paragraph. */
export function ParagraphThread({ bookId, chapterId, p, night, onClose, onCount, locked, focusId, onFocusTarget }: {
  bookId: string; chapterId: string; p: ReaderParagraph; night: boolean; onClose: () => void; onCount: () => void; locked?: boolean; focusId?: string | null;
  onFocusTarget?: (target: ViewInstance | null) => void;
}) {
  const W = useWriterPalette();
  const st = useStyles();
  return (
    <View style={[st.thread, night && { backgroundColor: W.paper }]} testID={'para-thread-' + p.id}>
      <View style={st.threadHead}>
        <Feather name="corner-down-right" size={14} color={W.gold} />
        <Text style={st.threadTitle}>{locked ? 'Arşivlenmiş paragraf' : 'Bu paragraf üzerine'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Paragraf yorumlarını kapat" hitSlop={10} onPress={() => { tap(); onClose(); }} style={st.close}>
          <Feather name="x" size={16} color={W.muted} />
        </Pressable>
      </View>
      <CommentThreads bookId={bookId} context={{ scope: 'paragraph', chapterId, paragraphId: p.id }} onCount={onCount} locked={locked} focusId={focusId} onFocusTarget={onFocusTarget}
        placeholder="Bu satırlar sana ne düşündürdü?" testID={'para-comment-' + p.id} empty="Bu paragrafta henüz yorum yok. İlk düşünceyi sen bırak." />
    </View>
  );
}

/** Chapter end: chapter like, authoritative totals, chapter-only comments and archived paragraph discussions. */
export function ChapterEnd({ bookId, chapterId, chapterTitle, disc, likes, onCount, chapterOpen, setChapterOpen, archivedOpen, setArchivedOpen, openArchived, setOpenArchived, night, focusId, onFocusTarget, readError, onRetryRead }: {
  bookId: string; chapterId: string; chapterTitle: string; disc: ReturnType<typeof useChapterDiscussion>; likes: ReturnType<typeof useReaderLike>;
  onCount: () => void; chapterOpen: boolean; setChapterOpen: (v: boolean) => void; archivedOpen: boolean; setArchivedOpen: (v: boolean) => void;
  openArchived: string | null; setOpenArchived: (id: string | null) => void; night: boolean;
  focusId?: string | null; onFocusTarget?: (target: ViewInstance | null) => void;
  readError?: string | null; onRetryRead?: () => void;
}) {
  const W = useWriterPalette();
  const st = useStyles();
  const meta = disc.meta;
  const archived = meta?.archived ?? [];
  return (
    <View style={[st.end, night && { borderColor: '#3A2C1F' }]} testID="chapter-end">
      <Text style={st.endKicker}>Bölüm sonu</Text>
      <Text style={st.endTitle} accessibilityRole="header" numberOfLines={2}>{chapterTitle || 'Adsız bölüm'}</Text>
      {disc.q.isLoading ? <Skeleton h={44} /> : !meta ? (
        <View style={st.row}>
          <Text style={st.err}>{apiError(disc.q.error, 'Bölüm etkileşimleri yüklenemedi.')}</Text>
          <Btn label="Tekrar dene" ghost onPress={() => void disc.q.refetch()} />
        </View>
      ) : (
        <>
          <View style={st.row}>
            <Pressable testID="chapter-like" accessibilityRole="button" accessibilityState={{ selected: meta.liked, busy: likes.busy.has('chapter') }}
              accessibilityLabel={meta.liked ? 'Bölüm beğenisini geri al' : 'Bölümü beğen'} disabled={likes.busy.has('chapter')}
              onPress={() => { tap(); void likes.like(null, !meta.liked); }}
              style={({ pressed }) => [st.big, meta.liked && { backgroundColor: W.danger, borderColor: W.danger }, { opacity: likes.busy.has('chapter') ? 0.55 : pressed ? 0.75 : 1 }]}>
              <Feather name="heart" size={16} color={meta.liked ? W.paper : W.ink} />
              <Text style={[st.bigText, meta.liked && { color: W.paper }]}>{meta.liked ? 'Beğendin' : 'Bölümü beğen'} · {compactCount(meta.likeCount)}</Text>
            </Pressable>
            <Pressable testID="chapter-comments-toggle" accessibilityRole="button" accessibilityState={{ expanded: chapterOpen }}
              onPress={() => { tap(); setChapterOpen(!chapterOpen); }}
              style={({ pressed }) => [st.big, chapterOpen && { borderColor: W.gold }, pressed && { opacity: 0.75 }]}>
              <Feather name="message-circle" size={16} color={chapterOpen ? W.gold : W.ink} />
              <Text style={st.bigText}>Bölüm yorumları · {compactCount(meta.chapterCommentCount)}</Text>
              <Feather name={chapterOpen ? 'chevron-up' : 'chevron-down'} size={15} color={W.muted} />
            </Pressable>
          </View>
          {likes.err?.id === 'chapter' ? <Text style={st.err} accessibilityLiveRegion="polite">{likes.err.text}</Text> : null}
          <Text style={st.meta} accessibilityLabel={meta.commentCount + ' toplam yorum, paragraf yanıtları dahil'}>
            Bu bölümde toplam {meta.commentCount.toLocaleString('tr-TR')} yorum (paragraflar dahil)
          </Text>
          <View style={st.row} accessibilityLabel={meta.readCount + ' bölüm okuması'}>
            <Feather name="eye" size={14} color={W.muted} />
            <Text style={st.meta}>{compactCount(meta.readCount)} bölüm okuması</Text>
          </View>
          {readError ? <View style={st.row}>
            <Text style={st.err} accessibilityLiveRegion="polite">{readError}</Text>
            {onRetryRead ? <Btn label="Tekrar dene" ghost onPress={onRetryRead} /> : null}
          </View> : null}
          {chapterOpen ? (
            <View style={st.endThread}>
              <CommentThreads bookId={bookId} context={{ scope: 'chapter', chapterId }} onCount={onCount} focusId={focusId} onFocusTarget={onFocusTarget}
                placeholder={(chapterTitle || 'Bu bölüm') + ' hakkında ne düşündün?'} testID="chapter-comment" empty="Bu bölüm hakkında henüz yorum yok." />
            </View>
          ) : null}
          {archived.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Pressable testID="archived-toggle" accessibilityRole="button" accessibilityState={{ expanded: archivedOpen }}
                onPress={() => { tap(); setArchivedOpen(!archivedOpen); }} style={st.archHead}>
                <Feather name="archive" size={15} color={W.muted} />
                <Text style={[st.meta, { flex: 1, textAlign: 'left' }]}>Değiştirilmiş paragraflardaki eski konuşmalar ({archived.length})</Text>
                <Feather name={archivedOpen ? 'chevron-up' : 'chevron-down'} size={15} color={W.muted} />
              </Pressable>
              {archivedOpen ? archived.map((p) => (
                <View key={p.id} style={{ gap: 6 }}>
                  <Pressable testID={'archived-' + p.id} accessibilityRole="button" accessibilityState={{ expanded: openArchived === p.id }}
                    onPress={() => { tap(); setOpenArchived(openArchived === p.id ? null : p.id); }} style={st.archItem}>
                    <Text style={st.archQuote} numberOfLines={openArchived === p.id ? undefined : 2}>{p.quote}</Text>
                    <Text style={st.meta}>{p.commentCount} yorum · {p.likeCount} beğeni</Text>
                  </Pressable>
                  {p.liked ? (
                    <Pressable testID={'archived-unlike-' + p.id} accessibilityRole="button" accessibilityState={{ busy: likes.busy.has(p.id) }}
                      disabled={likes.busy.has(p.id)} onPress={() => { tap(); void likes.like(p.id, false); }}
                      style={({ pressed }) => [st.unlike, { opacity: likes.busy.has(p.id) ? 0.55 : pressed ? 0.7 : 1 }]}>
                      <Feather name="heart" size={14} color={W.danger} />
                      <Text style={[st.bigText, { fontSize: 12.5 }]}>{likes.busy.has(p.id) ? 'Geri alınıyor' : 'Beğenimi geri al'}</Text>
                    </Pressable>
                  ) : null}
                  {likes.err?.id === p.id ? <Text style={st.err} accessibilityLiveRegion="polite">{likes.err.text}</Text> : null}
                  {openArchived === p.id ? <ParagraphThread bookId={bookId} chapterId={chapterId} p={p} night={night} locked onClose={() => setOpenArchived(null)} onCount={onCount} focusId={focusId} onFocusTarget={onFocusTarget} /> : null}
                </View>
              )) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    barWrap: { marginTop: -8, marginBottom: 12, gap: 4 },
    bar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, minWidth: 44, paddingHorizontal: 11, borderRadius: 18, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center' },
    chipText: { fontFamily: F.semi, fontSize: 12 },
    err: { fontFamily: F.med, fontSize: 12.5, color: W.danger },
    thread: { marginBottom: 16, padding: 14, borderRadius: 14, backgroundColor: W.cream, borderLeftWidth: 3, borderLeftColor: W.gold, gap: 12 },
    threadHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    threadTitle: { flex: 1, fontFamily: F.semi, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: W.ink },
    close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    end: { marginTop: 18, padding: 18, borderRadius: 18, backgroundColor: W.paper, borderWidth: 1, borderColor: W.line, gap: 12 },
    endKicker: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: W.gold, textAlign: 'center' },
    endTitle: { fontFamily: F.serifBold, fontSize: 19, color: W.ink, textAlign: 'center' },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', alignItems: 'center' },
    big: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: W.border, backgroundColor: W.paper },
    bigText: { fontFamily: F.semi, fontSize: 13.5, color: W.ink },
    meta: { fontFamily: F.body, fontSize: 12, color: W.muted, textAlign: 'center' },
    endThread: { paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: W.line },
    archHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: W.line, paddingTop: 8 },
    archItem: { padding: 12, borderRadius: 12, backgroundColor: W.cream, gap: 4, minHeight: 44 },
    unlike: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: W.danger },
    archQuote: { fontFamily: F.body, fontStyle: 'italic', fontSize: 14, lineHeight: 21, color: W.ink },
  });
});
