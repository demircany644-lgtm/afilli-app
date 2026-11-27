import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetGifLibrary, getGetGifLibraryQueryKey, type MessageGif } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { useTheme } from '@/hooks/useTheme';
import { F, tap } from '@/components/ui';
import { apiError } from '@/components/bulletins/common';
import { actorRequest, scoped } from './hooks';
import { LibraryGifImage } from './LibraryGifImage';

export function SharedGifPicker({ onPick, onClose }: { onPick: (gif: MessageGif, query: string) => void; onClose: () => void }) {
  const { magazine: P } = useTheme(), { userId } = useCommunity();
  const [offset, setOffset] = useState(0);
  const params = { offset };
  const list = useGetGifLibrary(params, { request: actorRequest(userId), query: {
    queryKey: scoped(getGetGifLibraryQueryKey(params), userId), enabled: !!userId, staleTime: 0, refetchOnMount: 'always',
  } });
  const { width } = useWindowDimensions(), cols = width < 380 ? 2 : 3;
  const cell = Math.floor((Math.min(width, 640) - 40 - (cols - 1) * 6) / cols);
  const button = { minHeight: 44, minWidth: 44, justifyContent: 'center' as const, paddingHorizontal: 8 };
  return <View style={{ gap: 8, padding: 14 }} testID="shared-gif-picker">
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ flex: 1, color: P.text, fontFamily: F.semi, fontSize: 14 }}>Afilli GIF’leri</Text>
      <Pressable style={button} accessibilityRole="button" accessibilityLabel="GIF seçiciyi kapat" testID="shared-gif-close" onPress={onClose}><Feather name="x" size={20} color={P.text} /></Pressable>
    </View>
    {list.isLoading ? <ActivityIndicator color={P.gold} /> : list.isError ? (
      <Pressable style={button} accessibilityRole="button" testID="shared-gif-list-retry" onPress={() => void list.refetch()}>
        <Text style={{ color: P.danger, fontFamily: F.body }}>{apiError(list.error, 'GIF’ler yüklenemedi.')} · Tekrar dene</Text>
      </Pressable>
    ) : <FlatList data={list.data?.items ?? []} key={cols} numColumns={cols} keyExtractor={g => g.id}
      style={{ maxHeight: 260 }} initialNumToRender={6} maxToRenderPerBatch={3} windowSize={3}
      columnWrapperStyle={{ gap: 6 }} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<Text style={{ color: P.muted, fontFamily: F.body }}>Henüz ortak GIF eklenmedi.</Text>}
      renderItem={({ item }) => <Pressable testID={'shared-gif-result-' + item.id} accessibilityRole="button" accessibilityLabel={'GIF seç: ' + item.title}
        onPress={() => { tap(); onPick(item, ''); }}><LibraryGifImage id={item.id} width={cell} height={cell} label={item.title} /></Pressable>} />}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable testID="shared-gif-prev" accessibilityRole="button" accessibilityState={{ disabled: offset === 0 || list.isFetching }} disabled={offset === 0 || list.isFetching}
        style={button} onPress={() => setOffset(o => Math.max(0, o - 12))}><Text style={{ color: offset ? P.text : P.muted, fontFamily: F.body }}>Önceki</Text></Pressable>
      <Text style={{ color: P.muted, fontFamily: F.body }}>Sayfa {offset / 12 + 1}</Text>
      <Pressable testID="shared-gif-next" accessibilityRole="button" accessibilityState={{ disabled: list.data?.nextOffset == null || list.isFetching }}
        disabled={list.data?.nextOffset == null || list.isFetching} style={button}
        onPress={() => { if (list.data?.nextOffset != null) setOffset(list.data.nextOffset); }}><Text style={{ color: list.data?.nextOffset != null ? P.text : P.muted, fontFamily: F.body }}>Sonraki</Text></Pressable>
    </View>
  </View>;
}
