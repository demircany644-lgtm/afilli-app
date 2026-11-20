import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File, Directory, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestDirectPhotoUpload, completeDirectPhotoUpload } from '@workspace/api-client-react';
import type { LocalChatPhoto, OutboxEntry } from './chat-drafts';

function directory(owner: string) { return new Directory(Paths.document, 'afilli-chat-photos', encodeURIComponent(owner)); }
function file(owner: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Fotoğraf kaydı geçersiz.');
  return new File(directory(owner), id + '.jpg');
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('afilli-private-chat-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error('Fotoğraf cihazda saklanamadı.'));
  });
}
async function webPhoto(owner: string, id: string, action: 'get' | 'put' | 'delete', value?: Blob): Promise<Blob | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', action === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('photos'), key = owner + ':' + id;
      const r = action === 'get' ? store.get(key) : action === 'put' ? store.put(value, key) : store.delete(key);
      tx.oncomplete = () => resolve(action === 'get' ? r.result as Blob | undefined : undefined);
      tx.onerror = () => reject(Error('Fotoğraf cihazda saklanamadı.'));
      tx.onabort = () => reject(Error('Fotoğraf cihazda saklanamadı.'));
    });
  } finally { db.close(); }
}
export async function chooseChatPhoto(owner: string): Promise<LocalChatPhoto | null> {
  // The current SDK's system photo picker grants access to the chosen image;
  // do not require broad library access (or reject limited-access users).
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  if (asset.width * asset.height > 40_000_000) throw Error('Daha küçük çözünürlüklü bir fotoğraf seç.');
  const resized = await manipulateAsync(asset.uri, [{ resize: asset.width >= asset.height ? { width: Math.min(1280, asset.width) } : { height: Math.min(1280, asset.height) } }],
    { compress: 0.74, format: SaveFormat.JPEG });
  const localId = randomUUID();
  if (await AsyncStorage.getItem('afilli:account-deleted:v1:' + owner)) throw Error('Bu hesap silindi.');
  let size: number;
  if (Platform.OS === 'web') {
    const blob = await (await expoFetch(resized.uri)).blob(); size = blob.size;
    if (size > 2097152) throw Error('Sıkıştırılan fotoğraf 2 MB sınırını aşıyor. Daha küçük bir fotoğraf seç.');
    await webPhoto(owner, localId, 'put', blob);
  } else {
    const dir = directory(owner); dir.create({ intermediates: true, idempotent: true });
    const target = file(owner, localId);
    await new File(resized.uri).copy(target);
    size = target.size;
    if (size < 1 || size > 2097152) { await target.delete(); throw Error('Daha küçük bir fotoğraf seç.'); }
  }
  if (await AsyncStorage.getItem('afilli:account-deleted:v1:' + owner)) {
    await queueChatPhotoCleanup(owner, { localId, size, width: resized.width, height: resized.height });
    await drainChatPhotoCleanup(owner);
    throw Error('Bu hesap silindi.');
  }
  return { localId, size, width: resized.width, height: resized.height };
}
export async function chatPhotoPreview(owner: string, photo: LocalChatPhoto): Promise<{ uri: string; release: () => void }> {
  if (Platform.OS !== 'web') return { uri: file(owner, photo.localId).uri, release() {} };
  const blob = await webPhoto(owner, photo.localId, 'get');
  if (!blob) throw Error('Fotoğraf bu cihazda bulunamadı. Yeniden seç.');
  const uri = URL.createObjectURL(blob);
  return { uri, release: () => URL.revokeObjectURL(uri) };
}
export async function prepareChatPhoto(owner: string, thread: string, entry: OutboxEntry, options: RequestInit): Promise<string | null> {
  if (entry.photoId) return entry.photoId;
  if (!entry.photo) return null;
  const upload = await requestDirectPhotoUpload(thread, { clientId: entry.clientId, size: entry.photo.size }, options);
  if (!upload.ready) {
    const body = Platform.OS === 'web' ? await webPhoto(owner, entry.photo.localId, 'get') : file(owner, entry.photo.localId);
    if (!body || !upload.uploadUrl) throw Error('Fotoğraf bu cihazda bulunamadı. Yeniden seç.');
    const response = await expoFetch(upload.uploadUrl, { method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'image/jpeg' }, body, signal: options.signal });
    if (!response.ok) throw Error('Fotoğraf yüklenemedi. Aynı gönderimi tekrar deneyebilirsin.');
    await completeDirectPhotoUpload(upload.id, options);
  }
  return upload.id;
}
const cleanupKey = (owner: string, id: string) => `afilli:chat-photo-cleanup:${owner}:${id}`;
/** Record cleanup before acknowledging the durable outbox. Retrying a confirmed send no longer needs these bytes. */
export async function queueChatPhotoCleanup(owner: string, photo: LocalChatPhoto) {
  await AsyncStorage.setItem(cleanupKey(owner, photo.localId), photo.localId);
}
export async function drainChatPhotoCleanup(owner: string) {
  const prefix = `afilli:chat-photo-cleanup:${owner}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
  for (const key of keys) {
    const id = key.slice(prefix.length);
    if (Platform.OS === 'web') await webPhoto(owner, id, 'delete');
    else { const f = file(owner, id); if (f.exists) await f.delete(); }
    await AsyncStorage.removeItem(key);
  }
}
export async function purgeOwnerChatPhotos(owner: string) {
  if (Platform.OS !== 'web') { const dir = directory(owner); if (dir.exists) await dir.delete(); }
  else {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite'), r = tx.objectStore('photos').openCursor();
        r.onsuccess = () => { const c = r.result; if (c) { if (String(c.key).startsWith(owner + ':')) c.delete(); c.continue(); } };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(Error('Özel fotoğraflar temizlenemedi.'));
      });
    } finally { db.close(); }
  }
  await drainChatPhotoCleanup(owner);
}
/** No disk cache for received photos. A decoded memory URI is released with its component/session. */
export function photoBlobUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('Fotoğraf açılamadı.')); reader.readAsDataURL(blob);
  });
}
