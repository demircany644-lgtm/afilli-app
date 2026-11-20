import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { DirectMessage, MessageGif, MessageQuote } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { useDirectMessages } from '@/context/DirectMessagesContext';
import { useDirectThread } from '@/lib/useDirectThread';
import { F, tap } from '@/components/ui';
import { Avatar } from '@/components/bulletins/common';
import { MarbleBackground, Notice, Skeleton, StateCard, StatusLine, TopBar } from '@/components/profile/kit';
import { useOptionalAppearance } from '@/context/AppearanceContext';
import { ChatComposer } from '@/components/profile/ChatComposer';
import { GifMessage } from '@/components/profile/GifMessage';
import { PhotoMessage, LocalPhotoPreview } from '@/components/profile/PhotoMessage';
import { go, useIdentityKey } from '@/components/profile/hooks';

type Pending = ReturnType<typeof useDirectThread>['pending'][number];
type Item = { kind: 'server'; m: DirectMessage } | { kind: 'pending'; p: Pending };

export default function ChatRoute() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = typeof raw === 'string' ? raw : '';
  const key = useIdentityKey(id);
  return <Chat key={key} id={id} />;
}

function Quote({ q, mine, peerId }: { q: Pick<MessageQuote, 'available' | 'sender' | 'body' | 'gif' | 'photo' | 'mediaExpired'>; mine: boolean; peerId?: string }) {
  const st = useStStyles();
  const who = q.sender ? (q.sender.id === peerId ? q.sender.nickname : 'Sen') : null;
  return (
    <View style={[st.quote, mine ? st.quoteMine : st.quoteTheirs]}>
      {!q.available ? <Text style={[st.quoteBody, mine && st.onMine, { fontStyle: 'italic' }]}>Bu mesaj artık görüntülenemiyor.</Text> : (<>
        {who ? <Text style={[st.quoteWho, mine && st.onMine]} numberOfLines={1}>{who}</Text> : null}
        <Text style={[st.quoteBody, mine && st.onMine]} numberOfLines={2}>{q.body || (q.mediaExpired ? 'Bu medya süresi dolduğu için silindi' : q.photo ? 'Fotoğraf' : q.gif ? 'GIF' + (q.gif.title ? ': ' + q.gif.title : '') : '')}</Text>
      </>)}
    </View>
  );
}

