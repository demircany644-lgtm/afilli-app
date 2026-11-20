import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useCommunity } from '@/context/CommunityContext';
import { migrateSavedBooks, useMigrationStatus } from '@/lib/book-subscriptions';
import { useWriterPalette } from '@/components/writer/parts';
import { F, tap } from '@/components/ui';

/** Runs the one-time saved-book subscription merge for the verified owner once local data is ready. */
export function SavedBookSync() {
  const W = useWriterPalette();
  const app = useApp();
  const { ready, userId } = useCommunity();
  const status = useMigrationStatus(userId);
  const savedRef = useRef(app.saved); savedRef.current = app.saved;
  const canRun = ready && !!userId && app.ready;
  useEffect(() => {
    if (!canRun || !userId) return;
    void migrateSavedBooks(userId, savedRef.current).catch(() => undefined);
  }, [canRun, userId]);
  if (!userId || !status.error) return null;
  return (
    <View testID="saved-sync-error" accessibilityLiveRegion="polite" style={[s.bar, { backgroundColor: W.paper, borderColor: W.danger }]}>
      <Feather name="bell-off" size={15} color={W.danger} />
      <Text style={[s.text, { color: W.ink }]}>{status.error}</Text>
      <Pressable testID="saved-sync-retry" accessibilityRole="button" hitSlop={8} disabled={status.running}
        onPress={() => { tap(); void migrateSavedBooks(userId, savedRef.current).catch(() => undefined); }}>
        <Text style={[s.retry, { color: W.ink, opacity: status.running ? 0.5 : 1 }]}>{status.running ? 'Deneniyor' : 'Tekrar dene'}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
  text: { flex: 1, fontFamily: F.med, fontSize: 12.5, lineHeight: 17 },
  retry: { fontFamily: F.semi, fontSize: 12.5, textDecorationLine: 'underline' },
});
