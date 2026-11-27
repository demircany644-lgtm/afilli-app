import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminStoreProductsQueryKey, getGetStoreCatalogQueryKey,
  useGetAdminStoreProducts, useRequestAdminStoreProductUpload,
  useCompleteAdminStoreProductUpload, useCreateAdminStoreProduct,
  type StoreProduct,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { apiError } from '@/components/bulletins/common';
import { FoilButton, Notice, StateCard, useKitStyles } from '@/components/profile/kit';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { actorRequest, scoped, useOwnerGuard } from '@/components/profile/hooks';
import { pickStoreProductImage, storeProductImageBody, type PickedStoreProductImage } from '@/lib/store-product-images';
import { StoreProductImage } from '@/components/store/StoreProductImage';
import { storeMoney } from '@/components/store/store-format';

const CATEGORIES: { value: StoreProduct['category']; label: string }[] = [
  { value: 'perfume', label: 'Parfüm' },
  { value: 'accessory', label: 'Aksesuar' },
  { value: 'gift', label: 'Hediyeler' },
  { value: 'other', label: 'Diğer Ürünler' },
];

function priceToKurus(text: string) {
  const input = text.trim().replace(/\s/g, '');
  const raw = input.includes(',')
    ? input.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:\.\d{3})+$/.test(input) ? input.replace(/\./g, '') : input;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? Math.round(value * 100) : null;
}