function Chat({ id }: { id: string }) {
  const { magazine: P, social: S } = useTheme();
  const st = useStStyles();
  const lavaOn = !!useOptionalAppearance()?.isLava;
  const { ready, userId } = useCommunity();
  const { connection, mediaCleanupError } = useDirectMessages();
  const t = useDirectThread(id);
  const { conv, messages, pending } = t;
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const peer = conv.data?.peer;
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const [mediaTick, setMediaTick] = useState(0);
  useEffect(() => {
    const next = messages.map(m => m.mediaExpiresAt ? Date.parse(m.mediaExpiresAt) : NaN).filter(at => at > Date.now()).sort((a, b) => a - b)[0];
    if (!next) return;
    const timer = setTimeout(() => setMediaTick(n => n + 1), Math.min(2147483647, Math.max(1, next - Date.now())));
    return () => clearTimeout(timer);
  }, [messages, mediaTick]);
  const mediaExpired = (m: DirectMessage) => !!m.mediaExpired || !!m.mediaExpiresAt && Date.parse(m.mediaExpiresAt) <= Date.now();
  const confirmDelete = (m: DirectMessage) => {
    if (m.sender.id !== userId || m.deletedAt) return;
    const remove = () => { void t.deleteMessage(m); };
    const explanation = 'Mesaj her iki taraftan silinecek. Bu işlem geri alınamaz.';
    if (Platform.OS === 'web') { if (window.confirm(explanation)) remove(); }
    else Alert.alert('Mesaj silinsin mi?', explanation, [{ text: 'Vazgeç', style: 'cancel' }, { text: 'Sil', style: 'destructive', onPress: remove }]);
  };

  const data: Item[] = [...pending.map((p) => ({ kind: 'pending' as const, p })), ...messages.map((m) => ({ kind: 'server' as const, m }))];
  const lastMine = messages.find((m) => peer && m.sender.id !== peer.id);
  const status = (conv.error as { status?: number } | null)?.status;
  const localQuote = (rid?: string | null): MessageQuote | null => {
    if (!rid) return null;
    const m = byId.get(rid);
    return m && !m.deletedAt ? { id: m.id, available: true, sender: m.sender, body: m.body,
      gif: mediaExpired(m) ? null : m.gif, photo: mediaExpired(m) ? null : m.photo, mediaExpired: mediaExpired(m) }
      : { id: rid, available: false, sender: null, body: null, gif: null };
  };

  let body: React.ReactNode;
  if (!ready || (userId && (conv.isLoading || t.loading))) body = <View style={{ padding: 18, gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} w={i % 2 ? '60%' : '72%'} h={48} r={18} style={{ alignSelf: i % 2 ? 'flex-end' : 'flex-start' }} />)}</View>;
  else if (!userId) body = <StateCard icon="lock" title="Sohbet için giriş yap" text="Mesajlar yalnızca sohbetin iki tarafına görünür." action={{ label: 'Giriş yap', testID: 'chat-signin', onPress: () => go('/sign-in') }} />;
  else if (status === 403 || status === 404) body = <StateCard testID="chat-forbidden" icon="lock" title="Bu sohbete erişimin yok" text="Sohbet yalnızca katılımcılarına açıktır." action={{ label: 'Mesajlara dön', testID: 'chat-back-messages', onPress: () => go('/messages') }} />;
  else if (!conv.data) body = <StateCard testID="chat-error" icon="wifi-off" title="Sohbet açılamadı" text="İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', testID: 'chat-retry', onPress: () => { void conv.refetch(); t.retry(); } }} />;
  else body = (
    <>
      {t.error ? <Notice tone="error" text="Yeni mesajlar alınamıyor. İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', onPress: t.retry }} />
        : connection === 'reconnecting' || connection === 'offline' ? <Text testID="chat-connection" style={st.meta}>{connection === 'offline' ? 'Çevrimdışı; doğrulanamayan gönderimleri Tekrar dene ile gönderebilirsin.' : 'Yeniden bağlanılıyor...'}</Text> : null}
      {t.deleteError ? <Notice tone="error" testID="chat-delete-error" text={t.deleteError} /> : null}
      {mediaCleanupError ? <Text testID="chat-media-cleanup-status" style={st.meta}>{mediaCleanupError}</Text> : null}
      <FlatList
        testID="chat-list" inverted data={data} style={{ flex: 1 }}
        keyExtractor={(it) => it.kind === 'server' ? it.m.id : 'p-' + it.p.clientId}
        keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
        windowSize={5} initialNumToRender={12} maxToRenderPerBatch={6}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12, gap: 6 }}
        onEndReachedThreshold={0.3}
        onEndReached={() => { if (t.hasOlder && !t.loadingOlder) t.loadOlder(); }}
        ListFooterComponent={t.loadingOlder ? <Text style={st.meta}>Eski mesajlar yükleniyor...</Text> : !t.hasOlder && messages.length > 0 ? <Text style={st.meta}>Sohbetin başlangıcı</Text> : undefined}
        ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }] }}><StateCard icon="feather" title={`${peer?.nickname ?? ''} ile ilk mektubun`} text="Kibar bir merhaba her güzel yazışmanın başlangıcıdır." /></View>}
        renderItem={({ item }) => {
          if (item.kind === 'pending') {
            const p = item.p;
            const q = localQuote(p.replyToId);
            return (
              <View style={[st.bubble, st.mine, { opacity: p.status === 'sending' ? 0.7 : 1 }]}>
                {q ? <Quote q={q} mine peerId={peer?.id} /> : null}
                {p.gif ? <GifMessage gif={p.gif} /> : null}
                {p.photo && userId ? <LocalPhotoPreview owner={userId} photo={p.photo} /> : null}
                {p.body ? <Text style={st.mineText}>{p.body}</Text> : null}
                {p.status !== 'sending' ? (
                  <Pressable testID={'chat-retry-' + p.clientId} accessibilityRole="button" accessibilityLabel={p.replyUnavailable ? 'Alıntıyı kaldırarak gönder' : 'Tekrar gönder'} onPress={() => { tap(); if (p.replyUnavailable) void t.withoutReply(p); else t.deliver(p); }} style={st.retry}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={14} color={S.igYellow} />
                    <Text style={st.retryText}>{p.status === 'unconfirmed' ? 'Son gönderim doğrulanamadı' : p.error ?? 'Gönderilemedi'} · {p.replyUnavailable ? 'Alıntısız gönder' : 'Tekrar dene'}</Text>
                  </Pressable>
                ) : <Text style={st.mineMeta}>Gönderiliyor...</Text>}
              </View>
            );
          }
          const m = item.m; const mine = !!peer && m.sender.id !== peer.id;
          const time = new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
          return (
            <View style={[st.row, mine ? { justifyContent: 'flex-end' } : null]}>
              {mine && !m.deletedAt ? <ReplyBtn m={m} onReply={setReplyTo} /> : null}
              <View testID={'chat-message-' + m.id} style={[st.bubble, mine ? st.mine : st.theirs]}>
                {m.deletedAt ? <Text testID={'chat-deleted-' + m.id} style={[mine ? st.mineText : st.theirText, { fontStyle: 'italic', opacity: 0.8 }]}>Bu mesaj silindi</Text> : <>
                  {m.reply ? <Quote q={m.reply} mine={mine} peerId={peer?.id} /> : null}
                  {mediaExpired(m) ? <Text testID={'chat-expired-' + m.id} style={[mine ? st.mineText : st.theirText, { fontStyle: 'italic', opacity: 0.8 }]}>Bu medya süresi dolduğu için silindi</Text> : <>
                    {m.gif ? <GifMessage gif={m.gif} /> : null}
                    {m.photo ? <PhotoMessage key={m.photo.id} photo={m.photo} expiresAt={m.mediaExpiresAt} /> : null}
                  </>}
                  {m.body ? <Text style={mine ? st.mineText : st.theirText}>{m.body}</Text> : null}
                </>}
                <View style={st.metaRow}>
                  <Text style={mine ? st.mineMeta : st.theirMeta}>{time}</Text>
                  {mine ? <MaterialCommunityIcons name={m.readAt ? 'check-all' : 'check'} size={14} color={m.readAt ? S.foilLight : S.bubbleMineText} accessibilityLabel={m.readAt ? 'Okundu' : 'İletildi'} /> : null}
                  {mine && !m.deletedAt ? <Pressable testID={'chat-delete-' + m.id} accessibilityRole="button" accessibilityLabel="Mesajı herkesten sil"
                    hitSlop={8} onPress={() => confirmDelete(m)} style={{ minWidth: 30, minHeight: 28, alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="trash-2" size={14} color={S.bubbleMineText} />
                  </Pressable> : null}
                </View>
                {mine && lastMine?.id === m.id ? <Text testID="chat-read-status" style={st.mineMeta}>{m.readAt ? 'Okundu' : 'İletildi'}</Text> : null}
              </View>
              {!mine && !m.deletedAt ? <ReplyBtn m={m} onReply={setReplyTo} /> : null}
            </View>
          );
        }}
      />
      {conv.data.peerTyping ? <Text testID="chat-typing" style={[st.meta, { color: S.typing, textAlign: 'left', paddingHorizontal: 18 }]}>{peer?.nickname} yazıyor...</Text> : null}
      {t.outboxErr ? <Notice tone="error" testID="chat-outbox-error" text="Bekleyen gönderimlerin okunamadı; silinmedi." action={{ label: 'Tekrar dene', onPress: t.reloadOutbox }} /> : null}
      <ChatComposer userId={userId} threadId={id} onQueued={t.deliver} replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
        findMessage={(mid) => byId.get(mid)} peerName={peer?.nickname} />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
        <TopBar back title="" backFallback="/messages" right={ready && peer && conv.data ? (
          <Pressable testID="chat-peer" accessibilityRole="link" accessibilityLabel={peer.nickname + ' profilini aç'} onPress={() => go('/people/' + peer.id)} style={[st.peer, lavaOn && st.peerLava]}>
            <Avatar person={peer} size={38} />
            <View style={{ flexShrink: 1 }}>
              <Text style={st.peerName} numberOfLines={1}>{peer.nickname}</Text>
              <StatusLine presence={{ online: conv.data.peerOnline, typing: conv.data.peerTyping, lastSeen: conv.data.peerLastSeen }} />
            </View>
          </Pressable>
        ) : null} />
        {body}
      </KeyboardAvoidingView>
    </View>
  );
}

