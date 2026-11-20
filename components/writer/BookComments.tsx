import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { makeStyles } from '@/hooks/useTheme';
import { useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import {
  getBookCommentThreads, getGetBookCommentThreadsQueryKey, getWriterCommentReplies, getGetWriterCommentRepliesQueryKey,
  useGetWriterCommentPath, getGetWriterCommentPathQueryKey, addAuthoredBookComment, setWriterCommentReaction,
  type WriterComment, type WriterCommentPage,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Avatar, Btn, apiError, goSignIn } from '@/components/bulletins/common';
import { scoped, actorRequest, useOwnerGuard } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { useWriterPalette, writerPalette, Skeleton } from '@/components/writer/parts';

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

const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function BookComments({ bookId, chapterId, chapterTitle, onCount, focusId }: { bookId: string; chapterId: string | null; chapterTitle: string | null; onCount: () => void; focusId?: string | null }) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  const { userId, ready } = useCommunity();
  const q = useInfiniteQuery({
    queryKey: scoped([...getGetBookCommentThreadsQueryKey(bookId), 'pages'] as const, userId),
    queryFn: ({ pageParam, signal }) => getBookCommentThreads(bookId, pageParam ? { cursor: pageParam } : undefined, { signal, ...actorRequest(userId) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: WriterCommentPage) => last.nextCursor,
    enabled: ready && !!bookId,
  });
  const roots = q.data?.pages.flatMap((p) => p.items) ?? [];
  const denied = q.isError && accessDenied(q.error);
  return (
    <View style={cm.wrap} testID="book-comments">
      {focusId ? <FocusedThread focusId={focusId} bookId={bookId} onCount={onCount} /> : null}
      <Text style={cm.h} accessibilityRole="header">Tartışma</Text>
      {denied ? null : userId ? (
        <Composer bookId={bookId} parent={null} chapterId={chapterId} onCount={onCount}
          placeholder={chapterTitle ? chapterTitle + ' hakkında ne düşündün?' : 'Ne düşündün?'} testID="comment" />
      ) : <Btn label="Yorum yazmak için giriş yap" ghost onPress={goSignIn} />}
      {denied ? <Text style={cm.err}>Bu kitabın yorumları artık görüntülenemiyor.</Text> : q.isLoading ? <View style={{ gap: 10 }}><Skeleton h={64} /><Skeleton h={64} /></View> : q.isError && roots.length === 0 ? (
        <View style={{ gap: 8 }}><Text style={cm.err}>{apiError(q.error, 'Yorumlar yüklenemedi.')}</Text><Btn label="Tekrar dene" ghost onPress={() => void q.refetch()} /></View>
      ) : roots.length === 0 ? (
        <View style={cm.emptyBox}>
          <Feather name="message-circle" size={20} color={W.gold} />
          <Text style={cm.empty}>Bu kitapta henüz konuşma yok. İlk satırı sen yaz; yazar okurlarını duymayı sever.</Text>
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          {roots.map((c) => <CommentNode key={c.id} c={c} depth={0} bookId={bookId} onCount={onCount} />)}
          {q.isError ? <Text style={cm.err}>{apiError(q.error, 'Yorumlar yenilenemedi. Gördüklerin duruyor.')}</Text> : null}
          {q.hasNextPage ? <Btn label={q.isFetchingNextPage ? 'Yükleniyor' : 'Daha eski yorumlar'} ghost busy={q.isFetchingNextPage} testID="comments-more" onPress={() => void q.fetchNextPage()} /> : null}
        </View>
      )}
    </View>
  );
}

/** Notification target: real ancestors root-to-target from the path endpoint, shown as its own labelled discussion. */
function FocusedThread({ focusId, bookId, onCount }: { focusId: string; bookId: string; onCount: () => void }) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  const { userId, ready } = useCommunity();
  const q = useGetWriterCommentPath(focusId, { query: { enabled: ready && !!focusId, queryKey: scoped(getGetWriterCommentPathQueryKey(focusId), userId) }, request: actorRequest(userId) });
  const missing = accessDenied(q.error) || !!q.data?.some(c => c.bookId !== bookId);
  return (
    <View style={cm.focus} testID="focused-thread">
      <View style={cm.focusHead}><Feather name="bell" size={14} color={W.gold} /><Text style={cm.focusTitle}>Bildirimdeki tartışma</Text></View>
      {q.isLoading ? <Skeleton h={70} /> : missing ? <Text style={cm.empty}>Bu yorum artık görüntülenemiyor. Kaldırılmış ya da gizlenmiş olabilir.</Text>
        : q.isError && !q.data?.length ? (
          <View style={{ gap: 8 }}><Text style={cm.err}>{apiError(q.error, 'Bildirimdeki yorum yüklenemedi.')}</Text><Btn label="Tekrar dene" ghost onPress={() => void q.refetch()} /></View>
      ) : (
        <View>
          {(q.data ?? []).map((c, i) => (
            <View key={c.id} style={i > 0 ? [cm.indent, { marginLeft: i < MAX_INDENT ? 0 : -14 }] : null}>
              <CommentNode c={c} depth={i} bookId={bookId} onCount={onCount} highlight={c.id === focusId} />
            </View>
          ))}
          {q.isError ? <Text style={cm.err}>Konuşma yenilenemedi. Önceki yorumlar korunuyor.</Text> : null}
        </View>
      )}
    </View>
  );
}

