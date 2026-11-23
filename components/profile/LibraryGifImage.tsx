import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { fetch as expoFetch } from 'expo/fetch';
import { getLibraryGifMedia } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { useTheme } from '@/hooks/useTheme';
import { photoBlobUri } from '@/lib/chat-photos';
import { actorRequest, useOwnerGuard } from './hooks';
import { F } from '@/components/ui';

/** Account-bound bytes from our own storage, never the third-party GIF provider. */
export function LibraryGifImage({ id, width, height, label = 'Afilli GIF' }: { id: string; width: number; height: number; label?: string }) {
  const { userId } = useCommunity(), alive = useOwnerGuard(userId);
  const { magazine: P } = useTheme();
  const [source, setSource] = useState<{ id: string; owner: string; uri: string } | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000);
    setFailed(false); setSource(null);
    void getLibraryGifMedia(id, { ...actorRequest(userId), signal: controller.signal, responseType: 'blob', fetcher: expoFetch as typeof globalThis.fetch })
      .then(blob => { if (!live || !alive()) throw Error('Account changed'); return photoBlobUri(blob); })
      .then(uri => { if (live && alive()) setSource({ id, owner: userId, uri }); })
      .catch(() => { if (live && alive()) setFailed(true); })
      .finally(() => clearTimeout(timer));
    return () => { live = false; controller.abort(); clearTimeout(timer); };
  }, [id, userId, alive, attempt]);
  const uri = source?.id === id && source.owner === userId ? source.uri : null;
  return <View style={{ width, height, borderRadius: 10, overflow: 'hidden', backgroundColor: P.border }}>
    {uri && !failed ? <Image key={attempt} source={{ uri }} cachePolicy="none" contentFit="contain" style={{ width, height }}
      accessibilityLabel={label} onError={() => setFailed(true)} /> : failed ? (
      <Pressable testID={'library-gif-retry-' + id} accessibilityRole="button" accessibilityLabel="GIF yeniden yükle" onPress={() => setAttempt(n => n + 1)}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 4 }}>
        <Text style={{ fontFamily: F.body, color: P.danger, fontSize: 12 }}>Tekrar dene</Text>
      </Pressable>
    ) : <ActivityIndicator color={P.muted} style={{ flex: 1 }} />}
  </View>;
}
