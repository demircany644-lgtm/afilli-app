import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { enqueueOutbox, readChatDraft, saveDraftContent, type OutboxEntry, type LocalChatPhoto } from '@/lib/chat-drafts';
import { chooseChatPhoto, queueChatPhotoCleanup, drainChatPhotoCleanup } from '@/lib/chat-photos';
import { useSetConversationTyping, type DirectMessage, type MessageGif } from '@workspace/api-client-react';
import { notifyGifShared } from '@/lib/klipy';
import { useGifPrivacy } from '@/context/DirectMessagesContext';
import { F, tap } from '@/components/ui';
import { GifPicker } from './GifPicker';
import { GifMessage } from './GifMessage';
import { LocalPhotoPreview } from './PhotoMessage';
import { actorRequest } from './hooks';

export const MAX_BODY = 4000;

type Props = {
  userId: string; threadId: string; onQueued: (e: OutboxEntry) => void; disabled?: boolean;
  /** Message chosen via the bubble reply action (null = none chosen this tick). */
  replyTo: DirectMessage | null;
  onCancelReply: () => void;
  /** Resolve a restored replyToId against the loaded transcript (may be undefined if not loaded/deleted). */
  findMessage: (id: string) => DirectMessage | undefined;
  peerName?: string;
  /** Safe-area bottom padding for the full-screen chat composer. */
  bottomInset?: number;
};

/**
 * Identity-bound composer. Text, reply target and chosen GIF autosave per owner+thread after strict hydration.
 * Send durably enqueues BEFORE clearing or calling the network.
 */