export function AdminStoreProducts({ userId }: { userId: string }) {
  const { magazine: P } = useTheme();
  const st = useStyles();
  const k = useKitStyles();
  const qc = useQueryClient();
  const alive = useOwnerGuard(userId);
  const listKey = scoped(getGetAdminStoreProductsQueryKey(), userId);
  const products = useGetAdminStoreProducts({ request: actorRequest(userId), query: { queryKey: listKey, enabled: !!userId } });
  const requestUpload = useRequestAdminStoreProductUpload({ request: actorRequest(userId) });
  const completeUpload = useCompleteAdminStoreProductUpload({ request: actorRequest(userId) });
  const createProduct = useCreateAdminStoreProduct({ request: actorRequest(userId) });
  const lock = useRef(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StoreProduct['category']>('accessory');
  const [productType, setProductType] = useState('');
  const [sizeLabel, setSizeLabel] = useState('');
  const [price, setPrice] = useState('');
  const [picked, setPicked] = useState<PickedStoreProductImage | null>(null);
  const [uploadClientId, setUploadClientId] = useState('');
  const [uploadedImageKey, setUploadedImageKey] = useState('');
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const chooseImage = async () => {
    if (picking || saving) return;
    setPicking(true); setError('');
    try {
      const next = await pickStoreProductImage();
      if (alive() && next) {
        setPicked(next); setUploadClientId(randomUUID()); setUploadedImageKey('');
      }
    } catch (e) { if (alive()) setError(apiError(e, 'Ürün görseli seçilemedi.')); }
    finally { if (alive()) setPicking(false); }
  };

  const submit = async () => {
    if (lock.current || saving) return;
    const cleanName = name.trim(), cleanType = productType.trim(), cleanSize = sizeLabel.trim();
    const priceKurus = priceToKurus(price);
    if (cleanName.length < 2 || cleanName.length > 120) { setError('Ürün adı 2–120 karakter olmalı.'); return; }
    if (!cleanType || cleanType.length > 80) { setError('Ürün türünü gir.'); return; }
    if (!cleanSize || cleanSize.length > 60) { setError('Boyut veya ürün ölçüsünü gir.'); return; }
    if (priceKurus == null) { setError('Fiyatı TL olarak gir. Örnek: 2499,90'); return; }
    if (!picked) { setError('Ürün için bir fotoğraf seç.'); return; }
    lock.current = true; setSaving(true); setError(''); setNotice('');
    try {
      let imageKey = uploadedImageKey;
      if (!imageKey) {
        const clientId = uploadClientId || randomUUID();
        if (!uploadClientId) setUploadClientId(clientId);
        const body = await storeProductImageBody(picked);
        if (!alive()) return;
        const upload = await requestUpload.mutateAsync({ data: { clientId, contentType: 'image/jpeg', size: picked.size } });
        if (!alive()) return;
        const response = await putStoreProductImage(upload.uploadUrl, body, picked.size);
        if (!response.ok) throw Error('Ürün görseli yüklenemedi. Yeniden dene.');
        if (!alive()) return;
        const complete = await completeUpload.mutateAsync({ id: upload.id });
        if (!alive()) return;
        imageKey = complete.imageKey;
        setUploadedImageKey(imageKey);
      }
      await createProduct.mutateAsync({ data: {
        name: cleanName, category, productType: cleanType, sizeLabel: cleanSize,
        priceKurus, imageKey,
      } });
      if (!alive()) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: listKey }),
        qc.invalidateQueries({ queryKey: getGetAdminStoreProductsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetStoreCatalogQueryKey() }),
      ]);
      setName(''); setProductType(''); setSizeLabel(''); setPrice(''); setPicked(null); setUploadClientId(''); setUploadedImageKey('');
      setNotice('Ürün mağaza kataloğuna eklendi.');
    } catch (e) { if (alive()) setError(apiError(e, 'Ürün eklenemedi. Bilgileri ve bağlantıyı kontrol et.')); }
    finally { lock.current = false; if (alive()) setSaving(false); }
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={[k.card, st.card]}>
        <Text accessibilityRole="header" style={st.heading}>Kataloğa ürün ekle</Text>
        <Text style={st.sub}>Gerçek ürün bilgilerini gir. Görsel yüklenmeden ve doğrulanmadan ürün yayımlanmaz.</Text>
        <View style={st.form}>
          <Text style={st.label}>Ürün kategorisi</Text>
          <View style={st.categories}>
            {CATEGORIES.map((item) => {
              const selected = category === item.value;
              return <Pressable key={item.value} testID={`admin-store-category-${item.value}`}
                accessibilityRole="button" accessibilityState={{ selected }}
                onPress={() => { tap(); setCategory(item.value); }}
                style={[st.category, { borderColor: selected ? P.gold : P.border, backgroundColor: selected ? P.input : P.card }]}>
                <Text style={[st.categoryText, { color: selected ? P.gold : P.text }]}>{item.label}</Text>
              </Pressable>;
            })}
          </View>
          <Field label="Ürün adı" value={name} onChangeText={setName} placeholder="Örnek: El yapımı kitap ayracı" testID="admin-store-product-name" />
          <Field label="Tür" value={productType} onChangeText={setProductType} placeholder="Örnek: Metal aksesuar" testID="admin-store-product-type" />
          <Field label="Boyut veya ölçü" value={sizeLabel} onChangeText={setSizeLabel} placeholder="Örnek: 12 cm" testID="admin-store-product-size" />
          <Field label="Fiyat (₺)" value={price} onChangeText={setPrice} placeholder="0,00" keyboardType="decimal-pad" testID="admin-store-product-price" />
          <View style={st.photoRow}>
            {picked ? <Image source={{ uri: picked.uri }} contentFit="cover" accessibilityLabel="Ürün görseli önizlemesi" style={st.preview} /> :
              <View style={[st.preview, st.photoEmpty, { borderColor: P.border }]}><Feather name="image" size={22} color={P.muted} /></View>}
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={st.label}>Ürün fotoğrafı</Text>
              <Text style={st.sub}>Galeriden seçilir, yüklemeden önce sıkıştırılır.</Text>
              <FoilButton variant="outline" icon="image" label={picking ? 'Fotoğraf açılıyor…' : picked ? 'Başka fotoğraf seç' : 'Fotoğraf seç'}
                testID="admin-store-product-image-pick" busy={picking} disabled={saving} onPress={() => void chooseImage()} />
            </View>
          </View>
          <Text style={st.sub}>Fiyat sunucuya doğrulanmış biçimde kaydedilir. Ürün eklemek ödeme veya satış başlatmaz.</Text>
          {error ? <Notice tone="error" text={error} testID="admin-store-product-error" /> : null}
          {notice ? <Notice text={notice} testID="admin-store-product-notice" /> : null}
          <FoilButton icon="plus" label={saving ? 'Ürün ekleniyor…' : 'Ürünü kataloğa ekle'}
            testID="admin-store-product-submit" busy={saving} disabled={saving || picking} onPress={() => void submit()} />
        </View>
      </View>

      <View style={[k.card, st.card]}>
        <View style={st.listHead}>
          <Text accessibilityRole="header" style={st.heading}>Mevcut ürünler</Text>
          {products.data ? <Text style={st.count}>{products.data.length}</Text> : null}
        </View>
        {products.isLoading && !products.data ? <ActivityIndicator color={P.gold} style={{ padding: 18 }} /> :
          products.isError && !products.data ? <StateCard icon="wifi-off" title="Katalog yüklenemedi" text={apiError(products.error, 'Bağlantıyı kontrol et.')} action={{ label: 'Yeniden dene', testID: 'admin-store-products-retry', onPress: () => void products.refetch() }} /> :
            products.data?.length ? products.data.map((product) => <View key={product.id} style={st.productRow} testID={`admin-store-product-${product.id}`}>
              <View style={st.productPhoto}><StoreProductImage imageKey={product.imageKey} /></View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text numberOfLines={2} style={st.productName}>{product.name}</Text>
                <Text style={st.sub}>{product.categoryLabel} · {product.productType} · {product.sizeLabel}</Text>
              </View>
              <Text style={st.productPrice}>{storeMoney(product.priceKurus)}</Text>
            </View>) : <StateCard icon="shopping-bag" title="Katalog boş" text="Yeni ürün eklediğinde burada görünür." testID="admin-store-products-empty" />}
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, testID, keyboardType = 'default' }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder: string;
  testID: string; keyboardType?: 'default' | 'decimal-pad';
}) {
  const { magazine: P } = useTheme();
  const st = useStyles();
  return <View style={{ gap: 5 }}>
    <Text style={st.label}>{label}</Text>
    <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChangeText}
      placeholder={placeholder} placeholderTextColor={P.muted} keyboardType={keyboardType}
      maxLength={keyboardType === 'default' ? 120 : 16} style={st.input} />
  </View>;
}

