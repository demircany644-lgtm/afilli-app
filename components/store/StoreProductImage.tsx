import React from 'react';
import { Image, StyleSheet, type ImageStyle, type StyleProp } from 'react-native';
import { mediaUrl } from '@/components/bulletins/common';

const PRODUCT_IMAGES = {
  'bleu-de-chanel': require('@/assets/images/store/bleu-de-chanel.jpg'),
  'dior-sauvage': require('@/assets/images/store/dior-sauvage.jpg'),
  'miss-dior': require('@/assets/images/store/miss-dior.jpg'),
  'ysl-libre': require('@/assets/images/store/ysl-libre.jpg'),
} as const;

export function StoreProductImage({ imageKey, style, testID }: {
  imageKey: string; style?: StyleProp<ImageStyle>; testID?: string;
}) {
  if (imageKey.startsWith('upload:')) {
    const id = imageKey.slice('upload:'.length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return <Image testID={testID} source={{ uri: mediaUrl(`/api/store-product-media/${id}`) }}
      style={[styles.image, style]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  }
  const source = PRODUCT_IMAGES[imageKey as keyof typeof PRODUCT_IMAGES];
  if (!source) return null;
  return <Image testID={testID} source={source} style={[styles.image, style]} resizeMode="cover" accessibilityIgnoresInvertColors />;
}

const styles = StyleSheet.create({ image: { width: '100%', height: '100%' } as ImageStyle });
