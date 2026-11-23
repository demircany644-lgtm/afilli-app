import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { requestLibraryGifUpload, completeLibraryGifUpload, type MessageGif } from '@workspace/api-client-react';

export const MAX_LIBRARY_GIF_BYTES = 5 * 1024 * 1024;
export type PickedLibraryGif = { clientId: string; title: string; uri: string; size: number; error?: string; blob?: Blob };
export async function chooseLibraryGifs(): Promise<PickedLibraryGif[]> {
  // quality=1 and no editing are essential: Android otherwise flattens GIFs.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 20, quality: 1, allowsEditing: false,
  });
  if (result.canceled) return [];
  if (result.assets.length > 20) throw Error('Bir seferde en fazla 20 GIF seçebilirsin.');
  const selected: PickedLibraryGif[] = [];
  for (const asset of result.assets) {
    const clientId = randomUUID(), title = (asset.fileName ?? 'Afilli GIF').replace(/\.gif$/i, '').trim().slice(0, 120) || 'Afilli GIF';
    const item: PickedLibraryGif = { clientId, title, uri: asset.uri, size: asset.fileSize ?? 0 };
    try {
      if (item.size > MAX_LIBRARY_GIF_BYTES) throw Error('GIF en fazla 5 MB olabilir.');
      if (asset.width > 2000 || asset.height > 2000) throw Error('GIF boyutları en fazla 2000×2000 piksel olabilir.');
      if (Platform.OS === 'web') {
        item.blob = asset.file ?? await (await expoFetch(asset.uri)).blob();
        item.size = item.blob.size;
        item.uri = URL.createObjectURL(item.blob);
      } else {
        if (new File(asset.uri).size > MAX_LIBRARY_GIF_BYTES) throw Error('GIF en fazla 5 MB olabilir.');
        const dir = new Directory(Paths.cache, 'afilli-gif-uploads');
        dir.create({ intermediates: true, idempotent: true });
        const target = new File(dir, clientId + '.gif');
        await new File(asset.uri).copy(target);
        item.uri = target.uri; item.size = target.size;
      }
      if (item.size < 1 || item.size > MAX_LIBRARY_GIF_BYTES) throw Error('GIF en fazla 5 MB olabilir.');
      const header = Platform.OS === 'web' ? new Uint8Array(await item.blob!.slice(0, 10).arrayBuffer())
        : (await new File(item.uri).bytes()).subarray(0, 10);
      if (!['GIF87a', 'GIF89a'].includes(Array.from(header.subarray(0, 6), b => String.fromCharCode(b)).join(''))) throw Error('Bu dosya gerçek bir GIF değil.');
      const width = header[6] | header[7] << 8, height = header[8] | header[9] << 8;
      if (!width || !height || width > 2000 || height > 2000) throw Error('GIF boyutları en fazla 2000×2000 piksel olabilir.');
    } catch (e) { item.error = e instanceof Error ? e.message : 'GIF dosyası açılamadı.'; }
    selected.push(item);
  }
  return selected;
}
export async function uploadLibraryGif(item: PickedLibraryGif, options: RequestInit, isCurrent: () => boolean): Promise<MessageGif> {
  const check = () => { if (!isCurrent() || options.signal?.aborted) throw Error('Hesap veya ekran değişti.'); };
  check();
  if (item.error) throw Error(item.error);
  const upload = await requestLibraryGifUpload({ clientId: item.clientId, title: item.title, size: item.size }, options);
  check();
  if (!upload.ready) {
    if (!upload.uploadUrl) throw Error('GIF yükleme bağlantısı alınamadı.');
    const body = Platform.OS === 'web' ? item.blob : new File(item.uri);
    if (!body) throw Error('GIF dosyasını yeniden seç.');
    let response: Response;
    try { response = await expoFetch(upload.uploadUrl, { method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'image/gif' }, body, signal: options.signal }); }
    catch { throw Error('GIF yüklenemedi. Aynı dosyada tekrar dene.'); }
    if (!response.ok) throw Error('GIF yüklenemedi. Aynı dosyada tekrar dene.');
    check();
  }
  return completeLibraryGifUpload(upload.id, options);
}
export async function releaseLibraryGif(item: PickedLibraryGif) {
  if (Platform.OS === 'web') { if (item.uri.startsWith('blob:')) URL.revokeObjectURL(item.uri); }
  else { const file = new File(item.uri); if (file.exists && item.uri.includes('/afilli-gif-uploads/')) await file.delete(); }
}