export function ChatComposer({ userId, threadId, onQueued, disabled, replyTo, onCancelReply, findMessage, peerName, bottomInset = 0 }: Props) {
  const { magazine: P, social: S } = useTheme();
  const st = useStStyles();
  const owner = userId;
  const { customerId, allowed } = useGifPrivacy();
  const allowedRef = useRef(allowed); allowedRef.current = allowed;
  const [body, setBody] = useState('');
  const bodyRef = useRef(''); bodyRef.current = body;
  const [replyId, setReplyId] = useState<string | null>(null);
  const replyRef = useRef<string | null>(null); replyRef.current = replyId;
  const [gif, setGif] = useState<MessageGif | null>(null);
  const gifRef = useRef<MessageGif | null>(null); gifRef.current = gif;
  const gifQuery = useRef('');
  const [photo, setPhoto] = useState<LocalChatPhoto | null>(null);
  const photoRef = useRef<LocalChatPhoto | null>(null); photoRef.current = photo;
  const abandoned = useRef<LocalChatPhoto[]>([]);
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const sendingRef = useRef(false);
  const queuePromise = useRef<Promise<unknown> | null>(null);
  const [panel, setPanel] = useState<'none' | 'gif'>('none');
  const [attempt, setAttempt] = useState(0);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const typing = useSetConversationTyping({ request: actorRequest(userId) });
  const typingRef = useRef(typing.mutate); typingRef.current = typing.mutate;
  const lastSent = useRef(0);
  const on = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const onQueuedRef = useRef(onQueued); onQueuedRef.current = onQueued;
  const onCancelRef = useRef(onCancelReply); onCancelRef.current = onCancelReply;

  useEffect(() => {
    let alive = true;
    setLoadErr(null);
    readChatDraft(owner, threadId).then(
      (d) => {
        if (!alive) return;
        setBody((cur) => cur || d.body);
        setReplyId((cur) => cur ?? d.replyToId ?? null);
        setGif((cur) => cur ?? d.gif ?? null);
        setPhoto((cur) => cur ?? d.photo ?? null);
        gifQuery.current = d.gifQuery ?? '';
        hydratedRef.current = true; setHydrated(true);
      },
      (e) => { if (alive) setLoadErr(e instanceof Error ? e.message : 'Taslak okunamadı.'); },
    );
    return () => { alive = false; };
  }, [owner, threadId, attempt]);

  const clearTimer = () => { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } };
  const snapshot = () => ({ body: bodyRef.current, replyToId: replyRef.current, gif: gifRef.current, gifQuery: gifQuery.current, photo: photoRef.current, photoId: null });
  const cleanupAbandoned = async () => {
    for (const old of [...abandoned.current]) {
      const saved = await readChatDraft(owner, threadId);
      if (saved.photo?.localId === old.localId || saved.outbox.some(item => item.photo?.localId === old.localId)) continue;
      await queueChatPhotoCleanup(owner, old);
      abandoned.current = abandoned.current.filter(item => item.localId !== old.localId);
    }
    await drainChatPhotoCleanup(owner);
  };
  const persist = () => {
    if (!hydratedRef.current) return;
    saveDraftContent(owner, threadId, snapshot()).then(
      () => { if (mounted.current) setSaveErr(null); void cleanupAbandoned().catch(() => {}); },
      () => { if (mounted.current) setSaveErr('Taslak cihaza kaydedilemedi.'); },
    );
  };
  const schedule = () => { clearTimer(); saveTimer.current = setTimeout(() => { saveTimer.current = null; persist(); }, 400); };

  // A reply chosen from a bubble replaces the current target and is persisted.
  useEffect(() => {
    if (!replyTo) return;
    setReplyId(replyTo.id); replyRef.current = replyTo.id;
    schedule();
    input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyTo?.id]);

  const stopTyping = () => {
    if (!on.current) return;
    on.current = false; lastSent.current = 0;
    typingRef.current({ id: threadId, data: { typing: false } });
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      if (hydratedRef.current) {
        const flush = () => saveDraftContent(owner, threadId, snapshot()).then(cleanupAbandoned).catch(() => {});
        // Wait for a concurrent durable enqueue to clear its captured refs before flushing.
        if (queuePromise.current) void queuePromise.current.then(flush, flush);
        else void flush();
      }
      if (on.current) { on.current = false; typingRef.current({ id: threadId, data: { typing: false } }); }
    };
  }, [threadId, owner]);

  const change = (t: string) => {
    const next = t.slice(0, MAX_BODY);
    setBody(next); bodyRef.current = next;
    schedule();
    const now = Date.now();
    if (next.trim() && now - lastSent.current > 2000) {
      lastSent.current = now; on.current = true;
      typingRef.current({ id: threadId, data: { typing: true } });
    } else if (!next.trim()) stopTyping();
  };
  const cancelReply = () => { setReplyId(null); replyRef.current = null; schedule(); onCancelRef.current(); };
  const pickGif = (g: MessageGif, q: string) => {
    if (sendingRef.current || pickingRef.current) return;
    if (photoRef.current) abandoned.current.push(photoRef.current);
    setPhoto(null); photoRef.current = null;
    setGif(g); gifRef.current = g; gifQuery.current = q; setPanel('none'); schedule();
  };
  const removeGif = () => { setGif(null); gifRef.current = null; gifQuery.current = ''; schedule(); };
  const removePhoto = () => {
    if (sendingRef.current || pickingRef.current) return;
    if (photoRef.current) abandoned.current.push(photoRef.current);
    setPhoto(null); photoRef.current = null; persist();
  };
  const pickPhoto = async () => {
    if (!hydratedRef.current || sendingRef.current || pickingRef.current) return;
    pickingRef.current = true; setPicking(true); setPanel('none'); setInfo(null);
    try {
      const selected = await chooseChatPhoto(owner);
      if (!selected) return;
      if (!mounted.current) { await queueChatPhotoCleanup(owner, selected); await drainChatPhotoCleanup(owner); return; }
      if (photoRef.current) abandoned.current.push(photoRef.current);
      setPhoto(selected); photoRef.current = selected;
      setGif(null); gifRef.current = null; gifQuery.current = '';
      persist();
    } catch (error) { if (mounted.current) setInfo(error instanceof Error ? error.message : 'Fotoğraf seçilemedi.'); }
    finally { pickingRef.current = false; if (mounted.current) setPicking(false); }
  };

  const send = async () => {
    if (sendingRef.current || pickingRef.current) return; // synchronous double-tap guard
    const raw = bodyRef.current; const rReply = replyRef.current; const rGif = gifRef.current;
    const rQuery = gifQuery.current;
    const rPhoto = photoRef.current;
    const text = raw.trim();
    if ((!text && !rGif && !rPhoto) || disabled || !hydratedRef.current) return;
    sendingRef.current = true;
    tap(); stopTyping(); clearTimer();
    const entry: OutboxEntry = { clientId: randomUUID(), body: text, replyToId: rReply, gif: rGif, photo: rPhoto };
    setQueueing(true);
    try {
      // Durable first; keep anything changed meanwhile, otherwise clear what was captured.
      const enqueue = enqueueOutbox(owner, threadId, entry,
        () => (bodyRef.current === raw ? '' : bodyRef.current),
        () => ({ replyToId: replyRef.current === rReply ? null : replyRef.current, gif: gifRef.current === rGif ? null : gifRef.current, gifQuery: gifRef.current === rGif ? '' : gifQuery.current,
          photo: photoRef.current === rPhoto ? null : photoRef.current, photoId: null }));
      // This continuation also runs after unmount, before the deferred owner-bound flush.
      queuePromise.current = enqueue.then(() => {
        if (bodyRef.current === raw) bodyRef.current = '';
        if (replyRef.current === rReply) replyRef.current = null;
        if (gifRef.current === rGif) { gifRef.current = null; gifQuery.current = ''; }
        if (photoRef.current === rPhoto) photoRef.current = null;
      });
      await queuePromise.current;
    } catch {
      sendingRef.current = false;
      if (mounted.current) { setQueueing(false); setSaveErr('Mesaj cihaza kaydedilemedi; gönderilmedi. İçeriğin duruyor, tekrar dene.'); }
      return;
    }
    sendingRef.current = false;
    queuePromise.current = null;
    if (!mounted.current) return;
    setQueueing(false); setSaveErr(null);
    setBody(bodyRef.current);
    setReplyId(replyRef.current);
    setGif(gifRef.current);
    setPhoto(photoRef.current);
    if (!replyRef.current && rReply) onCancelRef.current();
    onQueuedRef.current(entry);
    if (rGif?.provider === 'klipy' && customerId && allowedRef.current) {
      // Analytics only; the message itself is already durable and sending.
      notifyGifShared(rGif, rQuery, customerId).catch(() => { if (mounted.current) setInfo('GIF gönderiliyor; KLIPY paylaşım bildirimi iletilemedi.'); });
    }
    input.current?.focus();
  };
  const can = (!!body.trim() || !!gif || !!photo) && hydrated && !disabled && !queueing && !picking;
  const quoted = replyId ? findMessage(replyId) ?? (replyTo?.id === replyId ? replyTo : undefined) : undefined;

  return (
    <View>
      {loadErr ? (
        <Pressable testID="chat-draft-retry" accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)} style={st.err}>
          <Feather name="alert-triangle" size={14} color={P.danger} />
          <Text style={st.errText}>{loadErr} Kayıtlı taslağın korunuyor. Tekrar dene</Text>
        </Pressable>
      ) : saveErr ? (
        <Pressable testID="chat-draft-error" accessibilityRole="button" onPress={() => { setSaveErr(null); persist(); }} style={st.err}>
          <Feather name="alert-triangle" size={14} color={P.danger} />
          <Text style={st.errText}>{saveErr} Tekrar dene</Text>
        </Pressable>
      ) : info ? (
        <Pressable testID="chat-gif-info" accessibilityRole="button" onPress={() => setInfo(null)} style={st.err}>
          <Feather name="info" size={14} color={P.muted} />
          <Text style={[st.errText, { color: P.muted }]}>{info}</Text>
        </Pressable>
      ) : null}
      {replyId ? (
        <View style={st.attach} testID="chat-reply-preview">
          <View style={st.rule} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.attachTitle}>{quoted ? (quoted.sender.nickname === peerName ? peerName + ' adlı kişiye yanıt' : 'Kendi mesajına yanıt') : 'Yanıt'}</Text>
            <Text style={st.attachBody} numberOfLines={1}>{quoted?.deletedAt ? 'Bu mesaj silindi' : quoted ? (quoted.body || (quoted.mediaExpired ? 'Bu medya süresi dolduğu için silindi' : quoted.gif ? 'GIF' : quoted.photo ? 'Fotoğraf' : '')) : 'Alıntılanan mesaj şu an görünmüyor veya silinmiş.'}</Text>
          </View>
          <Pressable testID="chat-reply-cancel" accessibilityRole="button" accessibilityLabel="Yanıtı iptal et" onPress={cancelReply} hitSlop={8} style={st.x}>
            <Feather name="x" size={16} color={P.muted} />
          </Pressable>
        </View>
      ) : null}
      {photo ? (
        <View style={st.attach} testID="chat-photo-preview">
          <LocalPhotoPreview key={photo.localId} owner={owner} photo={photo} />
          <Text style={[st.attachBody, { flex: 1 }]}>Fotoğraf eklendi{'\n'}7 gün sonra silinir</Text>
          <Pressable testID="chat-photo-remove" accessibilityRole="button" accessibilityLabel="Fotoğrafı kaldır" onPress={removePhoto} disabled={queueing || picking} hitSlop={8} style={st.x}>
            <Feather name="x" size={16} color={P.muted} />
          </Pressable>
        </View>
      ) : null}
      {gif ? (
        <View style={st.attach} testID="chat-gif-preview">
          <GifMessage gif={gif} compact />
          <Text style={[st.attachBody, { flex: 1 }]} numberOfLines={2}>{gif.title || 'GIF'} eklendi</Text>
          <Pressable testID="chat-gif-remove" accessibilityRole="button" accessibilityLabel="GIF'i kaldır" onPress={removeGif} hitSlop={8} style={st.x}>
            <Feather name="x" size={16} color={P.muted} />
          </Pressable>
        </View>
      ) : null}
      {panel === 'gif' ? <GifPicker onPick={pickGif} onClose={() => setPanel('none')} /> : null}
      <View style={[st.wrap, { paddingBottom: 10 + bottomInset }]}>
        <View style={st.tools}>
          <Pressable testID="chat-photo-pick" accessibilityRole="button" accessibilityLabel="Galeriden fotoğraf seç" accessibilityState={{ disabled: picking || queueing || !hydrated }}
            disabled={picking || queueing || !hydrated} onPress={pickPhoto} style={st.tool}>
            <Feather name={picking ? 'loader' : 'image'} size={19} color={P.text} />
          </Pressable>
          <Pressable testID="chat-gif" accessibilityRole="button" accessibilityLabel="GIF seç" accessibilityState={{ selected: panel === 'gif' }}
            disabled={queueing || picking} onPress={() => { tap(); setPanel((p) => (p === 'gif' ? 'none' : 'gif')); }} style={[st.tool, panel === 'gif' && st.toolOn]}>
            <Text style={st.gifTxt}>GIF</Text>
          </Pressable>
        </View>
        <View style={st.box}>
          <TextInput ref={input} testID="chat-input" value={body} onChangeText={change} onBlur={stopTyping} editable={hydrated}
            onFocus={() => setPanel('none')}
            placeholder="Mesaj yaz..." placeholderTextColor={P.muted} multiline maxLength={MAX_BODY} style={st.input} accessibilityLabel="Mesaj" />
          {body.length > MAX_BODY - 300 ? <Text style={st.count}>{body.length}/{MAX_BODY}</Text> : null}
        </View>
        <Pressable testID="chat-send" accessibilityRole="button" accessibilityLabel="Gönder" accessibilityState={{ disabled: !can }} disabled={!can} onPress={send}
          style={({ pressed }) => [st.send, { opacity: can ? 1 : 0.45, transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
          <Feather name="send" size={19} color={S.bubbleMineText} />
        </Pressable>
      </View>
    </View>
  );
}

const useStStyles = makeStyles((t) => {
  const { magazine: P, social: S } = t;
  return StyleSheet.create({
    err: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, minHeight: 36 },
    errText: { flex: 1, fontFamily: F.semi, fontSize: 12, color: P.danger },
    attach: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border, backgroundColor: P.card },
    rule: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: S.foilMid },
    attachTitle: { fontFamily: F.semi, fontSize: 12, color: S.foilDeep },
    attachBody: { fontFamily: F.body, fontSize: 13, color: P.muted },
    x: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    wrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border, backgroundColor: P.background },
    tools: { flexDirection: 'row', gap: 2, paddingBottom: 3 },
    tool: { width: 38, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    toolOn: { backgroundColor: P.card, borderWidth: 1, borderColor: S.foilMid },
    gifTxt: { fontFamily: F.semi, fontSize: 12, letterSpacing: 0.6, color: P.text, borderWidth: 1.5, borderColor: P.text, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 },
    box: { flex: 1, minWidth: 0, borderRadius: 22, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, paddingHorizontal: 14, paddingVertical: 6 },
    input: { minHeight: 34, maxHeight: 130, fontFamily: F.body, fontSize: 15, color: P.text, paddingVertical: 6 },
    count: { alignSelf: 'flex-end', fontFamily: F.body, fontSize: 11, color: P.muted },
    send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: S.bubbleMine },
  });
});
