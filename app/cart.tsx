import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyStoreCartQueryKey, getGetMyStoreOrdersQueryKey, useCreateStoreOrder,
  useGetMyStoreCart, useGetMyStoreOrders, useRemoveStoreCartItem, useUpdateStoreCartItem,
} from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import colors from '@/constants/colors';
import { F, tap } from '@/components/ui';
import { StoreProductImage } from '@/components/store/StoreProductImage';
import { StoreHeader } from '@/components/store/StoreHeader';
import { storeMoney } from '@/components/store/store-format';
import { actorRequest, scoped, useOwnerGuard, withIdentity } from '@/components/profile/hooks';
import { apiError } from '@/components/bulletins/common';
import type { StoreOrderStatus } from '@workspace/api-client-react';

const statusLabel: Record<StoreOrderStatus, string> = {
  pending: 'Beklemede',
  payment_pending: 'Ödeme bekleniyor',
  approved_free: 'Ücretsiz onaylandı',
  rejected: 'Reddedildi',
};

function CartScreen() {
  const P = colors.store;
  const { ready, userId } = useCommunity();
  const qc = useQueryClient();
  const alive = useOwnerGuard(userId);
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = actorRequest(userId);
  const cartKey = scoped(getGetMyStoreCartQueryKey(), userId);
  const ordersKey = scoped(getGetMyStoreOrdersQueryKey(), userId);
  const cart = useGetMyStoreCart({ request, query: { enabled: ready && !!userId, queryKey: cartKey, staleTime: 0 } });
  const orders = useGetMyStoreOrders({ request, query: { enabled: ready && !!userId, queryKey: ordersKey, refetchInterval: 20_000 } });
  const update = useUpdateStoreCartItem({ request });
  const remove = useRemoveStoreCartItem({ request });
  const create = useCreateStoreOrder({ request });

  const refreshCart = async () => { if (userId) await qc.invalidateQueries({ queryKey: cartKey }); };
  const quantity = async (productId: string, amount: number) => {
    if (!userId || busyProduct) return;
    setBusyProduct(productId); setError('');
    try {
      const row = cart.data?.items.find((item) => item.product.id === productId);
      if (row && row.quantity + amount <= 0) await remove.mutateAsync({ productId });
      else if (row) await update.mutateAsync({ productId, data: { quantity: row.quantity + amount } });
      await refreshCart();
    } catch (e) { if (alive()) setError(apiError(e, 'Sepet güncellenemedi.')); }
    finally { if (alive()) setBusyProduct(null); }
  };
  const submitOrder = async () => {
    if (!userId || !cart.data?.items.length || submitting) return;
    setSubmitting(true); setError(''); setNotice('');
    try {
      await create.mutateAsync();
      await Promise.all([
        qc.invalidateQueries({ queryKey: cartKey }),
        qc.invalidateQueries({ queryKey: ordersKey }),
      ]);
      if (alive()) setNotice('Talebin yöneticiye gönderildi. Bu işlemde ödeme alınmadı.');
    } catch (e) { if (alive()) setError(apiError(e, 'Sipariş talebi gönderilemedi.')); }
    finally { if (alive()) setSubmitting(false); }
  };

  return (
    <View style={[s.screen, { backgroundColor: P.bg }]}>
      <StoreHeader title="Sepetim" backFallback="/store" />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={[s.caption, { color: P.muted }]}>Sepetindeki ürünler ve yöneticinin yanıtladığı sipariş talepleri.</Text>
        {notice ? <View style={[s.notice, { borderColor: P.gold }]}><Feather name="check-circle" color={P.gold} size={17} /><Text style={[s.noticeText, { color: P.goldLight }]}>{notice}</Text></View> : null}
        {error ? <Text accessibilityRole="alert" style={[s.error, { color: P.danger }]}>{error}</Text> : null}

        <Text style={[s.heading, { color: P.goldLight }]}>Sepet</Text>
        {cart.isLoading ? <ActivityIndicator color={P.gold} style={{ marginVertical: 25 }} />
          : cart.isError ? <Text style={[s.caption, { color: P.muted }]}>{apiError(cart.error, 'Sepet yüklenemedi.')}</Text>
            : !cart.data?.items.length ? <View testID="cart-empty" style={[s.empty, { borderColor: P.border }]}>
              <Feather name="shopping-bag" size={24} color={P.gold} />
              <Text style={[s.emptyText, { color: P.muted }]}>Sepetinde ürün yok.</Text>
              <Pressable testID="cart-go-store" onPress={() => { tap(); router.push('/store'); }} style={[s.shopButton, { borderColor: P.gold }]}>
                <Text style={[s.shopText, { color: P.goldLight }]}>Mağazaya git</Text>
              </Pressable>
            </View>
              : <View style={{ gap: 10 }}>
                {cart.data.items.map((item) => (
                  <View key={item.product.id} testID={`cart-item-${item.product.id}`} style={[s.item, { borderColor: P.border, backgroundColor: P.card }]}>
                    <View style={s.image}><StoreProductImage imageKey={item.product.imageKey} /></View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[s.productName, { color: P.text }]} numberOfLines={2}>{item.product.name}</Text>
                      <Text style={[s.productMeta, { color: P.muted }]}>{storeMoney(item.product.priceKurus)} · {item.product.sizeLabel}</Text>
                      <View style={s.counter}>
                        <Pressable testID={`cart-minus-${item.product.id}`} accessibilityLabel="Adedi azalt" disabled={busyProduct === item.product.id} onPress={() => void quantity(item.product.id, -1)} style={[s.countButton, { borderColor: P.border }]}><Feather name="minus" size={14} color={P.goldLight} /></Pressable>
                        <Text style={[s.count, { color: P.text }]}>{item.quantity}</Text>
                        <Pressable testID={`cart-plus-${item.product.id}`} accessibilityLabel="Adedi artır" disabled={busyProduct === item.product.id || item.quantity >= 99} onPress={() => void quantity(item.product.id, 1)} style={[s.countButton, { borderColor: P.border }]}><Feather name="plus" size={14} color={P.goldLight} /></Pressable>
                        {busyProduct === item.product.id ? <ActivityIndicator size="small" color={P.gold} /> : null}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 10 }}>
                      <Text style={[s.subtotal, { color: P.goldLight }]}>{storeMoney(item.subtotalKurus)}</Text>
                      <Pressable testID={`cart-remove-${item.product.id}`} accessibilityLabel="Ürünü kaldır" disabled={busyProduct === item.product.id} onPress={() => void quantity(item.product.id, -item.quantity)} hitSlop={8}>
                        <Feather name="trash-2" size={17} color={P.danger} />
                      </Pressable>
                    </View>
                  </View>
                ))}
                <View style={[s.totalRow, { borderColor: P.border }]}>
                  <Text style={[s.totalLabel, { color: P.text }]}>Toplam</Text>
                  <Text testID="cart-total" style={[s.total, { color: P.goldLight }]}>{storeMoney(cart.data.totalKurus)}</Text>
                </View>
                <Text style={[s.caption, { color: P.muted }]}>Sipariş talebi oluşturulur; bu aşamada ödeme veya satın alma yapılmaz.</Text>
                <Pressable testID="cart-submit-order" accessibilityRole="button" accessibilityState={{ busy: submitting, disabled: submitting || !userId }}
                  disabled={submitting || !userId} onPress={() => void submitOrder()} style={[s.submit, { backgroundColor: P.gold }]}>
                  {submitting ? <ActivityIndicator color={P.bg} /> : <Feather name="send" size={16} color={P.bg} />}
                  <Text style={[s.submitText, { color: P.bg }]}>{submitting ? 'Gönderiliyor…' : 'Sipariş talebi gönder'}</Text>
                </Pressable>
              </View>}

        <Text style={[s.heading, { color: P.goldLight, marginTop: 26 }]}>Sipariş Taleplerim</Text>
        {orders.isLoading ? <ActivityIndicator color={P.gold} style={{ marginVertical: 20 }} />
          : orders.isError ? <Text style={[s.caption, { color: P.muted }]}>{apiError(orders.error, 'Sipariş geçmişi yüklenemedi.')}</Text>
            : !orders.data?.items.length ? <Text testID="orders-empty" style={[s.caption, { color: P.muted }]}>Henüz sipariş talebin yok.</Text>
              : <View style={{ gap: 10 }}>
                {orders.data.items.map((order) => (
                  <View key={order.id} testID={`my-store-order-${order.id}`} style={[s.order, { borderColor: P.border, backgroundColor: P.card }]}>
                    <View style={s.orderTop}>
                      <Text style={[s.orderStatus, { color: order.status === 'rejected' ? P.danger : P.goldLight }]}>{statusLabel[order.status]}</Text>
                      <Text style={[s.productMeta, { color: P.muted }]}>{new Date(order.createdAt).toLocaleDateString('tr-TR')}</Text>
                    </View>
                    {order.items.map((item) => <View key={item.productId} style={s.orderItem}>
                      <Text style={[s.productMeta, { color: P.text, flex: 1 }]}>{item.name} × {item.quantity}</Text>
                      <Text style={[s.productMeta, { color: P.goldLight }]}>{storeMoney(item.priceKurus * item.quantity)}</Text>
                    </View>)}
                    <View style={s.orderTop}><Text style={[s.productMeta, { color: P.muted }]}>Toplam</Text><Text style={[s.orderStatus, { color: P.goldLight }]}>{storeMoney(order.totalKurus)}</Text></View>
                    {order.status === 'payment_pending' ? <Text style={[s.caption, { color: P.muted }]}>Ödeme alınmadı; ödeme sağlayıcısı henüz bağlı değil.</Text> : null}
                    {order.decisionNote ? <Text style={[s.caption, { color: P.muted }]}>Yönetici notu: {order.decisionNote}</Text> : null}
                  </View>
                ))}
              </View>}
      </ScrollView>
    </View>
  );
}