const putStoreProductImage = (url: string, body: Awaited<ReturnType<typeof storeProductImageBody>>, size: number) => {
  if (body.size !== size) return Promise.reject(Error('Ürün görselinin boyutu değişti. Yeniden seç.'));
  return expoFetch(url, { method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'image/jpeg' }, body });
};

const useStyles = makeStyles((t) => {
  const { magazine: P } = t;
  return StyleSheet.create({
    card: { marginHorizontal: 18, padding: 14, gap: 12 },
    heading: { fontFamily: F.serifBold, fontSize: 19, color: P.text },
    sub: { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: P.muted },
    form: { gap: 12 },
    label: { fontFamily: F.semi, fontSize: 13, color: P.text },
    categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    category: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderRadius: 18 },
    categoryText: { fontFamily: F.semi, fontSize: 12 },
    input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: P.border, backgroundColor: P.input, color: P.text, fontFamily: F.body, fontSize: 14 },
    photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 2 },
    preview: { width: 72, height: 92, borderRadius: 10, backgroundColor: P.input },
    photoEmpty: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
    listHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    count: { fontFamily: F.semi, fontSize: 12, color: P.gold },
    productRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border, paddingVertical: 10 },
    productPhoto: { width: 52, height: 62, overflow: 'hidden', borderRadius: 8, backgroundColor: P.input },
    productName: { fontFamily: F.semi, fontSize: 13, lineHeight: 17, color: P.text },
    productPrice: { fontFamily: F.serifBold, fontSize: 14, color: P.gold, textAlign: 'right' },
  });
});
