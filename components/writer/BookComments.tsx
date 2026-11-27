import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewInstance } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { makeStyles } from '@/hooks/useTheme';
import { useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import {
  getBookCommentThreads, getGetBookCommentThreadsQueryKey, getWriterCommentReplies, getGetWriterCommentRepliesQueryKey,
  useGetWriterCommentPath, getGetWriterCommentPathQueryKey, addAuthoredBookComment, setWriterCommentReaction, reportWriterComment,
  type WriterComment, type WriterCommentPage, type GetBookCommentThreadsParams, type ReaderReportInputReason,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Avatar, Btn, apiError, goSignIn } from '@/components/bulletins/common';
import { scoped, actorRequest, useOwnerGuard } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { useWriterPalette, writerPalette, Skeleton } from '@/components/writer/parts';
import { CommentOwnerActions } from './CommentOwnerActions';

type Reaction = 'like' | 'love';
const MAX_INDENT = 4;
const accessDenied = (error: unknown) => [401, 403, 404].includes((error as { status?: number } | null)?.status ?? 0);

/** Refreshes only this owner's thread, reply and path queries for the book's discussion. */
function invalidateDiscussion(qc: QueryClient, bookId: string, userId: string | null) {
  const threads = getGetBookCommentThreadsQueryKey(bookId)[0];
  const as = userId ?? 'guest';
  return qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey;
      const last = k[k.length - 1] as { as?: string } | undefined;
      if (!last || typeof last !== 'object' || last.as !== as) return false;
      const head = String(k[0]);
      return head === threads || head.startsWith('/api/writer-comments/');
    },
  });
}

/** Update every visible copy (thread/replies/notification path) before a refresh. */
function replaceDiscussionComment(qc: QueryClient, bookId: string, userId: string, next: WriterComment) {
  const threads = getGetBookCommentThreadsQueryKey(bookId)[0];
  qc.setQueriesData({ predicate: query => {
    const key = query.queryKey, actor = key[key.length - 1] as { as?: string } | undefined;
    return actor?.as === userId && (key[0] === threads || String(key[0]).startsWith('/api/writer-comments/'));
  } }, (data: unknown) => {
    const swap = (items: WriterComment[]) => items.map(item => item.id === next.id ? next : item);
    if (Array.isArray(data)) return swap(data);
    if (!data || typeof data !== 'object') return data;
    const pages = data as { pages?: WriterCommentPage[] };
    return Array.isArray(pages.pages) ? { ...pages, pages: pages.pages.map(page => ({ ...page, items: swap(page.items) })) } : data;
  });
}

/** Where a discussion lives. Paragraph and chapter threads never leak into each other or into the general book area. */
export type DiscussionContext =
  | { scope: 'book' }
  | { scope: 'chapter'; chapterId: string }
  | { scope: 'paragraph'; chapterId: string; paragraphId: string };
export const contextKey = (c: DiscussionContext) => c.scope === 'book' ? 'book' : c.scope === 'chapter' ? 'ch:' + c.chapterId : 'p:' + c.chapterId + ':' + c.paragraphId;
export function commentInContext(c: WriterComment, bookId: string, context: DiscussionContext) {
  if (c.bookId !== bookId) return false;
  if (context.scope === 'book') return !c.chapterId && !c.paragraphId;
  return c.chapterId === context.chapterId && (context.scope === 'paragraph' ? c.paragraphId === context.paragraphId : !c.paragraphId);
}
const contextParams = (c: DiscussionContext): GetBookCommentThreadsParams =>
  c.scope === 'book' ? { scope: 'book' } : c.scope === 'chapter' ? { scope: 'chapter', chapterId: c.chapterId } : { scope: 'paragraph', chapterId: c.chapterId, paragraphId: c.paragraphId };

/** Live polling for visible discussion contexts only (set by the active reader view). */
const LiveCtx = createContext(false);
export const DiscussionLive = LiveCtx.Provider;
const LIVE_MS = 5000;

