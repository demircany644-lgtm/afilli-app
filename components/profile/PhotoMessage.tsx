import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { fetch as expoFetch } from 'expo/fetch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDirectPhoto, type MessagePhoto } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { useTheme } from '@/hooks/useTheme';
import { chatPhotoPreview, photoBlobUri } from '@/lib/chat-photos';
import type { LocalChatPhoto } from '@/lib/chat-drafts';
import { actorRequest, useOwnerGuard } from './hooks';
import { F } from '@/components/ui';

export function LocalPhotoPreview({ owner, photo }: { owner: string; photo: LocalChatPhoto }) {
  const { magazine: P } = useTheme();
  const [source, setSource] = useState<{ id: string; uri: string } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let on = true, release = () => {};
    setError(false);
    void chatPhotoPreview(owner, photo).then(result => {
      release = result.release;
      if (on) setSource({ id: photo.localId, uri: result.uri }); else release();
    }).catch(() => { if (on) setError(true); });
    return () => { on = false; release(); };
  }, [owner, photo.localId]);
  if (error) return <Text style={{ color: P.danger, fontSize: 12 }}>Fotoğraf cihazda bulunamadı; yeniden seç.</Text>;
  return source?.id === photo.localId ? <Image testID="chat-photo-preview-image" accessibilityLabel="Seçilen fotoğraf" source={{ uri: source.uri }} cachePolicy="none" contentFit="cover" style={{ width: 70, height: 70, borderRadius: 8 }} /> : <ActivityIndicator color={P.muted} />;
}

/** Protected bytes stay in component memory, never persistent image/disk caches. */
export function PhotoMessage({ photo, expiresAt }: { photo: MessagePhoto; expiresAt?: string | null }) {
  const { magazine: P } = useTheme(), insets = useSafeAreaInsets();
  const { userId } = useCommunity(), alive = useOwnerGuard(userId);
  const [source, setSource] = useState<{ id: string; uri: string } | null>(null);
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0), [open, setOpen] = useState(false);
  const [expired, setExpired] = useState(!!expiresAt && Date.parse(expiresAt) <= Date.now());
  useEffect(() => { if (expired) { setSource(null); setOpen(false); } }, [expired]);
  useEffect(() => {
    if (!expiresAt) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), Math.min(remaining, 2147483647));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  useEffect(() => {
    if (!userId || expired) return;
    let on = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    setError(false);
    void getDirectPhoto(photo.id, { ...actorRequest(userId), signal: controller.signal, responseType: 'blob', fetcher: expoFetch as typeof globalThis.fetch })
      .then(blob => { if (!on || !alive()) throw Error('Account changed'); return photoBlobUri(blob); })
      .then(uri => { if (on && alive()) setSource({ id: photo.id, uri }); })
      .catch(() => { if (on && alive()) setError(true); }).finally(() => clearTimeout(timer));
    return () => { on = false; clearTimeout(timer); controller.abort(); };
  }, [userId, alive, photo.id, expired, attempt]);
  if (expired) return <Text style={{ color: P.muted, fontFamily: F.body, fontStyle: 'italic' }}>Bu medya süresi dolduğu için silindi</Text>;
  const uri = source?.id === photo.id ? source.uri : null;
  if (error) return <Pressable testID={'chat-photo-retry-' + photo.id} accessibilityRole="button" onPress={() => setAttempt(n => n + 1)}>
    <Text style={{ color: P.danger, fontFamily: F.body }}>Fotoğraf alınamadı · Tekrar dene</Text>
  </Pressable>;
  if (!uri) return <View style={{ width: 170, height: 140, justifyContent: 'center' }}><ActivityIndicator color={P.muted} /></View>;
  return <>
    <Pressable testID={'chat-photo-open-' + photo.id} accessibilityRole="button" accessibilityLabel="Fotoğrafı tam boy aç" onPress={() => setOpen(true)}>
      <Image source={{ uri }} cachePolicy="none" contentFit="cover" style={{ width: 220, maxWidth: '100%', height: Math.min(270, Math.max(120, 220 * photo.height / photo.width)), borderRadius: 10 }} />
    </Pressable>
    <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="fade" presentationStyle="fullScreen">
      <View testID="chat-photo-fullscreen" style={{ flex: 1, backgroundColor: P.background, paddingTop: Platform.OS === 'web' ? 67 : insets.top, paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 12 }}>
          <Pressable testID="chat-photo-close" accessibilityRole="button" accessibilityLabel="Fotoğrafı kapat" onPress={() => setOpen(false)} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}>
            <Feather name="chevron-left" size={26} color={P.text} />
          </Pressable>
          <Text style={{ fontFamily: F.serifBold, fontSize: 20, color: P.text }}>Fotoğraf</Text>
        </View>
        <Image source={{ uri }} cachePolicy="none" contentFit="contain" style={{ flex: 1, width: '100%' }} />
      </View>
    </Modal>
  </>;
}
