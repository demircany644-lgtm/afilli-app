import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyBookPromotionQueryKey, useCreateBookPromotionRequest, useGetMyBookPromotion,
} from '@workspace/api-client-react';
import { apiError } from '@/components/bulletins/common';
import { FoilButton, Notice, StateCard, useKitStyles } from '@/components/profile/kit';
import { F, tap } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { actorRequest, scoped, useOwnerGuard } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';

const STATUS: Record<string, string> = {
  pending: 'Talep yönetici incelemesini bekliyor.',
  active: 'Kitap Afilli Önerileri’nde gösteriliyor.',
  rejected: 'Talep reddedildi. İstersen yeni bir talep gönderebilirsin.',
  expired: 'Tanıtım süresi sona erdi. Yeni bir talep gönderebilirsin.',
};

export function BookPromotionRequest({ bookId }: { bookId: string }) {
  const { userId } = useCommunity();
  const { magazine: P } = useTheme();
  const k = useKitStyles();
  const qc = useQueryClient();
  const guard = useOwnerGuard(userId);
  const key = scoped(getGetMyBookPromotionQueryKey(bookId), userId);
  const info = useGetMyBookPromotion(bookId, { request: actorRequest(userId), query: { enabled: !!userId && !!bookId, queryKey: key } });
  const create = useCreateBookPromotionRequest({ request: actorRequest(userId) });
  const clientRequestId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (duration === null && info.data?.allowedDurations.length) setDuration(info.data.allowedDurations[0]);
    if (duration !== null && info.data && !info.data.allowedDurations.some(value => value === duration)) setDuration(info.data.allowedDurations[0] ?? null);
  }, [duration, info.data?.allowedDurations]);

  const latest = info.data?.latestRequest;
  const locked = latest?.status === 'pending' || latest?.status === 'active';
  const send = async () => {
    if (!duration || !userId || saving || locked) return;
    setSaving(true); setError(''); setNotice('');
    try {
      clientRequestId.current ??= randomUUID();
      await create.mutateAsync({ id: bookId, data: { durationDays: duration as 3 | 7 | 15 | 30, clientRequestId: clientRequestId.current } });
      if (!guard()) return;
      clientRequestId.current = null;
      await qc.invalidateQueries({ queryKey: key });
      setOpen(false);
      setNotice('Talebin yönetici paneline iletildi. Onaylanana kadar Afilli Önerileri’nde görünmez.');
    } catch (e) { if (guard()) setError(apiError(e, 'Talep gönderilemedi. Yeniden dene.')); }
    finally { if (guard()) setSaving(false); }
  };

  if (!userId) return null;
  return (
    <View testID="book-promotion-request" style={[k.card, styles.card]}>
      <View style={styles.titleRow}>
        <Feather name="award" size={17} color={P.gold} />
        <Text accessibilityRole="header" style={[styles.title, { color: P.text }]}>Afilli Önerileri</Text>
      </View>
      {info.isLoading && !info.data ? <ActivityIndicator color={P.gold} style={{ padding: 10 }} /> :
        info.isError && !info.data ? <StateCard icon="wifi-off" title="Tanıtım bilgisi alınamadı"
          text={apiError(info.error, 'Bağlantıyı kontrol et.')}
          action={{ label: 'Yeniden dene', testID: 'book-promotion-retry', onPress: () => void info.refetch() }} /> : <>
          {latest ? (
            <View testID={`book-promotion-status-${latest.status}`} style={[styles.status, { borderColor: P.border }]}>
              <Feather name={latest.status === 'active' ? 'check-circle' : latest.status === 'rejected' ? 'x-circle' : 'clock'}
                size={16} color={latest.status === 'rejected' ? P.danger : P.gold} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.statusText, { color: P.text }]}>{STATUS[latest.status]}</Text>
                {latest.expiresAt ? <Text style={[styles.meta, { color: P.muted }]}>Bitiş: {new Date(latest.expiresAt).toLocaleString('tr-TR')}</Text> : null}
              </View>
            </View>
          ) : null}
          {!locked && info.data?.enabled ? <FoilButton
            label={open ? 'Tanıtım seçeneklerini kapat' : latest ? 'Yeni tanıtım talebi' : 'Kitabını Öner'}
            icon={open ? 'chevron-up' : 'award'} variant="outline" testID="book-promotion-open"
            onPress={() => { tap(); setOpen(v => !v); setError(''); setNotice(''); }} /> : null}
          {!info.data?.enabled ? <Text style={[styles.meta, { color: P.muted }]}>Kitap tanıtım talepleri şu anda kapalı.</Text> : null}
          {open && !locked && info.data?.enabled ? <View style={styles.form}>
            <Text style={[styles.meta, { color: P.muted }]}>Tanıtım süresi</Text>
            <View style={styles.options}>
              {info.data.allowedDurations.map((days) => {
                const selected = duration === days;
                return <Pressable key={days} testID={`book-promotion-duration-${days}`}
                  accessibilityRole="radio" accessibilityState={{ selected }}
                  onPress={() => { tap(); setDuration(days); }}
                  style={[styles.option, { borderColor: selected ? P.gold : P.border, backgroundColor: selected ? P.input : P.card }]}>
                  <Text style={[styles.optionText, { color: selected ? P.gold : P.text }]}>{days} gün</Text>
                </Pressable>;
              })}
            </View>
            <Text style={[styles.meta, { color: P.muted }]}>Şimdilik tüm tanıtım talepleri ücretsizdir. Ödeme alınmaz.</Text>
            {error ? <Notice tone="error" text={error} testID="book-promotion-error" /> : null}
            <FoilButton label={saving ? 'Talep gönderiliyor…' : 'Ücretsiz talep gönder'}
              icon="send" testID="book-promotion-submit" busy={saving} disabled={saving || !duration} onPress={() => void send()} />
          </View> : null}
          {notice ? <Notice text={notice} testID="book-promotion-notice" /> : null}
        </>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, padding: 14, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: F.serifBold, fontSize: 17 },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderRadius: 12, padding: 10 },
  statusText: { fontFamily: F.semi, fontSize: 12.5, lineHeight: 18 },
  meta: { fontFamily: F.body, fontSize: 12, lineHeight: 17 },
  form: { gap: 9 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { minWidth: 70, minHeight: 36, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  optionText: { fontFamily: F.semi, fontSize: 12 },
});