type PendingInput = { clientId: string; body: string; chapterId: string | null; paragraphId: string | null; parentId: string | null };
type Draft = { body: string; pending: PendingInput | null; owner?: symbol };
/** Unsent text survives collapsing an area; keyed by actor + book + exact context + parent, so it never moves elsewhere. */
const drafts = new Map<string, Draft>();

const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** General book discussion (chapterId NULL) plus the notification thread. Chapter and paragraph talk lives in the reader. */
export function BookComments({ bookId, onCount, focusId, onFocusTarget }: {
  bookId: string; onCount: () => void; focusId?: string | null; onFocusTarget?: (target: ViewInstance | null) => void;
}) {
  const cm = useCmStyles();
  return (
    <View style={cm.wrap} testID="book-comments">
      <Text style={cm.h} accessibilityRole="header">Kitap hakkında genel</Text>
      <Text style={cm.meta}>Bölümlerden bağımsız, kitabın bütünü üzerine konuşmalar.</Text>
      <CommentThreads bookId={bookId} context={{ scope: 'book' }} focusId={focusId} onFocusTarget={onFocusTarget} onCount={onCount} placeholder="Kitabın bütünü hakkında ne düşündün?" testID="comment"
        empty="Kitap hakkında henüz genel bir konuşma yok. İlk satırı sen yaz." />
    </View>
  );
}

/** Composer + paged root threads for one discussion context. */
export function CommentThreads({ bookId, context, onCount, placeholder, testID, empty, locked, focusId, onFocusTarget }: {
  bookId: string; context: DiscussionContext; onCount: () => void; placeholder: string; testID: string; empty: string; locked?: boolean; focusId?: string | null;
  onFocusTarget?: (target: ViewInstance | null) => void;
}) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  const live = useContext(LiveCtx);
  const { userId, ready } = useCommunity();
  const params = contextParams(context);
  const q = useInfiniteQuery({
    queryKey: scoped([...getGetBookCommentThreadsQueryKey(bookId, params), 'pages'] as const, userId),
    queryFn: ({ pageParam, signal }) => getBookCommentThreads(bookId, pageParam ? { ...params, cursor: pageParam } : params, { signal, ...actorRequest(userId) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: WriterCommentPage) => last.nextCursor,
    enabled: ready && !!bookId,
    refetchInterval: live ? LIVE_MS : false,
    refetchIntervalInBackground: false,
  });
  const roots = q.data?.pages.flatMap((p) => p.items) ?? [];
  const denied = q.isError && accessDenied(q.error);
  const focus = useGetWriterCommentPath(focusId ?? '', { query: {
    enabled: ready && !!focusId, queryKey: scoped(getGetWriterCommentPathQueryKey(focusId ?? ''), userId),
    refetchInterval: live && focusId ? LIVE_MS : false, refetchIntervalInBackground: false,
  }, request: actorRequest(userId) });
  const focused = !denied && !accessDenied(focus.error) && !!focus.data?.length
    && focus.data.some(c => c.id === focusId) && focus.data.every(c => commentInContext(c, bookId, context));
  const focusedRoot = focused ? focus.data?.[0]?.id : null;
  const key = contextKey(context);
  return (
    <View style={{ gap: 14 }}>
      {denied ? null : locked ? (
        <View style={cm.emptyBox}><Feather name="archive" size={18} color={W.muted} /><Text style={cm.empty}>Bu paragraf yazar tarafından değiştirildi. Eski konuşma okunabilir ve yanıtlanabilir; yeni yorum ya da beğeni eklenemez.</Text></View>
      ) : userId ? (
        <Composer key={(userId ?? 'guest') + ':' + key} bookId={bookId} parent={null} context={context} onCount={onCount} placeholder={placeholder} testID={testID} />
      ) : <Btn label="Yorum yazmak için giriş yap" ghost onPress={goSignIn} />}
      {focused && focusId ? <FocusedThread focusId={focusId} bookId={bookId} context={context} onCount={onCount} onFocusTarget={onFocusTarget} /> : null}
      {denied ? <Text style={cm.err}>Bu yorumlar artık görüntülenemiyor.</Text> : q.isLoading || (!!focusId && focus.isLoading) ? <View style={{ gap: 10 }}><Skeleton h={64} /><Skeleton h={64} /></View> : q.isError && roots.length === 0 ? (
        <View style={{ gap: 8 }}><Text style={cm.err}>{apiError(q.error, 'Yorumlar yüklenemedi.')}</Text><Btn label="Tekrar dene" ghost onPress={() => void q.refetch()} /></View>
      ) : roots.length === 0 && !focused ? (
        <View style={cm.emptyBox}>
          <Feather name="message-circle" size={20} color={W.gold} />
          <Text style={cm.empty}>{empty}</Text>
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          {roots.filter(c => c.id !== focusedRoot).map((c) => <CommentNode key={c.id} c={c} depth={0} bookId={bookId} onCount={onCount} />)}
          {q.isError ? <Text style={cm.err}>{apiError(q.error, 'Yorumlar yenilenemedi. Gördüklerin duruyor.')}</Text> : null}
          {q.hasNextPage ? <Btn label={q.isFetchingNextPage ? 'Yükleniyor' : 'Daha eski yorumlar'} ghost busy={q.isFetchingNextPage} testID={testID + '-more'} onPress={() => void q.fetchNextPage()} /> : null}
        </View>
      )}
    </View>
  );
}

