import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminBookPromotionRequestsQueryKey, getGetAdminBookPromotionSettingsQueryKey, getGetPromotedBooksQueryKey,
  getGetDiscoveryBooksQueryKey, useGetAdminBookPromotionRequests, useGetAdminBookPromotionSettings,
  useUpdateAdminBookPromotionSettings, useDecideAdminBookPromotionRequest,
  type BookPromotionRequest, type GetAdminBookPromotionRequestsParams,
} from '@workspace/api-client-react';
import { mediaUrl, apiError, timeAgo } from '@/components/bulletins/common';
import { FoilButton, Notice, Skeleton, StateCard, useKitStyles } from '@/components/profile/kit';
import { F, tap } from '@/components/ui';
import { actorRequest, scoped, useOwnerGuard } from '@/components/profile/hooks';
import { useTheme } from '@/hooks/useTheme';

const DURATIONS = [3, 7, 15, 30] as const;
const FILTERS = [
  { key: 'pending', label: 'Bekleyen' }, { key: 'active', label: 'Yayında' },
  { key: 'rejected', label: 'Reddedilen' }, { key: 'expired', label: 'Süresi dolan' }, { key: 'all', label: 'Tümü' },
] as const;
type Filter = typeof FILTERS[number]['key'];

export function AdminBookPromotions({ userId, live }: { userId: string; live: boolean }) {
  const { magazine: P } = useTheme();
  const k = useKitStyles();
  const qc = useQueryClient();
  const alive = useOwnerGuard(userId);
  const [filter, setFilter] = useState<Filter>('pending');
  const [offset, setOffset] = useState(0);
  const params: GetAdminBookPromotionRequestsParams = { status: filter, offset };
  const listKey = scoped(getGetAdminBookPromotionRequestsQueryKey(params), userId);
  const list = useGetAdminBookPromotionRequests(params, { request: actorRequest(userId), query: {
    enabled: !!userId, queryKey: listKey, staleTime: 15_000, refetchInterval: live ? 30_000 : false,
  } });
  const settingsKey = scoped(getGetAdminBookPromotionSettingsQueryKey(), userId);
  const settings = useGetAdminBookPromotionSettings({ request: actorRequest(userId), query: { enabled: !!userId, queryKey: settingsKey } });
  const updateSettings = useUpdateAdminBookPromotionSettings({ request: actorRequest(userId) });
  const decide = useDecideAdminBookPromotionRequest({ request: actorRequest(userId) });
  const [enabled, setEnabled] = useState(true);
  const [durations, setDurations] = useState<number[]>([...DURATIONS]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);

  useEffect(() => {
    if (!settings.data || settingsDirty) return;
    setEnabled(settings.data.enabled);
    setDurations(settings.data.allowedDurations);
  }, [settings.data?.enabled, settings.data?.allowedDurations, settingsDirty]);
  useEffect(() => { setOffset(0); }, [filter]);

  const saveSettings = async () => {
    if (savingSettings || !durations.length) return;
    setSavingSettings(true); setError(''); setNotice('');
    try {
      await updateSettings.mutateAsync({ data: { enabled, allowedDurations: DURATIONS.filter(v => durations.includes(v)) } });
      if (!alive()) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: settingsKey }),
        qc.invalidateQueries({ queryKey: getGetAdminBookPromotionRequestsQueryKey() }),
      ]);
      setSettingsDirty(false);
      setNotice('Ücretsiz tanıtım seçenekleri kaydedildi.');
    } catch (e) { if (alive()) setError(apiError(e, 'Ayarlar kaydedilemedi.')); }
    finally { if (alive()) setSavingSettings(false); }
  };

  const makeDecision = async (item: BookPromotionRequest, decision: 'approve_free' | 'reject') => {
    if (lock.current || busyId) return;
    lock.current = true; setBusyId(item.id); setError(''); setNotice('');
    try {
      const note = reasons[item.id]?.trim() ?? '';
      await decide.mutateAsync({ id: item.id, data: { decision, ...(note ? { reason: note.slice(0, 300) } : {}) } });
      if (!alive()) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAdminBookPromotionRequestsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetPromotedBooksQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetDiscoveryBooksQueryKey() }),
      ]);
      setReasons(prev => { const next = { ...prev }; delete next[item.id]; return next; });
      setNotice(decision === 'approve_free' ? 'Talep ücretsiz onaylandı; süre şimdi başladı.' : 'Talep reddedildi.');
    } catch (e) { if (alive()) setError(apiError(e, 'Talep kararı kaydedilemedi.')); }
    finally { lock.current = false; if (alive()) setBusyId(null); }
  };

  const toggleDuration = (days: number) => setDurations(prev => prev.includes(days) ? prev.filter(v => v !== days) : [...prev, days]);

  return (
    <View testID="admin-book-promotions" style={{ gap: 12 }}>
      <View style={[k.card, s.card]}>
        <View style={s.titleRow}><Feather name="sliders" size={17} color={P.gold} /><Text style={[s.heading, { color: P.text }]}>Ücretsiz tanıtım ayarları</Text></View>
        <Text style={[s.sub, { color: P.muted }]}>Şimdilik ödeme alınmaz. Ücretli tanıtım ve fiyatlandırma kapalıdır.</Text>
        {settings.isLoading && !settings.data ? <ActivityIndicator color={P.gold} /> : settings.isError && !settings.data ?
          <StateCard icon="wifi-off" title="Ayarlar yüklenemedi" text={apiError(settings.error, 'Bağlantıyı kontrol et.')}
            action={{ label: 'Yeniden dene', testID: 'admin-promotion-settings-retry', onPress: () => void settings.refetch() }} /> : <>
            <Pressable testID="admin-promotion-enabled" accessibilityRole="switch" accessibilityState={{ checked: enabled }}
              onPress={() => { tap(); setEnabled(v => !v); setSettingsDirty(true); }}
              style={[s.toggle, { borderColor: enabled ? P.gold : P.border }]}>
              <Feather name={enabled ? 'check-circle' : 'pause-circle'} size={18} color={enabled ? P.gold : P.muted} />
              <Text style={[s.toggleText, { color: P.text }]}>{enabled ? 'Yeni talepler açık' : 'Yeni talepler kapalı'}</Text>
            </Pressable>
            <Text style={[s.sub, { color: P.muted }]}>Kullanılabilir süreler</Text>
            <View style={s.options}>
              {DURATIONS.map(days => {
                const selected = durations.includes(days);
                return <Pressable key={days} testID={`admin-promotion-duration-${days}`}
                  accessibilityRole="checkbox" accessibilityState={{ checked: selected }}
                  onPress={() => { tap(); toggleDuration(days); setSettingsDirty(true); }}
                  style={[s.duration, { borderColor: selected ? P.gold : P.border, backgroundColor: selected ? P.input : P.card }]}>
                  <Text style={[s.durationText, { color: selected ? P.gold : P.text }]}>{days} gün</Text>
                </Pressable>;
              })}
            </View>
            <FoilButton label={savingSettings ? 'Kaydediliyor…' : 'Ayarları kaydet'} icon="save"
              testID="admin-promotion-settings-save" busy={savingSettings} disabled={savingSettings || !durations.length}
              onPress={() => void saveSettings()} />
          </>}
      </View>

      <View style={[k.card, s.card]}>
        <View style={s.titleRow}><Feather name="award" size={17} color={P.gold} /><Text style={[s.heading, { color: P.text }]}>Kitap tanıtım talepleri</Text></View>
        <Text style={[s.sub, { color: P.muted }]}>Ücretsiz onay, seçilen süreyi hemen başlatır. Bekleyen talepler yayınlanmaz.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
          {FILTERS.map(item => <Pressable key={item.key} testID={`admin-promotion-filter-${item.key}`}
            accessibilityRole="tab" accessibilityState={{ selected: filter === item.key }}
            onPress={() => { tap(); setFilter(item.key); setError(''); }}
            style={[s.filter, { borderColor: filter === item.key ? P.gold : P.border, backgroundColor: filter === item.key ? P.input : P.card }]}>
            <Text style={[s.filterText, { color: filter === item.key ? P.gold : P.text }]}>{item.label}</Text>
          </Pressable>)}
        </ScrollView>
        {error ? <Notice tone="error" text={error} testID="admin-promotion-error" /> : null}
        {notice ? <Notice text={notice} testID="admin-promotion-notice" /> : null}
        {list.isLoading && !list.data ? <View style={{ gap: 8 }}><Skeleton w="100%" h={116} r={14} /><Skeleton w="100%" h={116} r={14} /></View>
          : list.isError && !list.data ? <StateCard icon="wifi-off" title="Talepler yüklenemedi" text={apiError(list.error, 'Bağlantıyı kontrol et.')}
            action={{ label: 'Yeniden dene', testID: 'admin-promotions-retry', onPress: () => void list.refetch() }} />
            : list.data?.items.length ? <>
              {list.data.items.map(item => <PromotionCard key={item.id} item={item} busy={busyId === item.id}
                decisionBusy={!!busyId} onApprove={() => void makeDecision(item, 'approve_free')}
                onReject={() => void makeDecision(item, 'reject')}
                onReason={(text) => setReasons(prev => ({ ...prev, [item.id]: text }))} reason={reasons[item.id] ?? ''} />)}
              <View style={s.pager}>
                <Pressable testID="admin-promotions-prev" accessibilityRole="button" disabled={offset === 0 || list.isFetching}
                  onPress={() => setOffset(Math.max(0, offset - 25))} style={[s.pageButton, { borderColor: P.border, opacity: offset === 0 ? 0.4 : 1 }]}>
                  <Feather name="chevron-left" size={17} color={P.text} />
                </Pressable>
                <Text style={s.sub}>{offset + 1}–{Math.min(offset + 25, list.data.total)} / {list.data.total}</Text>
                <Pressable testID="admin-promotions-next" accessibilityRole="button" disabled={list.data.nextOffset == null || list.isFetching}
                  onPress={() => list.data?.nextOffset != null && setOffset(list.data.nextOffset)}
                  style={[s.pageButton, { borderColor: P.border, opacity: list.data.nextOffset == null ? 0.4 : 1 }]}>
                  <Feather name="chevron-right" size={17} color={P.text} />
                </Pressable>
              </View>
            </> : <StateCard icon="inbox" title="Bu durumda talep yok" text="Yeni talepler geldikçe burada listelenir." testID="admin-promotions-empty" />}
      </View>
    </View>
  );
}