function ReplyBtn({ m, onReply }: { m: DirectMessage; onReply: (m: DirectMessage) => void }) {
  const { magazine: P } = useTheme();
  return (
    <Pressable testID={'chat-reply-' + m.id} accessibilityRole="button" accessibilityLabel="Bu mesaja yanıt ver" hitSlop={6}
      onPress={() => { tap(); onReply(m); }} style={({ pressed }) => ({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.4 : 0.7 })}>
      <Feather name="corner-up-left" size={15} color={P.muted} />
    </Pressable>
  );
}

const useStStyles = makeStyles((t) => {
  const { magazine: P, social: S } = t;
  return StyleSheet.create({
  peerLava: { backgroundColor: P.card, borderRadius: 24, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: P.border },
  peer: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 260 },
  peerName: { fontFamily: F.serifBold, fontSize: 17, color: P.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, gap: 5 },
  mine: { alignSelf: 'flex-end', backgroundColor: S.bubbleMine, borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: P.card, borderWidth: 1, borderColor: P.border, borderBottomLeftRadius: 6 },
  quote: { borderLeftWidth: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, gap: 1 },
  quoteMine: { borderLeftColor: S.foilLight, backgroundColor: 'rgba(255,248,236,0.1)' },
  quoteTheirs: { borderLeftColor: S.foilMid, backgroundColor: P.background },
  quoteWho: { fontFamily: F.semi, fontSize: 11, color: S.foilDeep },
  quoteBody: { fontFamily: F.body, fontSize: 12, lineHeight: 16, color: P.muted },
  onMine: { color: S.bubbleMineText, opacity: 0.85 },
  mineText: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: S.bubbleMineText },
  theirText: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: P.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  mineMeta: { fontFamily: F.body, fontSize: 11, color: S.bubbleMineText, opacity: 0.8, alignSelf: 'flex-end' },
  theirMeta: { fontFamily: F.body, fontSize: 11, color: P.muted },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  retryText: { fontFamily: F.semi, fontSize: 12, color: S.igYellow },
  meta: { fontFamily: F.body, fontSize: 12, color: P.muted, textAlign: 'center', paddingVertical: 8 },
  });
});