/** Notification target: real ancestors root-to-target from the path endpoint, shown as its own labelled discussion. */
function FocusedThread({ focusId, bookId, context, onCount, onFocusTarget }: {
  focusId: string; bookId: string; context: DiscussionContext; onCount: () => void; onFocusTarget?: (target: ViewInstance | null) => void;
}) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  const { userId, ready } = useCommunity();
  const q = useGetWriterCommentPath(focusId, { query: { enabled: ready && !!focusId, queryKey: scoped(getGetWriterCommentPathQueryKey(focusId), userId) }, request: actorRequest(userId) });
  const [highlightActive, setHighlightActive] = useState(false);
  const hasTarget = !!q.data?.some(c => c.id === focusId);
  useEffect(() => {
    if (!hasTarget) return;
    setHighlightActive(true);
    const timeout = setTimeout(() => setHighlightActive(false), 3500);
    return () => clearTimeout(timeout);
  }, [hasTarget, focusId]);
  const missing = accessDenied(q.error) || !!q.data?.some(c => !commentInContext(c, bookId, context));
  const target = q.data?.find(c => c.id === focusId);
  if (missing || (target?.deleted && target.replyCount === 0)) return null;
  return (
    <View style={cm.focus} testID="focused-thread">
      <View style={cm.focusHead}><Feather name="bell" size={14} color={W.gold} /><Text style={cm.focusTitle}>Bildirimdeki tartışma</Text></View>
      {q.isLoading ? <Skeleton h={70} /> : missing ? <Text style={cm.empty}>Bu yorum artık görüntülenemiyor. Kaldırılmış ya da gizlenmiş olabilir.</Text>
        : q.isError && !q.data?.length ? (
          <View style={{ gap: 8 }}><Text style={cm.err}>{apiError(q.error, 'Bildirimdeki yorum yüklenemedi.')}</Text><Btn label="Tekrar dene" ghost onPress={() => void q.refetch()} /></View>
      ) : (
        <View>
          {(q.data ?? []).filter(c => !c.deleted || c.id === focusId).map((c, i) => (
            <View key={c.id} style={i > 0 ? [cm.indent, { marginLeft: i < MAX_INDENT ? 0 : -14 }] : null}>
              <CommentNode c={c} depth={i} bookId={bookId} onCount={onCount} highlight={c.id === focusId && highlightActive}
                onFocusTarget={c.id === focusId ? onFocusTarget : undefined} expandable={c.id === focusId} />
            </View>
          ))}
          {q.isError ? <Text style={cm.err}>Konuşma yenilenemedi. Önceki yorumlar korunuyor.</Text> : null}
        </View>
      )}
    </View>
  );
}

