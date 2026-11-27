import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';
// Canonical Replit sidecar authentication; never put account keys in the app.
export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit', subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`, type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: 'json', subject_token_field_name: 'access_token' },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});
type ImageFolder = 'bulletins' | 'profiles' | 'writer' | 'direct-messages' | 'moderation' | 'collections';
function imageObject(id: string, folder: ImageFolder) {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error('Fotoğraf depolaması yapılandırılmadı.');
  const parts = `${directory}/${folder}/${id}`.replace(/^\/+/, '').split('/');
  return objectStorageClient.bucket(parts.shift()!).file(parts.join('/'));
}
export const bulletinObject = (id: string) => imageObject(id, 'bulletins');
export const bulletinSourceObject = (id: string) => imageObject(`${id}/source`, 'bulletins');
export const bulletinCanonicalObject = (id: string) => imageObject(`${id}/image`, 'bulletins');
export const profileObject = (id: string) => imageObject(id, 'profiles');
export const profileSourceObject = (id: string) => imageObject(`${id}/source`, 'profiles');
export const profileCanonicalObject = (id: string) => imageObject(`${id}/image`, 'profiles');
export const writerObject = (id: string) => imageObject(id, 'writer');
export const directPhotoObject = (id: string) => imageObject(id, 'direct-messages');
export const moderationObject = (id: string) => imageObject(id, 'moderation');
export const collectionObject = (id: string) => imageObject(id, 'collections');
export const collectionUploadUrl = (id: string) => imageUploadUrl(`${id}/source`, 'collections');
export const directPhotoUploadUrl = (id: string, expiresAt: number) => signedImageUrl(`${id}/source`, 'direct-messages', 'PUT', 900_000, expiresAt);
export const moderationUploadUrl = (id: string) => imageUploadUrl(`sources/${id}`, 'moderation');
export const moderationImageAccessUrl = (id: string) => signedImageUrl(id, 'moderation', 'GET', 10 * 60_000);
export const bulletinUploadUrl = (id: string) => imageUploadUrl(`${id}/source`, 'bulletins');
export const profileUploadUrl = (id: string) => imageUploadUrl(`${id}/source`, 'profiles');
export const writerUploadUrl = (id: string) => imageUploadUrl(`${id}/source`, 'writer');
export const writerImageAccessUrl = (id: string) => signedImageUrl(`${id}/image`, 'writer', 'GET', 300_000);
async function imageUploadUrl(id: string, folder: ImageFolder) {
  return signedImageUrl(id, folder, 'PUT', 900_000);
}
async function signedImageUrl(id: string, folder: ImageFolder, method: 'GET' | 'PUT', lifetime: number, expiresAt?: number) {
  const file = imageObject(id, folder);
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket_name: file.bucket.name, object_name: file.name, method,
      expires_at: new Date(expiresAt ?? Date.now() + lifetime).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Fotoğraf yükleme bağlantısı oluşturulamadı.');
  const result = await response.json() as { signed_url: string };
  return result.signed_url;
}
export const prepareBulletinObject = (id: string, contentType: string, expectedSize: number, sourceUpload: boolean, sealed = false) =>
  prepareImageObject(id, contentType, expectedSize, sealed ? bulletinCanonicalObject(id) : sourceUpload ? bulletinSourceObject(id) : bulletinObject(id));
export const prepareProfileObject = (id: string, contentType: string, expectedSize: number, sourceUpload: boolean, sealed = false) =>
  prepareImageObject(id, contentType, expectedSize, sealed ? profileCanonicalObject(id) : sourceUpload ? profileSourceObject(id) : profileObject(id));
async function prepareImageObject(id: string, contentType: string, expectedSize: number, file: ReturnType<typeof imageObject>) {
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (size !== expectedSize || size < 1 || size > 10 * 1024 * 1024) throw new Error('Fotoğraf yüklemesi tamamlanmadı veya dosya boyutu geçersiz.');
  const [bytes] = await file.download();
  if (bytes.length !== expectedSize) throw new Error('Fotoğraf boyutu değişti.');
  const valid = contentType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : contentType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new Error('Geçerli bir JPEG, PNG veya WebP fotoğraf seçin.');
  const output = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, animated: false })
    .rotate().resize({ width: 1800, height: 2400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  if (!output.length || output.length > 10 * 1024 * 1024) throw new Error('Fotoğraf boyutu geçersiz.');
  return output;
}
