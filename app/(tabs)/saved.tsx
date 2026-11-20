import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  getBookNotifications, getGetBookNotificationsQueryKey, useGetBookNotifications, readBookNotification,
  type BookNotificationPage, type SocialNotification,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { TabTitle } from '@/components/TabTitle';
import { Empty, GoldButton } from '@/components/ui';
import { Btn, apiError, goSignIn } from '@/components/bulletins/common';
import { useCommunity } from '@/context/CommunityContext';
import { scoped, actorRequest, useOwnerGuard } from '@/components/profile/hooks';

const KIND: Record<SocialNotification['kind'], { icon: keyof typeof Feather.glyphMap; label: string }> = {
  chapter: { icon: 'book-open', label: 'Yeni bölüm' },
  book_comment: { icon: 'message-circle', label: 'Kitabına yorum' },
  comment_reply: { icon: 'corner-down-right', label: 'Yorumuna yanıt' },
};

export default function Notifications() {
  const c = useColors();
  const { ready, userId } = useCommunity();
  const qc = useQueryClient();
  const alive = useOwnerGuard(userId);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: scoped([...getGetBookNotificationsQueryKey(), 'pages'] as const, userId),
    queryFn: ({ pageParam, signal }) => getBookNotifications(pageParam ? { cursor: pageParam } : undefined, { signal, ...actorRequest(userId) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: BookNotificationPage) => last.nextCursor,
    enabled: ready && !!userId,
    refetchInterval: 15000,
  });
  // Canonical unread total shared with the bottom bar (same query key).
  const head = useGetBookNotifications(undefined, { query: { enabled: ready && !!userId, queryKey: scoped(getGetBookNotificationsQueryKey(), userId), refetchInterval: 15000 }, request: actorRequest(userId) });
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((n) => n.kind in KIND);
  const unread = head.data?.unreadCount ?? 0;

  const refresh = () => {
    const as = userId ?? 'guest';
    void qc.invalidateQueries({ predicate: (x) => {
      const k = x.queryKey; const last = k[k.length - 1] as { as?: string } | undefined;
      return k[0] === getGetBookNotificationsQueryKey()[0] && !!last && typeof last === 'object' && last.as === as;
    } });
  };
  const open = async (n: SocialNotification) => {
    setOpenErr(null);
    if (!n.bookId) return;
    const params: Record<string, string> = { id: n.bookId };
    if (n.commentId) params.focusComment = n.commentId;
    if (n.chapterId) params.chapter = n.chapterId;
    if (!n.read && userId) {
      try { await readBookNotification(n.id, actorRequest(userId)); if (alive()) refresh(); }
      catch (e) { if (alive()) setOpenErr(apiError(e, 'Bildirim okundu olarak işaretlenemedi.')); }
    }
    if (!alive()) return;
    router.push({ pathname: '/authored-book/[id]', params } as never);
  };
  const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <TabTitle title="Bildirimler" sub={unread > 0 ? unread + ' okunmamış kitap bildirimi' : 'Kitaplarından ve yorumlarından haberler'} />
        {openErr ? <Text style={[styles.err, { color: c.destructive }]}>{openErr}</Text> : null}
        {!ready ? null : !userId ? (
          <Empty icon="bell" title="Bildirimler hesabına bağlı" text="Kaydettiğin kitapların yeni bölümleri ve yorumlarına gelen yanıtlar burada görünür.">
            <GoldButton label="Giriş yap" testID="notifications-signin" onPress={goSignIn} style={{ marginTop: 8 }} />
          </Empty>
        ) : q.isLoading ? (
          <View style={{ gap: 12, marginHorizontal: 20 }}>{[0, 1, 2].map((i) => <View key={i} style={[styles.skel, { backgroundColor: c.secondary }]} />)}</View>
        ) : q.isError && items.length === 0 ? (
          <Empty icon="cloud-off" title="Bildirimler alınamadı" text={apiError(q.error, 'Bağlantını kontrol edip yeniden dene.')}>
            <GoldButton label="Tekrar dene" testID="notifications-retry" onPress={() => void q.refetch()} style={{ marginTop: 8 }} />
          </Empty>
        ) : items.length === 0 ? (
          <Empty icon="bell" title="Henüz bildirimin yok" text="Kaydettiğin bir kitaba yeni bölüm geldiğinde ya da yorumuna yanıt yazıldığında haber vereceğiz.">
            <GoldButton label="Ana sayfaya dön" testID="notifications-home" onPress={() => router.navigate('/')} style={{ marginTop: 8 }} />
          </Empty>
        ) : <>
          {items.map((n) => {
            const k = KIND[n.kind];
            return (
              <Pressable key={n.id} testID={'book-notification-' + n.id} accessibilityRole="button"
                accessibilityLabel={k.label + ', ' + n.body + (n.read ? ', okundu' : ', okunmadı')} onPress={() => void open(n)}
                style={({ pressed }) => [styles.notification, { backgroundColor: n.read ? c.paper : c.secondary, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}>
                <Feather name={k.icon} size={20} color={c.brown} />
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={{ color: c.brown, fontFamily: n.read ? 'Inter_500Medium' : 'Inter_700Bold', fontSize: 15 }}>{n.body}</Text>
                  <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13 }}>{k.label} · {when(n.createdAt)}</Text>
                </View>
                {!n.read && <View style={[styles.dot, { backgroundColor: c.destructive }]} />}
              </Pressable>
            );
          })}
          {q.isError ? <Text style={[styles.err, { color: c.destructive }]}>{apiError(q.error, 'Bildirimler yenilenemedi. Gördüklerin duruyor.')}</Text> : null}
          {q.hasNextPage ? <View style={{ marginHorizontal: 20 }}><Btn label="Daha eski bildirimler" ghost busy={q.isFetchingNextPage} testID="notifications-more" onPress={() => void q.fetchNextPage()} /></View> : null}
        </>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  notification: { marginHorizontal: 20, marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  skel: { height: 72, borderRadius: 16, opacity: 0.6 },
  err: { marginHorizontal: 20, marginBottom: 10, fontFamily: 'Inter_500Medium', fontSize: 13 },
});