function CommentNode({ c, depth, bookId, onCount, highlight, expandable = true, onFocusTarget }: {
  c: WriterComment; depth: number; bookId: string; onCount: () => void; highlight?: boolean; expandable?: boolean;
  onFocusTarget?: (target: ViewInstance | null) => void;
}) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  const { userId } = useCommunity();
  const guard = useOwnerGuard(userId);
  const qc = useQueryClient();
  const [view, setView] = useState(c);
  useEffect(() => { setView(c); }, [c]);
  const [open, setOpen] = useState(false);
  const [replying, setReplying] = useState(false);
  const [rBusy, setRBusy] = useState(false);
  const reacting = useRef(false);
  const [rErr, setRErr] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const lastWanted = useRef<Reaction | null>(null);
  const focusRef = useRef<ViewInstance>(null);
  useEffect(() => {
    if (highlight && focusRef.current) onFocusTarget?.(focusRef.current);
  }, [highlight, onFocusTarget]);
  const selected = view.reactions.find((r) => r.selected)?.reaction ?? null;
  const count = (r: Reaction) => view.reactions.find((x) => x.reaction === r)?.count ?? 0;

  const sendReaction = async (next: Reaction | null) => {
    if (!userId) { goSignIn(); return; }
    if (reacting.current || view.deleted) return;
    reacting.current = true;
    lastWanted.current = next;
    setRBusy(true); setRErr(null);
    try {
      const res = await setWriterCommentReaction(view.id, { reaction: next }, actorRequest(userId));
      if (!guard()) return;
      setView(current => current.deleted ? current : { ...current, reactions: res.reactions });
      void invalidateDiscussion(qc, bookId, userId);
    } catch (e) { if (guard()) setRErr(apiError(e, 'Tepkin kaydedilemedi.')); }
    finally { reacting.current = false; if (guard()) setRBusy(false); }
  };
  const toggle = (r: Reaction) => { tap(); void sendReaction(selected === r ? null : r); };
  const showToggle = expandable && (view.replyCount > 0 || open);
  // A deleted node is routing structure only, never a visible card or avatar.
  // Promote its surviving children automatically rather than hiding them behind a dead parent.
  if (view.deleted) return expandable && view.replyCount > 0
    ? <Replies parent={view} depth={depth} bookId={bookId} onCount={onCount} /> : null;

  return (
    <View ref={highlight ? focusRef : undefined} testID={'comment-' + view.id} style={[cm.node, highlight && cm.highlight]}>
      <View style={cm.row}>
        <Avatar person={view.author} size={30} />
        <View style={{ flex: 1, gap: 3 }}>
          <>
            <Text style={cm.name}>{view.author.nickname} <Text style={cm.meta}>· {when(view.createdAt)}</Text></Text>
            <Text style={cm.body} selectable>{view.body}</Text>
          </>
          <View style={cm.actions}>
            {!view.deleted ? <>
              <ReactBtn icon="thumbs-up" label="Beğen" on={selected === 'like'} n={count('like')} busy={rBusy} onPress={() => toggle('like')} testID={'react-like-' + view.id} />
              <ReactBtn icon="heart" label="Sevdim" on={selected === 'love'} n={count('love')} busy={rBusy} onPress={() => toggle('love')} testID={'react-love-' + view.id} />
              <Pressable testID={'reply-' + view.id} accessibilityRole="button" hitSlop={6} onPress={() => { tap(); if (!userId) goSignIn(); else setReplying((v) => !v); }} style={cm.act}>
                <Feather name="corner-down-right" size={13} color={replying ? W.gold : W.muted} />
                <Text style={[cm.actText, replying && { color: W.ink }]}>{replying ? 'Vazgeç' : 'Yanıtla'}</Text>
              </Pressable>
            </> : null}
            {showToggle ? (
              <Pressable testID={'replies-toggle-' + view.id} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6} onPress={() => { tap(); setOpen((v) => !v); }} style={cm.act}>
                <Feather name={open ? 'chevron-up' : 'chevron-down'} size={13} color={W.gold} />
                <Text style={[cm.actText, { color: W.ink }]}>{open ? 'Yanıtları gizle' : view.replyCount + ' yanıt'}</Text>
              </Pressable>
            ) : null}
            {userId && view.author.id !== userId ? (
              <Pressable testID={'report-' + view.id} accessibilityRole="button" accessibilityLabel="Yorumu bildir" disabled={reported} hitSlop={8} onPress={() => { tap(); setReporting(true); }} style={cm.act}>
                <Feather name="flag" size={13} color={W.muted} />
                <Text style={cm.actText}>{reported ? 'Bildirildi' : 'Bildir'}</Text>
              </Pressable>
            ) : null}
          </View>
          {reporting ? <ReportSheet comment={view} onClose={(done) => { setReporting(false); if (done) setReported(true); }} /> : null}
          {reported ? <Text style={cm.meta} accessibilityLiveRegion="polite">Bildirimin yöneticilere iletildi. Teşekkürler.</Text> : null}
          {rErr ? (
            <View style={cm.inlineErr}>
              <Text style={cm.err}>{rErr}</Text>
              <Pressable accessibilityRole="button" hitSlop={6} onPress={() => void sendReaction(lastWanted.current)}><Text style={cm.retry}>Tekrar dene</Text></Pressable>
            </View>
          ) : null}
          <CommentOwnerActions comment={view} blocked={replying || rBusy} onChanged={next => {
            if (!userId || !guard()) return;
            setView(next);
            replaceDiscussionComment(qc, bookId, userId, next);
            void invalidateDiscussion(qc, bookId, userId);
            onCount();
          }} />
        </View>
      </View>
      {replying && !view.deleted ? (
        <View style={cm.indent}>
          <Composer key={(userId ?? 'guest') + ':' + view.id} bookId={bookId} parent={view} context={null} onCount={onCount} autoFocus testID={'reply-' + view.id}
            placeholder={view.author.nickname + ' kişisine yanıt yaz'} onPosted={(keepDraft) => { if (!keepDraft) setReplying(false); setOpen(true); }} />
        </View>
      ) : null}
      {open && expandable ? (
        <View style={[cm.indent, depth + 1 >= MAX_INDENT && { marginLeft: 0 }]}>
          <Replies parent={view} depth={depth + 1} bookId={bookId} onCount={onCount} />
        </View>
      ) : null}
    </View>
  );
}

