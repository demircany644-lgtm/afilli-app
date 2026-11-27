import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';
import type { ProfileUpload, ProfileUploadInput } from '@workspace/api-client-react';
import { profileCropRect, type ProfileCropSpec } from '@/lib/profile-crop';

export type ProfilePurpose = 'avatar' | 'cover';
const MAX = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type ImgType = typeof TYPES[number];

export type PickedImage = { uri: string; mimeType: ImgType; size: number; width: number; height: number };

export class ProfileMediaPermissionError extends Error {
  constructor(message: string, readonly canAskAgain: boolean) { super(message); this.name = 'ProfileMediaPermissionError'; }
}

export async function pickProfileImage(source: 'library' | 'camera', _purpose: ProfilePurpose): Promise<PickedImage | null> {
  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : Platform.OS === 'web' ? null : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm && !perm.granted) {
    throw new ProfileMediaPermissionError(source === 'camera'
      ? perm.canAskAgain ? 'Kamera izni verilmedi. Tekrar izin verebilir veya Ayarlar’dan açabilirsin.' : 'Kamera izni kapalı. Ayarlar’dan izin verip tekrar dene.'
      : perm.canAskAgain ? 'Galeri izni verilmedi. Tekrar izin verebilir veya Ayarlar’dan açabilirsin.' : 'Galeri izni kapalı. Ayarlar’dan izin verip tekrar dene.',
      perm.canAskAgain);
  }
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'], allowsEditing: false, quality: 1,
  };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  let size = asset.fileSize ?? 0;
  let type = asset.mimeType ?? '';
  if (Platform.OS === 'web') {
    const blob = await (await fetch(asset.uri)).blob();
    size = blob.size; type = type || blob.type;
  } else if (!size) {
    size = new File(asset.uri).size ?? 0;
  }
  if (!type) type = 'image/jpeg';
  if (!TYPES.includes(type as ImgType)) throw new Error('JPEG, PNG veya WebP bir fotoğraf seç.');
  if (!size || size > MAX) throw new Error('Fotoğraf en fazla 10 MB olabilir.');
  if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
    throw new Error('Fotoğrafın boyutları okunamadı. Başka bir fotoğraf seç.');
  }
  return { uri: asset.uri, mimeType: type as ImgType, size, width: asset.width, height: asset.height };
}

/** Applies the exact crop shown in the cross-platform preview before the existing upload flow starts. */
export async function cropProfileImage(img: PickedImage, purpose: ProfilePurpose, spec: ProfileCropSpec): Promise<PickedImage> {
  const crop = profileCropRect(img.width, img.height, purpose, spec);
  const actions: Action[] = [];
  if (spec.rotation) actions.push({ rotate: spec.rotation });
  actions.push({ crop: { originX: crop.x, originY: crop.y, width: crop.width, height: crop.height } });
  if (Math.max(crop.width, crop.height) > 1600) {
    actions.push(crop.width >= crop.height ? { resize: { width: 1600 } } : { resize: { height: 1600 } });
  }
  const result = await manipulateAsync(img.uri, actions, { compress: 0.88, format: SaveFormat.JPEG });
  let size: number;
  if (Platform.OS === 'web') size = (await (await fetch(result.uri)).blob()).size;
  else size = new File(result.uri).size ?? 0;
  if (!size || size > MAX) throw new Error('Kırpılmış fotoğraf 10 MB sınırını aşıyor.');
  return { uri: result.uri, mimeType: 'image/jpeg', size, width: result.width, height: result.height };
}

/** requestUpload is the generated mutation's mutateAsync (carries the actor header). */
export async function uploadProfileImage(
  img: PickedImage, purpose: ProfilePurpose,
  requestUpload: (v: { data: ProfileUploadInput }) => Promise<ProfileUpload>,
): Promise<string> {
  const upload = await requestUpload({ data: { purpose, contentType: img.mimeType, size: img.size } });
  const body = Platform.OS === 'web' ? await (await fetch(img.uri)).blob() : new File(img.uri);
  const r = await expoFetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': img.mimeType }, body });
  if (!r.ok) throw new Error('Fotoğraf yüklenemedi, tekrar dene.');
  return upload.id;
}