function CommentNode({ c, depth, bookId, onCount, highlight, expandable = true }: { c: WriterComment; depth: number; bookId: string; onCount: () => void; highlight?: boolean; expandable?: boolean }) {
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
  const lastWanted = useRef<Reaction | null>(null);
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
      setView(res);
      void invalidateDiscussion(qc, bookId, userId);
    } catch (e) { if (guard()) setRErr(apiError(e, 'Tepkin kaydedilemedi.')); }
    finally { reacting.current = false; if (guard()) setRBusy(false); }
  };
  const toggle = (r: Reaction) => { tap(); void sendReaction(selected === r ? null : r); };
  const showToggle = expandable && (view.replyCount > 0 || open);

  return (
    <View testID={'comment-' + view.id} style={[cm.node, highlight && cm.highlight]}>
      <View style={cm.row}>
        {view.deleted ? <View style={[cm.ghostAvatar, { borderColor: W.line }]}><Feather name="slash" size={13} color={W.muted} /></View> : <Avatar person={view.author} size={30} />}
        <View style={{ flex: 1, gap: 3 }}>
          {view.deleted ? (
            <Text style={cm.deleted}>Bu yorum silindi. Altındaki yanıtlar korunuyor.</Text>
          ) : <>
            <Text style={cm.name}>{view.author.nickname} <Text style={cm.meta}>· {when(view.createdAt)}</Text></Text>
            <Text style={cm.body} selectable>{view.body}</Text>
          </>}
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
          </View>
          {rErr ? (
            <View style={cm.inlineErr}>
              <Text style={cm.err}>{rErr}</Text>
              <Pressable accessibilityRole="button" hitSlop={6} onPress={() => void sendReaction(lastWanted.current)}><Text style={cm.retry}>Tekrar dene</Text></Pressable>
            </View>
          ) : null}
        </View>
      </View>
      {replying && !view.deleted ? (
        <View style={cm.indent}>
          <Composer bookId={bookId} parent={view} chapterId={view.chapterId} onCount={onCount} autoFocus testID={'reply-' + view.id}
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
  const { userId, ready } = useCommunity();
  const q = useInfiniteQuery({
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
function Composer({ bookId, parent, chapterId, placeholder, onCount, onPosted, autoFocus, testID }: {
  bookId: string; parent: WriterComment | null; chapterId: string | null; placeholder: string; onCount: () => void; onPosted?: (keepDraft: boolean) => void; autoFocus?: boolean; testID: string;
}) {
  const cm = useCmStyles();
  const W = useWriterPalette();
  const { userId } = useCommunity();
  const guard = useOwnerGuard(userId);
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const latestBody = useRef(body); latestBody.current = body;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = useRef<{ clientId: string; body: string; chapterId: string | null; parentId: string | null } | null>(null);
  const sending = useRef(false);
  const onPostedRef = useRef(onPosted); onPostedRef.current = onPosted;
  const send = async () => {
    if ((!body.trim() && !pending.current) || !userId || sending.current) return;
    // Replies carry the parent's chapter, never the reader's current unrelated chapter.
    const input = pending.current ?? { clientId: randomUUID(), body: body.trim(), chapterId: parent ? parent.chapterId : chapterId, parentId: parent?.id ?? null };
    pending.current = input;
    sending.current = true;
    setBusy(true); setErr(null);
    try {
      await addAuthoredBookComment(bookId, input, actorRequest(userId));
      if (!guard()) return;
      pending.current = null;
      setBody((cur) => cur.trim() === input.body ? '' : cur);
      void invalidateDiscussion(qc, bookId, userId);
      onCount();
      // A new text typed while the previous reply was sending is a new draft,
      // not permission to close its composer and discard it.
      onPostedRef.current?.(latestBody.current.trim() !== input.body);
    } catch (e) { if (guard()) setErr(apiError(e, 'Yorum gönderilemedi. Metnin duruyor.')); }
    finally { sending.current = false; if (guard()) setBusy(false); }
  };
  return (
    <View style={{ gap: 8 }}>
      <TextInput testID={testID + '-input'} value={body} onChangeText={setBody} maxLength={3000} multiline autoFocus={autoFocus} placeholder={placeholder}
        placeholderTextColor={W.muted} style={[cm.input, parent && cm.inputSmall]} accessibilityLabel={parent ? 'Yanıt yaz' : 'Yorum yaz'} />
      {err ? <Text style={cm.err} accessibilityLiveRegion="polite">{err}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Btn label={err && pending.current ? 'Önceki metni tekrar gönder' : parent ? 'Yanıtla' : 'Gönder'} icon="send" testID={testID + '-send'} busy={busy}
          disabled={!body.trim() && !pending.current} onPress={() => void send()} />
        {err && pending.current ? <Btn label="Vazgeç" ghost onPress={() => { pending.current = null; setErr(null); }} /> : null}
      </View>
    </View>
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
    act: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 26 },
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
  });
});