export default withIdentity(CartScreen);

const s = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 44, gap: 10 },
  caption: { fontFamily: F.body, fontSize: 13, lineHeight: 19 },
  heading: { fontFamily: F.serifBold, fontSize: 21, marginTop: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  noticeText: { flex: 1, fontFamily: F.semi, fontSize: 13, lineHeight: 18 },
  error: { fontFamily: F.med, fontSize: 13, lineHeight: 18 },
  empty: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 9, borderWidth: 1, borderRadius: 14, padding: 15 },
  emptyText: { fontFamily: F.body, fontSize: 14 },
  shopButton: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  shopText: { fontFamily: F.semi, fontSize: 13 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderRadius: 14 },
  image: { width: 78, height: 72, borderRadius: 9, overflow: 'hidden' },
  productName: { fontFamily: F.serifBold, fontSize: 14, lineHeight: 18 },
  productMeta: { fontFamily: F.body, fontSize: 12, lineHeight: 17 },
  subtotal: { fontFamily: F.serifBold, fontSize: 14 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 },
  countButton: { width: 25, height: 25, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  count: { fontFamily: F.semi, fontSize: 13, minWidth: 14, textAlign: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 13 },
  totalLabel: { fontFamily: F.semi, fontSize: 16 },
  total: { fontFamily: F.serifBold, fontSize: 20 },
  submit: { minHeight: 48, borderRadius: 24, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitText: { fontFamily: F.semi, fontSize: 14 },
  order: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  orderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderStatus: { fontFamily: F.semi, fontSize: 14 },
  orderItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
