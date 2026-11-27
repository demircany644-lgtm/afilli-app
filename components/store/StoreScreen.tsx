import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyStoreCartQueryKey, getGetStoreCatalogQueryKey, useAddStoreCartItem,
  useGetMyStoreCart, useGetStoreCatalog,
} from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import colors from '@/constants/colors';
import { StoreProductImage } from './StoreProductImage';
import { StoreHeader } from './StoreHeader';
import { storeMoney } from './store-format';
import { apiError } from '@/components/bulletins/common';
import { actorRequest, scoped } from '@/components/profile/hooks';
import { F, tap } from '@/components/ui';

const CATEGORIES = [
  { id: 'perfume', label: 'Parfüm', icon: 'wind' },
  { id: 'accessory', label: 'Aksesuar', icon: 'watch' },
  { id: 'gift', label: 'Hediyeler', icon: 'gift' },
  { id: 'other', label: 'Diğer Ürünler', icon: 'package' },
] as const;


export function StoreScreen() {
  const P = colors.store;
  const { width } = useWindowDimensions();
  const { ready, userId } = useCommunity();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>('perfume');
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const actor = actorRequest(userId);
  const catalog = useGetStoreCatalog({ request: actor, query: {
    enabled: ready, queryKey: scoped(getGetStoreCatalogQueryKey(), userId), staleTime: 30_000,
  } });
  const cart = useGetMyStoreCart({ request: actor, query: {
    enabled: ready && !!userId, queryKey: scoped(getGetMyStoreCartQueryKey(), userId), staleTime: 0,
  } });
  const add = useAddStoreCartItem({ request: actor });
  const products = useMemo(() => (catalog.data?.products ?? []).filter((p) => p.category === category), [catalog.data?.products, category]);
  const cardWidth = Math.max(140, Math.floor((Math.min(width, 620) - 44) / 2));

  const addProduct = async (productId: string) => {
    if (!userId || busyProduct) return;
    setBusyProduct(productId); setMessage('');
    try {
      await add.mutateAsync({ data: { productId } });
      await qc.invalidateQueries({ queryKey: scoped(getGetMyStoreCartQueryKey(), userId) });
      setMessage('Ürün sepetine eklendi.');
    } catch (e) { setMessage(apiError(e, 'Ürün sepete eklenemedi. Yeniden dene.')); }
    finally { setBusyProduct(null); }
  };

  return (
    <View style={[s.screen, { backgroundColor: P.bg }]}>
      <StoreHeader title="Mağazam" backFallback="/" right={
        <Pressable testID="store-open-cart" accessibilityRole="button" accessibilityLabel={`Sepetim${cart.data?.items.length ? `, ${cart.data.items.length} ürün` : ''}`}
          onPress={() => { tap(); router.push('/cart'); }} style={s.cartButton}>
          <Feather name="shopping-cart" size={21} color={P.goldLight} />
          {cart.data?.items.length ? <View style={[s.cartBadge, { backgroundColor: P.gold }]}><Text style={[s.cartBadgeText, { color: P.bg }]}>{cart.data.items.length}</Text></View> : null}
        </Pressable>
      } />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 44 }} showsVerticalScrollIndicator={false}>
        <View testID="store-status-banner" style={[s.notice, { borderColor: P.gold, backgroundColor: P.card }]}>
          <View style={[s.noticeIcon, { borderColor: P.gold }]}><Feather name={catalog.data?.active ? 'info' : 'alert-circle'} size={25} color={P.gold} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[s.noticeTitle, { color: P.goldLight }]}>{catalog.data?.active ? 'Mağaza talepleri açık' : 'Bu menü şu anda aktif değil!'}</Text>
            <Text style={[s.noticeText, { color: P.text }]}>{catalog.data?.active
              ? 'Sipariş talepleri yönetici tarafından incelenir.'
              : 'En kısa sürede hizmete açılacaktır.'}</Text>
          </View>
        </View>
        <Text style={[s.disclaimer, { color: P.muted }]}>Şu anda ödeme alınmaz. Sepete ürün ekleyebilir ve yöneticiye ödeme gerektirmeyen bir sipariş talebi gönderebilirsin.</Text>
        {ready && !userId ? <Pressable testID="store-sign-in" onPress={() => { tap(); router.push('/sign-in'); }} style={[s.signIn, { borderColor: P.border }]}>
          <Text style={[s.signInText, { color: P.goldLight }]}>Sepet için giriş yap</Text><Feather name="chevron-right" size={16} color={P.goldLight} />
        </Pressable> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoryRow}>
          {CATEGORIES.map((item) => {
            const selected = category === item.id;
            return (
              <Pressable key={item.id} testID={`store-category-${item.id}`} accessibilityRole="tab" accessibilityState={{ selected }}
                onPress={() => { tap(); setCategory(item.id); }} style={[s.category, { borderColor: selected ? P.gold : P.border, backgroundColor: selected ? P.raised : P.card }]}>
                <Feather name={item.icon as keyof typeof Feather.glyphMap} size={16} color={selected ? P.goldLight : P.muted} />
                <Text style={[s.categoryText, { color: selected ? P.goldLight : P.text }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {message ? <Text accessibilityRole="alert" style={[s.message, { color: add.isError ? P.danger : P.goldLight }]}>{message}</Text> : null}
        {catalog.isLoading ? <View style={s.loading}><ActivityIndicator color={P.gold} /><Text style={[s.muted, { color: P.muted }]}>Ürünler yükleniyor…</Text></View>
          : catalog.isError ? <View style={s.empty}><Feather name="wifi-off" size={24} color={P.gold} /><Text style={[s.emptyTitle, { color: P.text }]}>Mağaza açılamadı</Text><Text style={[s.muted, { color: P.muted }]}>{apiError(catalog.error, 'Bağlantını kontrol edip yeniden dene.')}</Text>
              <Pressable testID="store-retry" onPress={() => void catalog.refetch()} style={[s.retry, { borderColor: P.gold }]}><Text style={[s.retryText, { color: P.goldLight }]}>Tekrar dene</Text></Pressable></View>
            : products.length === 0 ? <View testID={`store-empty-${category}`} style={s.empty}><Feather name="package" size={24} color={P.gold} /><Text style={[s.emptyTitle, { color: P.text }]}>{CATEGORIES.find((x) => x.id === category)?.label}</Text><Text style={[s.muted, { color: P.muted }]}>Bu kategoride henüz ürün bulunmuyor.</Text></View>
              : <View style={s.grid}>
                {products.map((product) => (
                  <View key={product.id} testID={`store-product-${product.id}`} style={[s.product, { width: cardWidth, borderColor: P.border, backgroundColor: P.card }]}>
                    <View style={s.productPhoto}><StoreProductImage imageKey={product.imageKey} testID={`store-product-image-${product.id}`} /></View>
                    <View style={s.productCopy}>
                      <Text numberOfLines={2} style={[s.productName, { color: P.text }]}>{product.name}</Text>
                      <Text style={[s.productMeta, { color: P.muted }]}>{product.productType} · {product.sizeLabel}</Text>
                      <View style={s.productBottom}>
                    <Text style={[s.price, { color: P.goldLight }]}>{storeMoney(product.priceKurus)}</Text>
                        <Pressable testID={`store-add-${product.id}`} accessibilityRole="button" accessibilityLabel={`${product.name}, ${storeMoney(product.priceKurus)}, sepete ekle`}
                          disabled={busyProduct === product.id || !ready || !userId} onPress={() => void addProduct(product.id)}
                          style={({ pressed }) => [s.addButton, { borderColor: P.gold, opacity: busyProduct === product.id ? 0.65 : pressed ? 0.78 : 1 }]}>
                          {busyProduct === product.id ? <ActivityIndicator size="small" color={P.goldLight} /> : <Feather name="shopping-cart" size={14} color={P.goldLight} />}
                          <Text style={[s.addText, { color: P.goldLight }]}>{busyProduct === product.id ? 'Ekleniyor' : 'Sepete Ekle'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </View>}

        <Pressable testID="store-personal-showcase" accessibilityRole="link" onPress={() => { tap(); router.push('/storefront'); }}
          style={[s.personalLink, { borderColor: P.border }]}>
          <Feather name="book-open" size={16} color={P.gold} />
          <Text style={[s.personalText, { color: P.muted }]}>Kişisel eser vitrinin</Text>
          <Feather name="chevron-right" size={17} color={P.gold} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  cartButton: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  cartBadge: { position: 'absolute', right: 0, top: 0, minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  cartBadgeText: { fontFamily: F.semi, fontSize: 10 },
  notice: { flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1.5, borderRadius: 15, padding: 14, marginTop: 4 },
  noticeIcon: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  noticeTitle: { fontFamily: F.serifBold, fontSize: 18 },
  noticeText: { fontFamily: F.body, fontSize: 13, lineHeight: 18 },
  disclaimer: { fontFamily: F.body, fontSize: 12, lineHeight: 17, marginHorizontal: 4, marginTop: 8 },
  signIn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, marginTop: 8 },
  signInText: { fontFamily: F.semi, fontSize: 12 },
  categoryRow: { gap: 8, paddingVertical: 14 },
  category: { minHeight: 40, paddingHorizontal: 13, borderWidth: 1, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 7 },
  categoryText: { fontFamily: F.semi, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  product: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', marginBottom: 2 },
  productPhoto: { height: 138, backgroundColor: colors.store.raised, overflow: 'hidden' },
  productCopy: { padding: 10, gap: 5 },
  productName: { fontFamily: F.serifBold, fontSize: 14, lineHeight: 18, minHeight: 36 },
  productMeta: { fontFamily: F.body, fontSize: 11 },
  productBottom: { gap: 7, marginTop: 2 },
  price: { fontFamily: F.serifBold, fontSize: 18 },
  addButton: { minHeight: 34, borderWidth: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 7 },
  addText: { fontFamily: F.semi, fontSize: 11 },
  loading: { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
  empty: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 18 },
  emptyTitle: { fontFamily: F.serifBold, fontSize: 19 },
  muted: { fontFamily: F.body, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  message: { fontFamily: F.semi, fontSize: 13, marginVertical: 6 },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderRadius: 18, marginTop: 4 },
  retryText: { fontFamily: F.semi, fontSize: 13 },
  personalLink: { marginTop: 20, minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 4 },
  personalText: { flex: 1, fontFamily: F.med, fontSize: 13 },
});
