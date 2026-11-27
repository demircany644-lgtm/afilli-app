import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAccountAppealConfigQueryKey, getGetMyAccountAppealQueryKey, getGetBookNotificationsQueryKey,
  useGetAccountAppealConfig, useGetMyAccountAppeal, useVerifyAccountAppealPurchase,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useCommunity } from '@/context/CommunityContext';
import { F } from '@/components/ui';
import { apiError } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, TopBar } from '@/components/profile/kit';
import { actorRequest, scoped } from '@/components/profile/hooks';
import { useTheme } from '@/hooks/useTheme';
import { purchasesSdk, type StorePackage } from '@/lib/revenuecat';

const NOTICE = 'Uygulama erişiminiz yönetici tarafından kısıtlanmıştır. Engelinizin kaldırılması için ücretli başvuru oluşturabilirsiniz. Başvurunuz ödeme sonrasında yönetici tarafından incelenecek ve onaylanması durumunda hesabınız yeniden aktif edilecektir.';
const OFFERING_ID = 'afilli_account_appeal';
const PACKAGE_ID = 'account_appeal';
const amountLabel = (amount: number, currency: string) => amount.toLocaleString('tr-TR', { style: 'currency', currency });
const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

export default function AccountAppeal() {
  const { magazine: P } = useTheme();
  const { ready, userId } = useCommunity();
  const { retry: retryAuth } = useAuth();
  const qc = useQueryClient();
  const request = actorRequest(userId);
  const config = useGetAccountAppealConfig({
    query: { enabled: ready && !!userId, queryKey: scoped(getGetAccountAppealConfigQueryKey(), userId), staleTime: 30_000 },
    request,
  });
  const status = useGetMyAccountAppeal({
    query: { enabled: ready && !!userId, queryKey: scoped(getGetMyAccountAppealQueryKey(), userId), staleTime: 0, refetchOnMount: 'always', refetchInterval: 12_000 },
    request,
  });
  const verify = useVerifyAccountAppealPurchase({ request });
  const [storePackage, setStorePackage] = useState<StorePackage | null>(null);
  const [sdkMessage, setSdkMessage] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const restored = useRef(false);
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
  const publicKey = platform === 'ios' ? config.data?.iosPublicKey : platform === 'android' ? config.data?.androidPublicKey : null;
  const expectedPrice = config.data?.priceAmount;
  const expected = config.data?.packages.find(item => item.packageIdentifier === PACKAGE_ID && item.platform === platform);

  useEffect(() => {
    if (!ready || !userId || !platform || !config.data?.configured || !publicKey || !expected) {
      setStorePackage(null);
      if (!platform) setSdkMessage('Ödeme yalnızca iOS ve Android uygulamalarında kullanılabilir.');
      else if (config.data && !config.data.configured) setSdkMessage(config.data.message || 'Tek seferlik ödeme henüz yapılandırılmamış.');
      return;
    }
    let live = true;
    setSdkMessage('');
    void (async () => {
      try {
        const sdk = await purchasesSdk(publicKey, userId);
        const offerings = await sdk.getOfferings();
        const offering = offerings.all?.[OFFERING_ID];
        const match = offering?.availablePackages.find(item =>
          item.identifier === PACKAGE_ID && item.product.identifier === expected.productIdentifier);
        if (!live) return;
        setStorePackage(match ?? null);
        if (!match) setSdkMessage('RevenueCat içinde bu cihaz için eşleşen tek seferlik ürün bulunamadı.');
        else if (match.product.price !== expectedPrice || match.product.currencyCode !== config.data?.currency) {
          setSdkMessage('Ödeme, RevenueCat mağaza fiyatı tam 200 TL ve TRY olarak doğrulanana kadar kapalı.');
        }
      } catch {
        if (live) { setStorePackage(null); setSdkMessage('Mağaza bağlantısı kurulamadı. Bu cihazda ödeme başlatılamıyor.'); }
      }
    })();
    return () => { live = false; };
  }, [ready, userId, platform, config.data?.configured, config.data?.message, config.data?.priceAmount, config.data?.currency, publicKey, expected?.productIdentifier]);

  const appeal = status.data?.appeal;
  const canPurchase = !!storePackage && !!platform && expectedPrice !== undefined && storePackage.product.price === expectedPrice
    && storePackage.product.currencyCode === config.data?.currency && status.data?.blocked === true && appeal?.status !== 'pending';

  useEffect(() => {
    if (restored.current || status.data?.blocked !== false || status.data.appeal?.status !== 'approved') return;
    restored.current = true;
    void retryAuth().then(() => router.replace('/')).catch(() => { restored.current = false; });
  }, [status.data?.blocked, status.data?.appeal?.status, retryAuth]);

  const purchase = async () => {
    if (lock.current || !canPurchase || !storePackage || !publicKey || !userId || !platform || !expected) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const sdk = await purchasesSdk(publicKey, userId);
      const result = asObject(await sdk.purchasePackage(storePackage));
      const info = asObject(result.customerInfo ?? result);
      const transactions = Array.isArray(info.nonSubscriptionTransactions) ? info.nonSubscriptionTransactions.map(asObject) : [];
      const transaction = [...transactions].reverse().find(item => item.productIdentifier === expected.productIdentifier);
      const transactionId = typeof transaction?.transactionIdentifier === 'string' ? transaction.transactionIdentifier : null;
      if (!transactionId) throw new Error('Ödeme mağazada tamamlandı ancak işlem numarası alınamadı. Destek için bu ekranı kapatmadan yeniden dene.');
      const created = await verify.mutateAsync({ data: {
        productIdentifier: expected.productIdentifier,
        packageIdentifier: PACKAGE_ID,
        platform,
        transactionId,
      } });
      qc.setQueryData(scoped(getGetMyAccountAppealQueryKey(), userId), (old: typeof status.data | undefined) =>
        old ? { ...old, appeal: created, blocked: true } : old);
      await Promise.all([
        qc.invalidateQueries({ queryKey: scoped(getGetMyAccountAppealQueryKey(), userId) }),
        qc.invalidateQueries({ queryKey: scoped(getGetBookNotificationsQueryKey(), userId) }),
      ]);
      setMessage('Ödeme RevenueCat tarafından doğrulandı. Başvurun yönetici incelemesine iletildi; hesabın onaylanana kadar kısıtlı kalır.');
    } catch (e) {
      const value = asObject(e);
      if (value.userCancelled === true || value.code === 'PURCHASE_CANCELLED_ERROR') setMessage('Satın alma iptal edildi; başvuru oluşturulmadı.');
      else setError(apiError(e, 'Ödeme doğrulanamadı. Doğrulama tamamlanmadan başvuru oluşturulmaz.'));
    } finally { lock.current = false; setBusy(false); }
  };

  const statusText = appeal?.status === 'pending' ? 'Ödeme alındı · Yönetici incelemesi bekleniyor'
    : appeal?.status === 'approved' ? 'Başvurun onaylandı'
      : appeal?.status === 'rejected' ? 'Başvurun reddedildi · Engel devam ediyor' : '';

  return (
    <View style={{ flex: 1, backgroundColor: P.background }} testID="account-appeal-page">
      <MarbleBackground />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <TopBar back title="Engel kaldırma başvurusu" />
        {!ready || status.isLoading && !status.data ? <View style={s.loading}><ActivityIndicator color={P.gold} /></View>
          : !userId ? <Notice text="Başvuru durumunu görüntülemek için giriş yap." />
            : status.isError && !status.data ? <Notice tone="error" text={apiError(status.error, 'Başvuru durumu yüklenemedi.')} action={{ label: 'Tekrar dene', onPress: () => void status.refetch() }} />
              : <>
                {status.data?.blocked ? (
                  <View style={[s.notice, { backgroundColor: P.card, borderColor: P.gold }]}>
                    <View style={s.noticeIcon}><Feather name="shield" size={20} color={P.gold} /></View>
                    <Text style={[s.noticeText, { color: P.text }]}>{NOTICE}</Text>
                    {status.data.blockReason ? <Text style={[s.meta, { color: P.muted }]}>Engel gerekçesi: {status.data.blockReason}</Text> : null}
                    {status.data.blockedAt ? <Text style={[s.meta, { color: P.muted }]}>Engel tarihi: {new Date(status.data.blockedAt).toLocaleString('tr-TR')}</Text> : null}
                  </View>
                ) : (
                  <View style={[s.notice, { backgroundColor: P.card, borderColor: P.gold }]}>
                    <View style={s.noticeIcon}><Feather name={appeal?.status === 'approved' ? 'check-circle' : 'info'} size={20} color={P.gold} /></View>
                    <Text style={[s.noticeText, { color: P.text }]}>{appeal?.status === 'approved' ? 'Hesabın yeniden etkinleştirildi.' : 'Bu hesap şu anda engelli değil.'}</Text>
                    <FoilButton label="Afilli’ye dön" icon="home" testID="appeal-return-home" onPress={() => router.replace('/')} style={{ flex: 0 }} />
                  </View>
                )}

                {appeal ? (
                  <View style={[s.status, { backgroundColor: P.card, borderColor: P.border }]}>
                    <View style={s.statusHead}><Feather name={appeal.status === 'approved' ? 'check-circle' : appeal.status === 'rejected' ? 'x-circle' : 'clock'} size={18} color={appeal.status === 'rejected' ? P.danger : P.gold} />
                      <Text style={[s.statusTitle, { color: P.text }]}>{statusText}</Text></View>
                    <Text style={[s.meta, { color: P.muted }]}>Talep: {new Date(appeal.createdAt).toLocaleString('tr-TR')} · Ödeme: RevenueCat tarafından doğrulandı</Text>
                    {appeal.decisionReason ? <Text style={[s.meta, { color: P.muted }]}>Yönetici notu: {appeal.decisionReason}</Text> : null}
                  </View>
                ) : null}

                {status.data?.blocked && appeal?.status !== 'pending' ? (
                  <View style={[s.fee, { backgroundColor: P.card, borderColor: P.border }]}>
                    <Text style={[s.feeLabel, { color: P.muted }]}>Tek seferlik başvuru ücreti</Text>
                    <Text style={[s.feeValue, { color: P.text }]}>{storePackage?.product.priceString ?? (config.data ? amountLabel(config.data.priceAmount, config.data.currency) : 'Mağaza fiyatı bekleniyor')}</Text>
                    <Text style={[s.meta, { color: P.muted }]}>Ödeme tamamlanınca talep yönetici paneline iletilir. Ödeme hesabı kendiliğinden açmaz; kararı yönetici verir.</Text>
                    {config.isLoading ? <ActivityIndicator color={P.gold} style={{ marginTop: 8 }} />
                      : config.isError ? <Notice tone="error" text={apiError(config.error, 'Mağaza bilgileri yüklenemedi.')} action={{ label: 'Tekrar dene', onPress: () => void config.refetch() }} />
                        : sdkMessage ? <Notice text={sdkMessage} />
                          : null}
                    {error ? <Notice tone="error" text={error} /> : null}
                    {message ? <Notice text={message} /> : null}
                    {canPurchase ? <FoilButton label={busy ? 'Ödeme doğrulanıyor…' : 'Ücret karşılığında engelimi kaldır'}
                      icon="credit-card" testID="account-appeal-purchase" busy={busy} disabled={busy} onPress={() => void purchase()} style={{ flex: 0, marginTop: 10 }} /> : null}
                  </View>
                ) : null}
              </>}
        <Pressable testID="appeal-notifications-link" accessibilityRole="link" onPress={() => router.push('/saved')} style={s.notifications}>
          <Feather name="bell" size={16} color={P.gold} />
          <Text style={[s.notificationsText, { color: P.gold }]}>Başvuru bildirimleri</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  content: { paddingBottom: 42 },
  loading: { height: 240, alignItems: 'center', justifyContent: 'center' },
  notice: { marginHorizontal: 18, marginTop: 12, padding: 16, gap: 9, borderWidth: 1, borderRadius: 18 },
  noticeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  noticeText: { fontFamily: F.body, fontSize: 15, lineHeight: 22 },
  meta: { fontFamily: F.body, fontSize: 13, lineHeight: 19 },
  status: { marginHorizontal: 18, marginTop: 12, padding: 15, gap: 9, borderWidth: 1, borderRadius: 16 },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusTitle: { flex: 1, fontFamily: F.semi, fontSize: 15, lineHeight: 20 },
  fee: { marginHorizontal: 18, marginTop: 12, padding: 16, gap: 7, borderWidth: 1, borderRadius: 18 },
  feeLabel: { fontFamily: F.semi, fontSize: 13 },
  feeValue: { fontFamily: F.serifBold, fontSize: 28 },
  notifications: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, padding: 12 },
  notificationsText: { fontFamily: F.semi, fontSize: 14 },
});
