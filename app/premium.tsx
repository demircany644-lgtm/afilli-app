import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useCommunity } from '@/context/CommunityContext';
import { F, tap } from '@/components/ui';
import { apiError } from '@/components/bulletins/common';
import { MarbleBackground, Notice, SectionLabel, TopBar, useKitStyles, FoilButton } from '@/components/profile/kit';
import { actorRequest, scoped, goBack } from '@/components/profile/hooks';
import {
  useGetPremiumConfig, getGetPremiumConfigQueryKey, useGetMyPremium, getGetMyPremiumQueryKey,
  useCreatePremiumApplication, useVerifyPremiumPurchase, useRestorePremiumPurchase, useUpdatePremiumPreferences,
  type PremiumPreferencesInput,
} from '@workspace/api-client-react';
import { useTheme } from '@/hooks/useTheme';
import { purchasesSdk, type StorePackage } from '@/lib/revenuecat';

const BADGES = [
  { name: 'Afilli Başarılı Yazar', rule: 'En az 1 yayımlanmış kitap ve toplam 10.000 okuma.', icon: 'book-open' as const },
  { name: 'Afilli Usta Yazar', rule: 'En az 3 yayımlanmış kitap ve toplam 50.000 okuma.', icon: 'award' as const },
  { name: 'Afilli Popüler Yazar', rule: 'Son 30 günde en çok okunan ilk 10 yazar arasında olmak.', icon: 'trending-up' as const },
];
const OPTIONS: { key: keyof PremiumPreferencesInput; title: string; choices: string[] }[] = [
  { key: 'profileFrame', title: 'Profil çerçevesi', choices: ['classic', 'gold', 'rose', 'midnight'] },
  { key: 'profileBackground', title: 'Profil zemini', choices: ['classic', 'linen', 'wine', 'starlight'] },
  { key: 'chatEffect', title: 'Sohbet efekti', choices: ['none', 'gold', 'rose', 'violet'] },
  { key: 'storeDesign', title: 'Mağaza görünümü', choices: ['classic', 'gold', 'wine', 'night'] },
];
const LABELS: Record<string, string> = { classic: 'Klasik', gold: 'Altın', rose: 'Gül', midnight: 'Gece', linen: 'Keten', wine: 'Bordo', starlight: 'Yıldızlı', none: 'Kapalı', violet: 'Menekşe', night: 'Gece' };
const packageKey = (item: { packageIdentifier: string; productIdentifier: string; platform: string }) =>
  `${item.platform}:${item.packageIdentifier}:${item.productIdentifier}`;

