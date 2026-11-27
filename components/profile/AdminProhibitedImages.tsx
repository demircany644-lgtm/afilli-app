import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminProhibitedImagesQueryKey, getGetAdminProhibitedImageAttemptsQueryKey,
  useGetAdminProhibitedImages, useGetAdminProhibitedImageAttempts,
  useRequestProhibitedImageUpload, useCompleteProhibitedImageUpload,
  useDeleteAdminProhibitedImage, useDecideProhibitedImageAttempt,
  type AdminProhibitedImageAttempt,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { apiError, timeAgo } from '@/components/bulletins/common';
import { FoilButton, Notice, StateCard, useKitStyles } from '@/components/profile/kit';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { actorRequest, scoped, useFocusedForeground, useOwnerGuard } from '@/components/profile/hooks';

type Picked = { id: string; asset: ImagePicker.ImagePickerAsset };
const AREA: Record<AdminProhibitedImageAttempt['area'], string> = {
  profile: 'Profil fotoğrafı',
  bulletin: 'Bülten fotoğrafı',
  book: 'Kitap içeriği veya kapağı',
  private_message: 'Özel mesaj fotoğrafı',
};

async function uploadableImage(asset: ImagePicker.ImagePickerAsset) {
  if (!asset.width || !asset.height || asset.width > 12_000 || asset.height > 12_000) {
    throw new Error('Fotoğraf boyutları okunamadı veya çok büyük.');
  }
  const scale = Math.min(1, 1400 / asset.width, 1800 / asset.height);
  const actions = scale < 1
    ? [asset.width / asset.height > 1400 / 1800
      ? { resize: { width: Math.round(asset.width * scale) } }
      : { resize: { height: Math.round(asset.height * scale) } }]
    : [];
  const image = await manipulateAsync(asset.uri, actions, { compress: 0.86, format: SaveFormat.JPEG });
  if (Platform.OS === 'web') {
    const blob = await (await expoFetch(image.uri)).blob();
    if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('Sıkıştırılmış fotoğraf 10 MB sınırını aşıyor.');
    return { body: blob, size: blob.size };
  }
  const file = new File(image.uri);
  if (!file.exists || !file.size || file.size > 10 * 1024 * 1024) {
    throw new Error('Sıkıştırılmış fotoğraf 10 MB sınırını aşıyor.');
  }
  return { body: file, size: file.size };
}