function PromotionCard({ item, busy, decisionBusy, onApprove, onReject, onReason, reason }: {
  item: BookPromotionRequest; busy: boolean; decisionBusy: boolean; onApprove: () => void; onReject: () => void;
  onReason: (text: string) => void; reason: string;
}) {
  const { magazine: P } = useTheme();
  const s = useStyles();
  const pending = item.status === 'pending';
  const status = item.status === 'pending' ? 'Beklemede' : item.status === 'active' ? 'Yayında' : item.status === 'rejected' ? 'Reddedildi' : 'Süresi doldu';
  return (
    <View testID={`admin-book-promotion-${item.id}`} style={[s.request, { borderColor: P.border }]}>
      <View style={s.requestHead}>
        {item.authorAvatar ? <Image source={{ uri: mediaUrl(item.authorAvatar) }} style={s.avatar} /> :
          <View style={[s.avatar, s.avatarEmpty, { backgroundColor: P.input }]}><Feather name="user" size={16} color={P.muted} /></View>}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.author} numberOfLines={1}>{item.authorNickname}</Text>
          <Text style={s.meta}>{timeAgo(item.requestedAt)}</Text>
        </View>
        <Text style={[s.status, { color: item.status === 'active' ? P.gold : item.status === 'rejected' ? P.danger : P.muted }]}>{status}</Text>
      </View>
      <Pressable testID={`admin-book-promotion-book-${item.id}`} accessibilityRole="link"
        accessibilityLabel={item.bookTitle + ' kitabını aç'} disabled={!item.bookId}
        onPress={() => item.bookId && router.push({ pathname: '/authored-book/[id]', params: { id: item.bookId } })}
        style={s.bookLine}>
        {item.coverUrl ? <Image source={{ uri: mediaUrl(item.coverUrl) }} style={s.cover} /> :
          <View style={[s.cover, s.coverEmpty, { backgroundColor: P.input }]}><Feather name="book" size={18} color={P.gold} /></View>}
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.bookTitle} numberOfLines={2}>{item.bookTitle}</Text>
          <Text style={s.meta}>{item.durationDays} günlük ücretsiz tanıtım</Text>
        </View>
        {item.bookId ? <Feather name="external-link" size={16} color={P.gold} /> : null}
      </Pressable>
      {item.startsAt ? <Text style={s.meta}>Başladı: {new Date(item.startsAt).toLocaleString('tr-TR')}</Text> : null}
      {item.expiresAt ? <Text style={s.meta}>Bitiş: {new Date(item.expiresAt).toLocaleString('tr-TR')}</Text> : null}
      {item.decisionNote ? <Text style={s.note}>Not: {item.decisionNote}</Text> : null}
      {pending ? <>
        <TextInput testID={`admin-book-promotion-reason-${item.id}`} accessibilityLabel="Karar notu"
          value={reason} onChangeText={onReason} placeholder="İsteğe bağlı yönetici notu"
          placeholderTextColor={P.muted} maxLength={300} style={s.reason} />
        <View style={s.actions}>
          <FoilButton label={busy ? 'Onaylanıyor…' : 'Ücretsiz onayla'} icon="check"
            testID={`admin-book-promotion-approve-${item.id}`} busy={busy} disabled={decisionBusy} onPress={onApprove} />
          <FoilButton label={busy ? 'Kaydediliyor…' : 'Reddet'} icon="x" variant="outline"
            testID={`admin-book-promotion-reject-${item.id}`} busy={busy} disabled={decisionBusy} onPress={onReject} />
        </View>
      </> : null}
    </View>
  );
}