export default function Premium() {
  const { magazine: P } = useTheme();
  const k = useKitStyles();
  const { ready, userId } = useCommunity();
  const qc = useQueryClient();
  const config = useGetPremiumConfig({ query: {
    enabled: ready && !!userId,
    queryKey: scoped(getGetPremiumConfigQueryKey(), userId),
  }, request: actorRequest(userId) });
  const account = useGetMyPremium({ query: { enabled: ready && !!userId, queryKey: scoped(getGetMyPremiumQueryKey(), userId), staleTime: 0, refetchOnMount: 'always', refetchInterval: 20_000 }, request: actorRequest(userId) });
  const create = useCreatePremiumApplication({ request: actorRequest(userId) });
  const verify = useVerifyPremiumPurchase({ request: actorRequest(userId) });
  const restore = useRestorePremiumPurchase({ request: actorRequest(userId) });
  const update = useUpdatePremiumPreferences({ request: actorRequest(userId) });
  const [selected, setSelected] = useState('');
  const [products, setProducts] = useState<StorePackage[]>([]);
  const [sdkMessage, setSdkMessage] = useState('');
  const [busyPurchase, setBusyPurchase] = useState(false);
  const [busyRestore, setBusyRestore] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const currentApp = account.data?.application;
  const premiumActive = !!account.data?.active;
  const packages = config.data?.packages ?? [];
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
  const publicKey = platform === 'ios' ? config.data?.iosPublicKey : platform === 'android' ? config.data?.androidPublicKey : null;

  useEffect(() => {
    if (!ready || !userId) return;
    if (!platform) { setSdkMessage('Satın alma yalnızca iOS ve Android uygulamalarında kullanılabilir.'); return; }
    if (!config.data?.configured || !publicKey) { setSdkMessage(config.data?.message || 'Satın alma kurulumu henüz tamamlanmamış.'); return; }
    let live = true;
    void (async () => {
      try {
        const sdk = await purchasesSdk(publicKey, userId);
        const offerings = await sdk.getOfferings();
        if (!live) return;
        setProducts(offerings.current?.availablePackages ?? []);
        setSdkMessage(offerings.current ? '' : 'Şu anda satın alınabilir bir plan bulunmuyor.');
      } catch {
        if (live) setSdkMessage('Mağaza bağlantısı kurulamadı. Uygulama içi satın alma bu cihazda kullanılamıyor.');
      }
    })();
    return () => { live = false; };
  }, [ready, userId, platform, config.data?.configured, config.data?.message, publicKey]);

  const packageRows = useMemo(() => packages.map((item) => {
    const match = products.find((p) => p.identifier === item.packageIdentifier && p.product.identifier === item.productIdentifier);
    return { item, match };
  }), [packages, products]);
  const selectedRow = packageRows.find((p) => packageKey(p.item) === selected);
  const canApply = !!selectedRow && !!platform && selectedRow.item.platform === platform;
  const matchingPaidPackage = currentApp?.status === 'paid_approved'
    ? packageRows.find((p) => p.item.packageIdentifier === currentApp.packageIdentifier
      && p.item.productIdentifier === currentApp.productIdentifier && p.item.platform === platform)?.match
    : undefined;
  const preferences = account.data?.preferences;

  const apply = async () => {
    if (!canApply || !selectedRow || !platform) return;
    setError(''); setMessage('');
    try {
      const result = await create.mutateAsync({ data: {
        packageIdentifier: selectedRow.item.packageIdentifier,
        productIdentifier: selectedRow.item.productIdentifier,
        platform,
      } });
      await qc.invalidateQueries({ queryKey: scoped(getGetMyPremiumQueryKey(), userId) });
      setMessage(result.status === 'paid_approved' ? 'Başvurun onaylandı. Satın alma adımına geçebilirsin.' : 'Başvurun alındı. Yönetici değerlendirmesini bekliyor.');
    } catch (e) { setError(apiError(e, 'Başvuru gönderilemedi. Yeniden deneyebilirsin.')); }
  };

  const purchase = async () => {
    if (!currentApp || currentApp.status !== 'paid_approved' || !matchingPaidPackage || !publicKey || !userId) return;
    setBusyPurchase(true); setError(''); setMessage('');
    try {
      const sdk = await purchasesSdk(publicKey, userId);
      await sdk.purchasePackage(matchingPaidPackage);
      const result = await verify.mutateAsync({ id: currentApp.id });
      qc.setQueryData(scoped(getGetMyPremiumQueryKey(), userId), result);
      setMessage(result.active ? 'Premium hesabın etkinleştirildi.' : 'Satın alma alındı; sunucu doğrulaması henüz Premium erişimini etkinleştirmedi.');
    } catch (e) { setError(apiError(e, 'Satın alma tamamlanamadı. Daha sonra yeniden deneyebilirsin.')); }
    finally { setBusyPurchase(false); }
  };

  const restorePurchase = async () => {
    if (!publicKey || !userId) return;
    setBusyRestore(true); setError(''); setMessage('');
    try {
      const sdk = await purchasesSdk(publicKey, userId);
      await sdk.restorePurchases();
      const result = await restore.mutateAsync();
      qc.setQueryData(scoped(getGetMyPremiumQueryKey(), userId), result);
      setMessage(result.active ? 'Etkin Premium satın alımın geri yüklendi.' : 'Mağazada etkin bir Premium satın alımı bulunamadı.');
    } catch (e) { setError(apiError(e, 'Satın alımlar geri yüklenemedi. Daha sonra yeniden deneyebilirsin.')); }
    finally { setBusyRestore(false); }
  };

  const savePreference = async (key: keyof PremiumPreferencesInput, value: string) => {
    if (!preferences || !premiumActive) return;
    const next = { profileFrame: preferences.profileFrame, profileBackground: preferences.profileBackground, chatEffect: preferences.chatEffect, storeDesign: preferences.storeDesign, [key]: value } as PremiumPreferencesInput;
    setError(''); setMessage('');
    try {
      const saved = await update.mutateAsync({ data: next });
      qc.setQueryData(scoped(getGetMyPremiumQueryKey(), userId), (old: typeof account.data | undefined) => old ? { ...old, preferences: saved } : old);
    } catch (e) { setError(apiError(e, 'Görünüm tercihi kaydedilemedi.')); }
  };

  const statusTitle = premiumActive ? 'Premium hesabın etkin' : currentApp?.status === 'pending' ? 'Başvurun inceleniyor' : currentApp?.status === 'paid_approved' ? 'Satın alma adımı hazır' : currentApp?.status === 'rejected' ? 'Başvuru sonuçlandı' : currentApp?.status === 'expired' ? 'Premium süren sona erdi' : 'Afilli Premium';

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <TopBar back title="Afilli Premium" />
        <View style={s.hero}>
          <View style={s.heroMark}><Feather name="feather" size={22} color={P.onAccent} /></View>
          <Text style={[s.eyebrow, { color: P.gold }]}>OKUR VE YAZAR İÇİN</Text>
          <Text style={[s.title, { color: P.text }]}>Afilli’de sana ait bir iz.</Text>
          <Text style={[s.copy, { color: P.muted }]}>Profilini, mağazanı ve sohbetlerini kendi tonunla düzenle. Yazar başarıları ise okur ilgisiyle otomatik belirlenir.</Text>
        </View>
        {!ready || (userId && account.isLoading) ? <View style={s.loading}>{[0, 1, 2].map(i => <View key={i} style={[s.skeleton, { backgroundColor: P.input }]} />)}</View>
          : !userId ? <Notice text="Premium başvurusu ve hesap durumu için giriş yapman gerekiyor." />
          : account.isError ? <Notice tone="error" text={apiError(account.error, 'Premium hesabı yüklenemedi.')} action={{ label: 'Tekrar dene', onPress: () => void account.refetch() }} />
          : <View style={[s.statusCard, { backgroundColor: P.card, borderColor: P.gold }]}>
            <View style={s.statusHead}><Feather name={premiumActive ? 'check-circle' : 'clock'} size={20} color={P.gold} /><Text style={[s.statusTitle, { color: P.text }]}>{statusTitle}</Text></View>
            {currentApp ? <Text style={[s.meta, { color: P.muted }]}>{currentApp.planName} · {new Date(currentApp.createdAt).toLocaleDateString('tr-TR')}</Text> : <Text style={[s.meta, { color: P.muted }]}>Henüz Premium başvurusu yok.</Text>}
            {currentApp?.status === 'pending' ? <Text style={[s.note, { color: P.muted }]}>Başvurun değerlendiriliyor. Onaylandığında burada yeni bir durum göreceksin.</Text> : null}
            {currentApp?.status === 'paid_approved' ? <Text style={[s.note, { color: P.muted }]}>Ödeme adımı yönetici onayından sonra açıldı. Premium yalnızca sunucu doğrulamasıyla etkinleşir.</Text> : null}
            {currentApp?.status === 'rejected' ? <Text style={[s.note, { color: P.muted }]}>Başvurun onaylanmadı. Yeni başvuru için mevcut durumunu yöneticiyle görüşebilirsin.</Text> : null}
            {premiumActive && account.data?.expiresAt ? <Text style={[s.meta, { color: P.muted }]}>Bitiş: {new Date(account.data.expiresAt).toLocaleDateString('tr-TR')}</Text> : null}
            {currentApp?.status === 'paid_approved' ? (
              matchingPaidPackage ? <FoilButton label={busyPurchase ? 'Satın alma doğrulanıyor…' : 'Satın al'} icon="credit-card" testID="premium-purchase" busy={busyPurchase} onPress={() => void purchase()} style={{ flex: 0, marginTop: 12 }} />
                : <Notice text={sdkMessage || 'Bu başvuruya ait eşleşen güncel mağaza teklifi bulunamadı; satın alma kullanılamıyor.'} />
            ) : null}
            {currentApp && ['paid_approved', 'active', 'expired'].includes(currentApp.status) && publicKey ? (
              <FoilButton label={busyRestore ? 'Satın alımlar aranıyor…' : 'Satın alımları geri yükle'} icon="rotate-ccw" testID="premium-restore" busy={busyRestore} onPress={() => void restorePurchase()} style={{ flex: 0, marginTop: 8 }} />
            ) : null}
          </View>}
        {error ? <Notice tone="error" text={error} /> : null}
        {message ? <Notice text={message} /> : null}
        <SectionLabel>Planlar</SectionLabel>
        {config.isLoading ? <View style={s.loading}>{[0, 1].map(i => <View key={i} style={[s.skeleton, { backgroundColor: P.input }]} />)}</View>
          : config.isError ? <Notice tone="error" text={apiError(config.error, 'Plan bilgileri yüklenemedi.')} action={{ label: 'Tekrar dene', onPress: () => void config.refetch() }} />
          : packages.length === 0 ? <Notice text={config.data?.message || 'Şu anda başvuruya açık bir plan bulunmuyor.'} />
          : <View style={s.planList}>{packageRows.map(({ item, match }) => {
            const key = packageKey(item);
            const selectedPlan = selected === key;
            const available = !!platform && item.platform === platform && !!match;
            return (
              <Pressable key={key} testID={'premium-plan-' + key} accessibilityRole="radio" accessibilityState={{ selected: selectedPlan, disabled: !available }} disabled={!available || !!currentApp && !['rejected', 'expired'].includes(currentApp.status)}
                onPress={() => { tap(); setSelected(key); }} style={[s.plan, { backgroundColor: P.card, borderColor: selectedPlan ? P.gold : P.border, opacity: available ? 1 : 0.62 }]}>
                <View style={[s.radio, { borderColor: selectedPlan ? P.gold : P.border }]}>{selectedPlan ? <View style={[s.radioDot, { backgroundColor: P.gold }]} /> : null}</View>
                <View style={{ flex: 1, gap: 4 }}><Text style={[s.planName, { color: P.text }]}>{item.productName}</Text><Text style={[s.meta, { color: P.muted }]}>{item.platform === 'ios' ? 'iOS' : 'Android'} · {match?.product.priceString ?? (platform !== item.platform ? 'Bu cihazla uyumlu değil' : 'Güncel mağaza teklifi bulunamadı')}</Text></View>
                {selectedPlan ? <Feather name="check" size={18} color={P.gold} /> : null}
              </Pressable>
            );
          })}</View>}
        {config.data?.configured && !platform ? <Notice text="Planlar ve başvurular görüntülenebilir; satın alma iOS veya Android uygulamasında yapılabilir." /> : null}
        {config.data && !config.data.configured ? <Notice text={config.data.message || 'Satın alma kurulumu tamamlanmamış.'} /> : null}
        {!currentApp || ['rejected', 'expired'].includes(currentApp.status) ? <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <FoilButton label={create.isPending ? 'Başvuru gönderiliyor…' : 'Premium için başvur'} icon="arrow-right" testID="premium-apply" busy={create.isPending} disabled={!userId || !canApply} onPress={() => void apply()} style={{ flex: 0 }} />
        </View> : null}
        {premiumActive ? <>
          <SectionLabel>Görünüm tercihleri</SectionLabel>
          {preferences ? OPTIONS.map((option) => (
            <View key={option.key} style={[s.preference, { backgroundColor: P.card, borderColor: P.border }]}>
              <Text style={[s.planName, { color: P.text }]}>{option.title}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingTop: 9 }}>
                {option.choices.map((choice) => {
                  const selectedChoice = preferences[option.key] === choice;
                  return <Pressable key={choice} testID={`premium-pref-${option.key}-${choice}`} accessibilityRole="radio" accessibilityState={{ selected: selectedChoice }} onPress={() => void savePreference(option.key, choice)}
                    style={[s.choice, { borderColor: selectedChoice ? P.gold : P.border, backgroundColor: selectedChoice ? P.input : P.card }]}><Text style={[s.choiceText, { color: selectedChoice ? P.text : P.muted }]}>{LABELS[choice] ?? choice}</Text></Pressable>;
                })}
              </ScrollView>
              {update.isPending ? <ActivityIndicator size="small" color={P.gold} style={{ alignSelf: 'flex-start', marginTop: 8 }} /> : null}
            </View>
          )) : null}
        </> : null}
        <SectionLabel>Yazar başarıları</SectionLabel>
        <Text style={[s.note, { color: P.muted, marginHorizontal: 20, marginTop: -5, marginBottom: 10 }]}>Bu rozetler sistem tarafından otomatik verilir. Başvuru veya manuel onay gerekmez.</Text>
        {BADGES.map((badge) => <View key={badge.name} style={[s.badge, { backgroundColor: P.card, borderColor: P.border }]}><View style={[s.badgeIcon, { backgroundColor: P.input }]}><Feather name={badge.icon} size={17} color={P.gold} /></View><View style={{ flex: 1 }}><Text style={[s.planName, { color: P.text }]}>{badge.name}</Text><Text style={[s.meta, { color: P.muted }]}>{badge.rule}</Text></View></View>)}
        <Pressable testID="premium-back" accessibilityRole="button" onPress={() => goBack('/')} style={s.backLink}><Text style={[s.linkText, { color: P.gold }]}>Afilli’ye dön</Text></Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20, alignItems: 'flex-start' },
  heroMark: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#8F2435', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  eyebrow: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1.7, marginBottom: 7 },
  title: { fontFamily: F.serifBold, fontSize: 30, lineHeight: 37, maxWidth: 340 },
  copy: { fontFamily: F.body, fontSize: 15, lineHeight: 22, marginTop: 9, maxWidth: 440 },
  loading: { paddingHorizontal: 20, gap: 10 },
  skeleton: { height: 68, borderRadius: 16, opacity: 0.65 },
  statusCard: { marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderRadius: 18, padding: 16, gap: 9 },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusTitle: { fontFamily: F.semi, fontSize: 17, flex: 1 },
  planList: { paddingHorizontal: 20, gap: 9 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, borderWidth: 1, borderRadius: 16, padding: 14 },
  radio: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  planName: { fontFamily: F.semi, fontSize: 15 },
  meta: { fontFamily: F.body, fontSize: 12, lineHeight: 17 },
  note: { fontFamily: F.body, fontSize: 13, lineHeight: 19 },
  preference: { marginHorizontal: 20, marginBottom: 9, borderWidth: 1, borderRadius: 16, padding: 14 },
  choice: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7 },
  choiceText: { fontFamily: F.med, fontSize: 12 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginBottom: 8, borderRadius: 15, borderWidth: 1, padding: 13 },
  badgeIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  backLink: { alignSelf: 'center', padding: 18, marginTop: 4 },
  linkText: { fontFamily: F.semi, fontSize: 14 },
});
