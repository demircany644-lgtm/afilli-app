import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetBookCards, getGetBookCardsQueryKey } from '@workspace/api-client-react';
import { makeStyles } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { Btn } from '@/components/bulletins/common';
import { useCommunity } from '@/context/CommunityContext';
import { actorRequest, scoped } from '@/components/profile/hooks';
import { useWriterPalette, writerPalette, Skeleton } from '@/components/writer/parts';
import { BookResultRow } from '@/components/discovery/parts';
import { useSavedBookSetter } from '@/lib/book-subscriptions';

const CHUNK = 30;
const PAGE_CHUNKS = 1;

/** Saved real-book UUIDs resolved to lightweight cards, 30 at a time. Never erases a saved id on its own. */
export function SavedBooks({ ids }: { ids: string[] }) {
  const st = useStyles();
  const [pages, setPages] = useState(PAGE_CHUNKS);
  const saver = useSavedBookSetter();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const shown = chunks.slice(0, pages);
  return (
    <View>
      {shown.map((c) => <Chunk key={c.join(',')} ids={c} saver={saver} />)}
      {chunks.length > pages ? (
        <Pressable testID="library-saved-more" accessibilityRole="button" onPress={() => { tap(); setPages((p) => p + 1); }} style={st.more}>
          <Text style={st.moreText}>Daha fazla kayıtlı kitap ({ids.length - pages * CHUNK})</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Chunk({ ids, saver }: { ids: string[]; saver: ReturnType<typeof useSavedBookSetter> }) {
  const W = useWriterPalette();
  const st = useStyles();
  const { ready, userId } = useCommunity();
  const params = { ids: ids.join(',') };
  const q = useGetBookCards(params, { query: { enabled: ready, queryKey: scoped(getGetBookCardsQueryKey(params), userId) }, request: actorRequest(userId) });
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!ready || q.isLoading) return <View style={{ padding: 16, gap: 10 }}>{ids.slice(0, 2).map((i) => <Skeleton key={i} h={96} />)}</View>;
  if (q.isError) return (
    <View style={st.warn} testID="library-saved-error">
      <Feather name="cloud-off" size={18} color={W.danger} />
      <Text style={st.warnText}>{ids.length} kayıtlı kitabın bilgisi alınamadı. Kayıtların duruyor.</Text>
      <Btn label="Tekrar dene" ghost testID="library-saved-retry" onPress={() => void q.refetch()} />
    </View>
  );
  const byId = new Map((q.data ?? []).map((c) => [c.id, c]));
  return (
    <View>
      {ids.map((id) => {
        const card = byId.get(id);
        const removeUi = confirm === id ? (
          <View style={st.confirm}>
            <Text style={st.note}>Kayıt kaldırılır ve bu kitabın yeni bölüm bildirimleri durur.</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn label="Vazgeç" ghost testID={'library-saved-cancel-' + id} onPress={() => setConfirm(null)} />
              <Btn label="Kaldır" busy={saver.busyId === id} disabled={!!saver.busyId && saver.busyId !== id} testID={'library-saved-confirm-' + id} onPress={() => { void saver.set(id, false).then((ok) => { if (ok) setConfirm(null); }); }} />
            </View>
          </View>
        ) : (
          <Pressable testID={'library-remove-' + id} accessibilityRole="button" accessibilityLabel={(card?.title ?? 'Kitap') + ', kaydı kaldır'} onPress={() => setConfirm(id)} style={st.remove}>
            <Feather name="bookmark" size={14} color={W.muted} /><Text style={st.removeText}>Kaydı kaldır</Text>
          </Pressable>
        );
        return (
          <View key={id}>
            {card ? <BookResultRow card={card} testID={'library-' + id} /> : (
              <View style={st.gone} testID={'library-unavailable-' + id} accessible accessibilityLabel="Kayıtlı kitap şu anda erişilebilir değil">
                <Feather name="eye-off" size={20} color={W.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={st.goneTitle}>Bu kitap şu anda erişilebilir değil</Text>
                  <Text style={st.note}>Yazar yayından kaldırmış, gizlenmiş ya da silinmiş olabilir. Kaydın sen kaldırana kadar korunur.</Text>
                </View>
              </View>
            )}
            {removeUi}
            {saver.error?.id === id ? <Text style={st.note} accessibilityLiveRegion="polite" testID={'library-saved-error-' + id}>{saver.error.message}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const W = writerPalette(t);
  return StyleSheet.create({
    more: { alignSelf: 'center', padding: 12 },
    moreText: { fontFamily: F.med, fontSize: 13.5, color: W.ink, textDecorationLine: 'underline' },
    warn: { margin: 16, padding: 14, gap: 8, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: W.border },
    warnText: { fontFamily: F.body, fontSize: 13, color: W.ink, textAlign: 'center' },
    gone: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 18, marginBottom: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: W.border },
    goneTitle: { fontFamily: F.semi, fontSize: 14, color: W.ink, marginBottom: 2 },
    note: { fontFamily: F.body, fontSize: 12.5, color: W.muted },
    remove: { alignSelf: 'flex-end', marginRight: 22, marginBottom: 12, marginTop: -6, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
    removeText: { fontFamily: F.body, fontSize: 12, color: W.muted },
    confirm: { marginHorizontal: 20, marginBottom: 16, gap: 10, alignItems: 'center' },
  });
});