const useStyles = () => {
  const { magazine: P } = useTheme();
  return StyleSheet.create({
    request: { gap: 8, padding: 12, borderWidth: 1, borderRadius: 14, backgroundColor: P.card },
    requestHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    avatar: { width: 38, height: 38, borderRadius: 19 },
    avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
    author: { fontFamily: F.semi, fontSize: 13.5, color: P.text },
    meta: { fontFamily: F.body, fontSize: 11.5, lineHeight: 16, color: P.muted },
    status: { fontFamily: F.semi, fontSize: 11.5 },
    bookLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    cover: { width: 44, height: 62, borderRadius: 5 },
    coverEmpty: { alignItems: 'center', justifyContent: 'center' },
    bookTitle: { fontFamily: F.serifBold, fontSize: 15, lineHeight: 19, color: P.text },
    note: { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: P.text },
    reason: { minHeight: 40, paddingHorizontal: 10, borderWidth: 1, borderRadius: 10, borderColor: P.border, backgroundColor: P.input, fontFamily: F.body, fontSize: 12, color: P.text },
    actions: { gap: 8 },
  });
};

const s = StyleSheet.create({
  card: { marginHorizontal: 18, padding: 14, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontFamily: F.serifBold, fontSize: 18, color: '#422A26' },
  sub: { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: '#76675E' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  toggleText: { fontFamily: F.semi, fontSize: 13, color: '#422A26' },
  filters: { gap: 7, paddingVertical: 2 },
  filter: { minHeight: 34, borderWidth: 1, borderRadius: 18, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  filterText: { fontFamily: F.semi, fontSize: 11.5 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  duration: { minWidth: 70, minHeight: 35, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  durationText: { fontFamily: F.semi, fontSize: 12 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  pageButton: { width: 34, height: 34, borderWidth: 1, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