export function AdminProhibitedImages({ userId }: { userId: string }) {
  const { magazine: P } = useTheme();
  const st = useStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const live = useFocusedForeground();
  const alive = useOwnerGuard(userId);
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);

  const referencesKey = scoped(getGetAdminProhibitedImagesQueryKey(), userId);
  const attemptsKey = scoped(getGetAdminProhibitedImageAttemptsQueryKey({ offset }), userId);
  const references = useGetAdminProhibitedImages({
    request: actorRequest(userId),
    query: { queryKey: referencesKey, enabled: !!userId, refetchOnMount: 'always', refetchInterval: live ? 5 * 60_000 : false },
  });
  const attempts = useGetAdminProhibitedImageAttempts({ offset }, {
    request: actorRequest(userId),
    query: { queryKey: attemptsKey, enabled: !!userId, refetchOnMount: 'always', refetchInterval: live ? 30_000 : false },
  });
  const requestUpload = useRequestProhibitedImageUpload({ request: actorRequest(userId) });
  const completeUpload = useCompleteProhibitedImageUpload({ request: actorRequest(userId) });
  const removeReference = useDeleteAdminProhibitedImage({ request: actorRequest(userId) });
  const decide = useDecideProhibitedImageAttempt({ request: actorRequest(userId) });
  const remaining = Math.max(0, (references.data?.maximum ?? 6) - (references.data?.items.length ?? 0));

  useEffect(() => {
    if (!live) return;
    void references.refetch();
    void attempts.refetch();
  }, [live]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetAdminProhibitedImagesQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetAdminProhibitedImageAttemptsQueryKey() }),
    ]);
  };

  const chooseImages = async () => {
    if (picking || uploading || remaining === 0) return;
    setError(''); setNotice(''); setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Fotoğraf galerisine erişim izni verilmedi.');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining,
        quality: 1, allowsEditing: false,
      });
      if (!result.canceled && alive()) {
        setPicked(result.assets.map(asset => ({ id: randomUUID(), asset })));
      }
    } catch (cause) {
      if (alive()) setError(apiError(cause, 'Fotoğraflar seçilemedi.'));
    } finally { if (alive()) setPicking(false); }
  };

  const submitImages = async () => {
    if (lock.current || uploading || picked.length === 0) return;
    lock.current = true; setUploading(true); setError(''); setNotice('');
    try {
      let completed = 0;
      for (const item of picked) {
        const image = await uploadableImage(item.asset);
        if (!alive()) return;
        const upload = await requestUpload.mutateAsync({ data: { contentType: 'image/jpeg', size: image.size } });
        if (!alive()) return;
        const response = await expoFetch(upload.uploadUrl, { method: 'PUT', body: image.body });
        if (!response.ok) throw new Error('Fotoğraf özel depoya yüklenemedi. Tekrar dene.');
        if (!alive()) return;
        await completeUpload.mutateAsync({ id: upload.id });
        if (!alive()) return;
        completed++;
        setPicked(current => current.filter(photo => photo.id !== item.id));
      }
      await refresh();
      if (alive()) setNotice(`${completed} referans fotoğrafı güvenli biçimde kaydedildi.`);
    } catch (cause) {
      if (alive()) setError(apiError(cause, 'Referans fotoğrafları eklenemedi.'));
    } finally { lock.current = false; if (alive()) setUploading(false); }
  };

  const deleteImage = (id: string) => {
    const run = async () => {
      setError(''); setNotice('');
      try {
        await removeReference.mutateAsync({ id });
        await refresh();
        if (alive()) setNotice('Referans fotoğrafı kaldırıldı.');
      } catch (cause) { if (alive()) setError(apiError(cause, 'Fotoğraf kaldırılamadı.')); }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Bu referans fotoğrafı kaldırılsın mı? Beş referansın altına düşmek denetimi durdurabilir.')) void run();
    } else {
      Alert.alert('Referans fotoğrafını kaldır', 'Beş referansın altına düşmek denetimi durdurabilir.', [
        { text: 'Vazgeç', style: 'cancel' }, { text: 'Kaldır', style: 'destructive', onPress: () => void run() },
      ]);
    }
  };

  const reviewAttempt = async (attempt: AdminProhibitedImageAttempt, decision: 'keep' | 'release') => {
    const reason = reasons[attempt.id]?.trim() ?? '';
    if (reason.length < 3) { setError('Her yönetici kararı için en az 3 karakterlik gerekçe yaz.'); return; }
    setDecisionBusy(attempt.id); setError(''); setNotice('');
    try {
      await decide.mutateAsync({ id: attempt.id, data: { decision, reason } });
      await refresh();
      if (alive()) setNotice(decision === 'release' ? 'İnceleme kaydı güncellendi; başka etkin vaka yoksa hesap açıldı.' : 'Erişim kısıtlaması yönetici tarafından sürdürüldü.');
    } catch (cause) { if (alive()) setError(apiError(cause, 'Yönetici kararı kaydedilemedi.')); }
    finally { if (alive()) setDecisionBusy(null); }
  };

  const readyCount = references.data?.readyCount ?? 0;
  return (
    <View style={{ gap: 12 }}>
      <View style={[k.card, st.card]}>
        <View style={st.head}>
          <View style={st.icon}><Feather name="shield" size={19} color={P.gold} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text accessibilityRole="header" style={st.title}>Yasaklı Paylaşımlar</Text>
            <Text style={st.sub}>{readyCount}/5 gerekli fotoğraf · en fazla 6</Text>
          </View>
        </View>
        <Text style={st.body}>
          Fotoğraf eşleşmesi sunucuda denetlenir. Denetim beş tamamlanmış referanstan sonra etkinleşir; eşleşen gönderi yayımlanmaz.
        </Text>
        {readyCount < 5 ? <Notice text="Beş referans fotoğrafı tamamlanana kadar eşleşme denetimi etkin değil." testID="admin-prohibited-setup-warning" /> : null}
        <View style={st.actions}>
          <FoilButton variant="outline" icon="image" label={picking ? 'Galeri açılıyor…' : 'Referans seç'}
            testID="admin-prohibited-pick" busy={picking} disabled={uploading || remaining === 0} onPress={() => void chooseImages()} />
          {picked.length ? <FoilButton icon="upload-cloud" label={uploading ? 'Yükleniyor…' : `${picked.length} fotoğrafı kaydet`}
            testID="admin-prohibited-upload" busy={uploading} disabled={picking} onPress={() => void submitImages()} /> : null}
        </View>
        {picked.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.previewRail}>
            {picked.map(photo => <Image key={photo.id} source={{ uri: photo.asset.uri }} contentFit="cover" style={st.preview} accessibilityLabel="Seçilen referans fotoğrafı önizlemesi" />)}
          </ScrollView>
        ) : null}
        {error ? <Notice tone="error" text={error} testID="admin-prohibited-error" /> : null}
        {notice ? <Notice text={notice} testID="admin-prohibited-notice" /> : null}
        {references.isLoading && !references.data ? <ActivityIndicator color={P.gold} style={{ padding: 16 }} /> :
          references.isError && !references.data
            ? <StateCard icon="wifi-off" title="Referanslar yüklenemedi" text={apiError(references.error, 'Bağlantıyı kontrol et.')} action={{ label: 'Tekrar dene', testID: 'admin-prohibited-retry', onPress: () => void references.refetch() }} />
            : references.data?.items.length ? (
              <View style={{ gap: 8 }}>
                {references.data.items.map((item, index) => (
                  <View key={item.id} testID={`admin-prohibited-reference-${item.id}`} style={[st.reference, { borderColor: P.border }]}>
                    {item.imageUrl
                      ? <Image source={{ uri: item.imageUrl }} contentFit="cover" style={st.referenceImage} accessibilityLabel={`Yasaklı görsel referansı ${index + 1}`} />
                      : <View style={[st.referenceImage, st.imagePlaceholder]}><Feather name="upload-cloud" size={18} color={P.muted} /></View>}
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={st.rowTitle}>Referans {index + 1}</Text>
                      <Text style={st.sub}>{item.ready ? `Eklendi ${timeAgo(item.createdAt)}` : 'Yükleme tamamlanmadı'}</Text>
                    </View>
                    <Pressable testID={`admin-prohibited-reference-remove-${item.id}`} accessibilityRole="button"
                      accessibilityLabel="Referansı kaldır" onPress={() => { tap(); deleteImage(item.id); }} style={st.iconButton}>
                      <Feather name="trash-2" size={17} color={P.danger} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : <StateCard icon="image" title="Henüz referans yok" text="Galeriden 5 veya 6 yasaklı fotoğraf ekleyerek denetimi kur." testID="admin-prohibited-empty" />}
      </View>

      <View style={[k.card, st.card]}>
        <View style={st.head}>
          <View style={st.icon}><Feather name="alert-triangle" size={19} color={P.gold} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text accessibilityRole="header" style={st.title}>Eşleşme vakaları</Text>
            <Text style={st.sub}>Kısıtlanan hesaplar ve gönderim denemeleri</Text>
          </View>
        </View>
        {attempts.isLoading && !attempts.data ? <ActivityIndicator color={P.gold} style={{ padding: 16 }} /> :
          attempts.isError && !attempts.data
            ? <StateCard icon="wifi-off" title="Vakalar yüklenemedi" text={apiError(attempts.error, 'Bağlantıyı kontrol et.')} action={{ label: 'Tekrar dene', testID: 'admin-prohibited-cases-retry', onPress: () => void attempts.refetch() }} />
            : attempts.data?.items.length ? (
              <>
                {attempts.data.items.map(attempt => (
                  <View key={attempt.id} testID={`admin-prohibited-case-${attempt.id}`} style={[st.caseCard, { borderColor: P.border }]}>
                    <View style={st.caseHead}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={st.rowTitle}>{attempt.nickname}</Text>
                        <Text style={st.sub}>{AREA[attempt.area]} · {timeAgo(attempt.createdAt)}</Text>
                        <Text style={st.sub}>Algısal benzerlik: {64 - attempt.distance}/64 · eşik {64 - attempt.threshold}/64</Text>
                      </View>
                      <Text style={[st.status, { color: attempt.status === 'released' ? P.muted : attempt.status === 'pending' ? P.gold : P.danger }]}>
                        {attempt.status === 'pending' ? 'İncelemede' : attempt.status === 'confirmed' ? 'Kısıtlama sürüyor' : 'Engel kaldırıldı'}
                      </Text>
                    </View>
                    <View style={st.evidenceRow}>
                      <View style={st.evidenceBox}>
                        <Image source={{ uri: attempt.evidenceUrl }} contentFit="contain" style={st.evidenceImage} accessibilityLabel="Paylaşılmaya çalışılan fotoğraf" />
                        <Text style={st.evidenceLabel}>Gönderim denemesi</Text>
                      </View>
                      {attempt.referenceUrl ? <View style={st.evidenceBox}>
                        <Image source={{ uri: attempt.referenceUrl }} contentFit="contain" style={st.evidenceImage} accessibilityLabel="Eşleşen yasaklı referans" />
                        <Text style={st.evidenceLabel}>Eşleşen referans</Text>
                      </View> : null}
                    </View>
                    {attempt.messages.map(message => <View key={message.id} style={[st.message, { backgroundColor: P.input }]}>
                      <Text style={st.evidenceLabel}>Kullanıcıya ait iletişim mesajı · {timeAgo(message.createdAt)}</Text>
                      <Text style={st.body}>{message.body}</Text>
                    </View>)}
                    {attempt.status !== 'released' ? (
                      <View style={{ gap: 8, paddingTop: 4 }}>
                        <TextInput testID={`admin-prohibited-reason-${attempt.id}`} accessibilityLabel="Yönetici karar gerekçesi"
                          value={reasons[attempt.id] ?? ''} onChangeText={value => setReasons(current => ({ ...current, [attempt.id]: value }))}
                          placeholder="Karar gerekçesi (en az 3 karakter)" placeholderTextColor={P.muted}
                          maxLength={300} style={[st.input, { borderColor: P.border, color: P.text }]} />
                        <View style={st.actions}>
                          <FoilButton variant="outline" icon="unlock" label="Engeli kaldır" testID={`admin-prohibited-release-${attempt.id}`}
                            busy={decisionBusy === attempt.id} disabled={!!decisionBusy} onPress={() => void reviewAttempt(attempt, 'release')} />
                          <FoilButton icon="shield" label="Kısıtlamayı sürdür" testID={`admin-prohibited-keep-${attempt.id}`}
                            busy={decisionBusy === attempt.id} disabled={!!decisionBusy} onPress={() => void reviewAttempt(attempt, 'keep')} />
                        </View>
                      </View>
                    ) : attempt.decisionReason ? <Text style={st.sub}>Yönetici notu: {attempt.decisionReason}</Text> : null}
                  </View>
                ))}
                <View style={st.pager}>
                  <Pressable testID="admin-prohibited-prev" accessibilityRole="button" disabled={offset === 0}
                    onPress={() => { tap(); setOffset(Math.max(0, offset - 25)); }}
                    style={[st.pageButton, { borderColor: P.border, opacity: offset === 0 ? 0.4 : 1 }]}><Feather name="chevron-left" size={18} color={P.text} /></Pressable>
                  <Text style={st.sub}>{attempts.data.total ? `${offset + 1}–${Math.min(offset + 25, attempts.data.total)} / ${attempts.data.total}` : '0 vaka'}</Text>
                  <Pressable testID="admin-prohibited-next" accessibilityRole="button" disabled={attempts.data.nextOffset == null}
                    onPress={() => { tap(); if (attempts.data?.nextOffset != null) setOffset(attempts.data.nextOffset); }}
                    style={[st.pageButton, { borderColor: P.border, opacity: attempts.data.nextOffset == null ? 0.4 : 1 }]}><Feather name="chevron-right" size={18} color={P.text} /></Pressable>
                </View>
              </>
            ) : <StateCard icon="shield" title="Eşleşme vakası yok" text="Eşleşen fotoğraf denemeleri burada görünür." testID="admin-prohibited-cases-empty" />}
      </View>
    </View>
  );
}

const useStyles = makeStyles(t => {
  const { magazine: P } = t;
  return StyleSheet.create({
    card: { padding: 14, gap: 12 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: P.input },
    title: { fontFamily: F.serifBold, fontSize: 19, lineHeight: 24, color: P.text },
    sub: { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: P.muted },
    body: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: P.text },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    previewRail: { gap: 8, paddingVertical: 2 },
    preview: { width: 76, height: 94, borderRadius: 9, backgroundColor: P.input },
    reference: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderWidth: 1, borderRadius: 13, backgroundColor: P.card },
    referenceImage: { width: 52, height: 68, borderRadius: 7, backgroundColor: P.input },
    imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
    rowTitle: { fontFamily: F.semi, fontSize: 14, color: P.text },
    iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    caseCard: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: P.border, paddingTop: 12, paddingBottom: 14, gap: 10 },
    caseHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    status: { fontFamily: F.semi, fontSize: 11, textAlign: 'right', maxWidth: 112 },
    evidenceRow: { flexDirection: 'row', gap: 10 },
    evidenceBox: { flex: 1, alignItems: 'center', gap: 4 },
    evidenceImage: { width: '100%', height: 160, borderRadius: 10, backgroundColor: P.input },
    evidenceLabel: { fontFamily: F.body, fontSize: 11, color: P.muted, textAlign: 'center' },
    message: { padding: 10, borderRadius: 10, gap: 4 },
    input: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, fontFamily: F.body, fontSize: 14 },
    pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 },
    pageButton: { width: 38, height: 38, borderWidth: 1, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  });
});