function ReactBtn({ icon, label, on, n, busy, onPress, testID }: { icon: keyof typeof Feather.glyphMap; label: string; on: boolean; n: number; busy: boolean; onPress: () => void; testID: string }) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: on, busy }} accessibilityLabel={label + ', ' + n + (on ? ', seçili' : '')}
      disabled={busy} hitSlop={6} onPress={onPress} style={({ pressed }) => [cm.pill, on && { backgroundColor: W.ink, borderColor: W.ink }, { opacity: busy ? 0.55 : pressed ? 0.7 : 1 }]}>
      <Feather name={icon} size={12} color={on ? W.paper : W.muted} />
      <Text style={[cm.pillText, on && { color: W.paper }]}>{n}</Text>
    </Pressable>
  );
}

function Replies({ parent, depth, bookId, onCount }: { parent: WriterComment; depth: number; bookId: string; onCount: () => void }) {
  const cm = useCmStyles();
  const live = useContext(LiveCtx);
  const { userId, ready } = useCommunity();
  const q = useInfiniteQuery({
    refetchInterval: live ? LIVE_MS : false,
    refetchIntervalInBackground: false,
    queryKey: scoped([...getGetWriterCommentRepliesQueryKey(parent.id), 'pages'] as const, userId),
    queryFn: ({ pageParam, signal }) => getWriterCommentReplies(parent.id, pageParam ? { cursor: pageParam } : undefined, { signal, ...actorRequest(userId) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: WriterCommentPage) => last.nextCursor,
    enabled: ready,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isError && accessDenied(q.error)) return <Text style={cm.err}>Bu konuşma artık görüntülenemiyor.</Text>;
  if (q.isLoading) return <Skeleton h={48} />;
  if (q.isError && items.length === 0) return (
    <View style={cm.inlineErr}><Text style={cm.err}>{apiError(q.error, 'Yanıtlar yüklenemedi.')}</Text>
      <Pressable accessibilityRole="button" hitSlop={6} onPress={() => void q.refetch()}><Text style={cm.retry}>Tekrar dene</Text></Pressable></View>
  );
  return (
    <View style={{ gap: 12 }}>
      {items.map((c) => <CommentNode key={c.id} c={c} depth={depth} bookId={bookId} onCount={onCount} />)}
      {q.isError ? <Text style={cm.err}>Yanıtlar yenilenemedi. Önceki yorumlar korunuyor.</Text> : null}
      {q.hasNextPage ? (
        <Pressable testID={'replies-more-' + parent.id} accessibilityRole="button" disabled={q.isFetchingNextPage} onPress={() => { tap(); void q.fetchNextPage(); }} style={cm.act}>
          <Text style={cm.retry}>{q.isFetchingNextPage ? 'Yükleniyor' : 'Daha fazla yanıt'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Retries resend the exact same clientId + payload, so a lost response never duplicates or drops a comment. */
function Composer({ bookId, parent, context, placeholder, onCount, onPosted, autoFocus, testID }: {
  bookId: string; parent: WriterComment | null; context: DiscussionContext | null; placeholder: string; onCount: () => void; onPosted?: (keepDraft: boolean) => void; autoFocus?: boolean; testID: string;
}) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  const { userId } = useCommunity();
  const guard = useOwnerGuard(userId);
  const qc = useQueryClient();
  const draftKey = (userId ?? 'guest') + '|' + bookId + '|' + (parent ? 'reply:' + parent.id : contextKey(context ?? { scope: 'book' }));
  const stored = drafts.get(draftKey);
  const [body, setBodyState] = useState(stored?.body ?? '');
  const latestBody = useRef(body); latestBody.current = body;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = useRef<PendingInput | null>(stored?.pending ?? null);
  const sending = useRef(false);
  const onPostedRef = useRef(onPosted); onPostedRef.current = onPosted;
  const mounted = useRef(true);
  const instance = useRef(Symbol('comment-draft'));
  useEffect(() => {
    mounted.current = true;
    const current = drafts.get(draftKey);
    if (current) drafts.set(draftKey, { ...current, owner: instance.current });
    return () => { mounted.current = false; };
  }, [draftKey]);
  const remember = () => {
    // A collapsed instance can finish after its replacement has a newer draft.
    // Its acknowledgement must never overwrite that replacement's text.
    if (!mounted.current && drafts.get(draftKey)?.owner !== instance.current) return;
    const b = latestBody.current;
    if (!b && !pending.current) drafts.delete(draftKey); else drafts.set(draftKey, { body: b, pending: pending.current, owner: instance.current });
  };
  const setBody = (next: string | ((cur: string) => string)) => {
    const v = typeof next === 'function' ? next(latestBody.current) : next;
    latestBody.current = v; remember();
    if (mounted.current) setBodyState(v);
  };
  const send = async () => {
    if ((!latestBody.current.trim() && !pending.current) || !userId || sending.current) return;
    // Replies inherit the parent's chapter and paragraph, never the reader's current position.
    const input: PendingInput = pending.current ?? {
      clientId: randomUUID(), body: latestBody.current.trim(),
      chapterId: parent ? parent.chapterId : context && context.scope !== 'book' ? context.chapterId : null,
      paragraphId: parent ? parent.paragraphId ?? null : context?.scope === 'paragraph' ? context.paragraphId : null,
      parentId: parent?.id ?? null,
    };
    pending.current = input; remember();
    sending.current = true;
    if (mounted.current) { setBusy(true); setErr(null); }
    try {
      await addAuthoredBookComment(bookId, input, actorRequest(userId));
      if (!guard()) return;
      pending.current = null;
      // Newer text typed during the save stays as the next draft.
      setBody((cur) => cur.trim() === input.body ? '' : cur);
      void invalidateDiscussion(qc, bookId, userId);
      if (mounted.current) {
        onCount();
        onPostedRef.current?.(latestBody.current.trim() !== '' && latestBody.current.trim() !== input.body);
      }
    } catch (e) { if (mounted.current && guard()) setErr(apiError(e, 'Yorum gönderilemedi. Metnin duruyor.')); }
    finally { sending.current = false; remember(); if (mounted.current && guard()) setBusy(false); }
  };
  return (
    <View style={{ gap: 8 }}>
      <TextInput testID={testID + '-input'} value={body} onChangeText={setBody} maxLength={3000} multiline autoFocus={autoFocus} placeholder={placeholder}
        placeholderTextColor={W.muted} style={[cm.input, parent && cm.inputSmall]} accessibilityLabel={parent ? 'Yanıt yaz' : 'Yorum yaz'} />
      {err ? <Text style={cm.err} accessibilityLiveRegion="polite">{err}</Text> : null}
      {!err && pending.current && !busy ? <Text style={cm.meta}>Gönderilmemiş bir yorumun var.</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Btn label={pending.current && !busy ? 'Önceki metni tekrar gönder' : parent ? 'Yanıtla' : 'Gönder'} icon="send" testID={testID + '-send'} busy={busy}
          disabled={!body.trim() && !pending.current} onPress={() => void send()} />
        {pending.current && !busy ? <Btn label="Vazgeç" ghost onPress={() => { pending.current = null; remember(); setErr(null); }} /> : null}
      </View>
    </View>
  );
}

const REASONS: { key: ReaderReportInputReason; label: string; sub: string }[] = [
  { key: 'spam', label: 'Spam ya da reklam', sub: 'Tekrarlayan, alakasız ya da tanıtım amaçlı içerik' },
  { key: 'abuse', label: 'Hakaret ya da taciz', sub: 'Bir kişiyi hedef alan, aşağılayan ya da tehdit eden dil' },
  { key: 'other', label: 'Başka bir sorun', sub: 'Aşağıda kısaca açıkla' },
];

/** Explicit reason + optional details; the reader's scroll position is never touched. */
function ReportSheet({ comment, onClose }: { comment: WriterComment; onClose: (done: boolean) => void }) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  const { userId } = useCommunity();
  const guard = useOwnerGuard(userId);
  const [reason, setReason] = useState<ReaderReportInputReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);
  const submit = async () => {
    if (!userId || !reason || lock.current) return;
    lock.current = true; setBusy(true); setErr(null);
    try {
      const d = details.trim();
      await reportWriterComment(comment.id, d ? { reason, details: d } : { reason }, actorRequest(userId));
      if (guard()) onClose(true);
    } catch (e) { if (guard()) setErr(apiError(e, 'Bildirim gönderilemedi. Tekrar dene.')); }
    finally { lock.current = false; if (guard()) setBusy(false); }
  };
  const close = () => { if (!lock.current) onClose(false); };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={cm.backdrop} onPress={close} accessibilityLabel="Kapat">
          <Pressable style={cm.sheet} onPress={() => {}} testID={'report-sheet-' + comment.id}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 12 }}>
              <Text style={cm.h} accessibilityRole="header">Yorumu bildir</Text>
              <Text style={cm.quote} numberOfLines={3}>{comment.author.nickname}: {comment.body}</Text>
              <Text style={cm.meta}>Neden bildiriyorsun? Bildirimin yalnızca yöneticilere gider; yorum sahibi kimin bildirdiğini görmez.</Text>
              <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                {REASONS.map((r) => {
                  const on = reason === r.key;
                  return (
                    <Pressable key={r.key} testID={'report-reason-' + r.key} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { tap(); setReason(r.key); }}
                      style={({ pressed }) => [cm.reason, on && { borderColor: W.ink, backgroundColor: W.cream }, pressed && { opacity: 0.75 }]}>
                      <Feather name={on ? 'check-circle' : 'circle'} size={18} color={on ? W.ink : W.muted} />
                      <View style={{ flex: 1 }}><Text style={cm.name}>{r.label}</Text><Text style={cm.meta}>{r.sub}</Text></View>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput testID="report-details" value={details} onChangeText={setDetails} maxLength={1000} multiline placeholder="Ek açıklama (isteğe bağlı)"
                placeholderTextColor={W.muted} style={cm.input} accessibilityLabel="Ek açıklama" />
              {err ? <Text style={cm.err} accessibilityLiveRegion="polite">{err}</Text> : null}
              <Btn label="Bildirimi gönder" icon="flag" testID="report-submit" busy={busy} disabled={!reason} onPress={() => void submit()} />
              <Btn label="Vazgeç" ghost disabled={busy} onPress={close} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useCmStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    wrap: { marginTop: 18, padding: 16, borderRadius: 18, backgroundColor: W.paper, borderWidth: 1, borderColor: W.line, gap: 14 },
    h: { fontFamily: F.serifBold, fontSize: 19, color: W.ink },
    node: { gap: 10 },
    highlight: { backgroundColor: W.cream, borderRadius: 12, padding: 8, marginHorizontal: -8, borderLeftWidth: 3, borderLeftColor: W.gold },
    row: { flexDirection: 'row', gap: 10 },
    ghostAvatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
    name: { fontFamily: F.semi, fontSize: 13.5, color: W.ink },
    meta: { fontFamily: F.body, fontSize: 11.5, color: W.muted },
    body: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: W.ink },
    deleted: { fontFamily: F.body, fontSize: 13, fontStyle: 'italic', color: W.muted, paddingTop: 6 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 4 },
    act: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
    actText: { fontFamily: F.semi, fontSize: 12, color: W.muted },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 26, borderRadius: 13, borderWidth: 1, borderColor: W.line, backgroundColor: W.paper },
    pillText: { fontFamily: F.semi, fontSize: 11.5, color: W.muted },
    indent: { marginLeft: 14, paddingLeft: 12, borderLeftWidth: 1.5, borderLeftColor: W.line, marginTop: 10 },
    inlineErr: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    retry: { fontFamily: F.semi, fontSize: 12.5, color: W.ink, textDecorationLine: 'underline' },
    focus: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: W.gold, gap: 10 },
    focusHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    focusTitle: { fontFamily: F.semi, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: W.ink },
    emptyBox: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: W.cream },
    empty: { flex: 1, fontFamily: F.body, fontSize: 13, lineHeight: 19, color: W.muted },
    err: { fontFamily: F.med, fontSize: 13, color: W.danger },
    input: { minHeight: 70, fontFamily: F.body, fontSize: 14, color: W.ink, backgroundColor: W.cream, borderRadius: 12, padding: 12, textAlignVertical: 'top' },
    inputSmall: { minHeight: 54 },
    backdrop: { flex: 1, backgroundColor: 'rgba(62,42,26,0.42)', justifyContent: 'flex-end' },
    sheet: { maxHeight: '88%', backgroundColor: W.paper, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: Platform.OS === 'web' ? 34 : 20 },
    reason: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: W.line },
    quote: { fontFamily: F.body, fontStyle: 'italic', fontSize: 13.5, lineHeight: 20, color: W.ink, borderLeftWidth: 3, borderLeftColor: W.gold, paddingLeft: 10 },
  });
});
