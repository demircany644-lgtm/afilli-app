import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';
import { fetch as expoFetch } from 'expo/fetch';

const MAX_BYTES = 10 * 1024 * 1024;

export type PickedStoreProductImage = { uri: string; size: number; blob?: Blob };

export async function pickStoreProductImage(): Promise<PickedStoreProductImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  const source = result.assets[0];
  if (!source.width || !source.height || source.width > 10000 || source.height > 10000) {
    throw new Error('Görsel boyutları okunamadı veya çok büyük.');
  }
  const scale = Math.min(1, 1400 / source.width, 1800 / source.height);
  const actions: Action[] = [];
  if (scale < 1) {
    const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
    actions.push(source.width / source.height > 1400 / 1800 ? { resize: { width } } : { resize: { height } });
  }
  const optimized = await manipulateAsync(source.uri, actions, { compress: 0.84, format: SaveFormat.JPEG });
  let size = 0, blob: Blob | undefined;
  if (Platform.OS === 'web') {
    blob = await (await expoFetch(optimized.uri)).blob();
    size = blob.size;
  } else size = new File(optimized.uri).size ?? 0;
  if (!size || size > MAX_BYTES) throw new Error('Sıkıştırılmış görsel 10 MB sınırını aşıyor.');
  return { uri: optimized.uri, size, ...(blob ? { blob } : {}) };
}

export async function storeProductImageBody(image: PickedStoreProductImage): Promise<Blob | File> {
  if (Platform.OS === 'web') {
    const blob = image.blob ?? await (await expoFetch(image.uri)).blob();
    if (blob.size !== image.size) throw new Error('Ürün görseli değişti. Yeniden seç.');
    return blob;
  }
  const file = new File(image.uri);
  if (!file.exists || file.size !== image.size) throw new Error('Ürün görseli bulunamadı. Yeniden seç.');
  return file;
}
