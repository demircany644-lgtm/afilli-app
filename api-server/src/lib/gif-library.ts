import sharp from 'sharp';
import { pool, type PoolClient } from '@workspace/db';
import type { MessageGif } from '@workspace/api-zod';
import { objectStorageClient } from './bulletin-storage';
import { fail, uuid } from './community';

export const MAX_GIF_BYTES = 5 * 1024 * 1024;
export function libraryGifObject(id: string, kind: 'source' | 'asset') {
  uuid(id);
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw Error('GIF depolaması yapılandırılmadı.');
  const [bucket, ...parts] = `${directory}/gif-library/${id}/${kind}`.replace(/^\/+/, '').split('/');
  return objectStorageClient.bucket(bucket!).file(parts.join('/'));
}
export async function libraryGifUploadUrl(id: string) {
  const file = libraryGifObject(id, 'source');
  const res = await fetch('http://127.0.0.1:1106/object-storage/signed-object-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket_name: file.bucket.name, object_name: file.name, method: 'PUT', expires_at: new Date(Date.now() + 900_000).toISOString() }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw Error('GIF yükleme bağlantısı alınamadı.');
  return (await res.json() as { signed_url: string }).signed_url;
}
export type GifRecord = { id: string; title: string; width: number; height: number };
export function libraryGif(row: GifRecord): MessageGif {
  // Stable URI identity, not a URL supplied by the sender or an expiring signed URL.
  const uri = `afilli://gif-library/${row.id}`;
  return { provider: 'afilli', id: row.id, title: row.title, width: row.width, height: row.height, url: uri, sourceUrl: uri, attribution: 'Afilli GIF', license: null };
}
export async function resolveLibraryGif(gif: MessageGif, db: PoolClient): Promise<MessageGif> {
  const id = uuid(gif.id);
  const row = (await db.query<GifRecord>('SELECT id,title,width,height FROM gif_library WHERE id=$1 AND ready', [id])).rows[0];
  if (!row) return fail(422, 'Bu GIF koleksiyonda bulunamadı.');
  // Ignore ALL client-supplied URLs, attribution, title and dimensions.
  return libraryGif(row);
}
export async function validateGifBytes(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_GIF_BYTES || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return fail(400, 'En fazla 5 MB olan gerçek bir GIF dosyası seç.');
  try {
    const image = sharp(bytes, { animated: true, limitInputPixels: 20_000_000, failOn: 'warning' });
    const meta = await image.metadata(), width = meta.width ?? 0, pages = meta.pages ?? 1;
    const height = meta.pageHeight ?? meta.height ?? 0;
    if (meta.format !== 'gif' || width < 1 || height < 1 || width > 2000 || height > 2000 || pages > 200 || width * height * pages > 20_000_000) throw Error('limits');
    // Decode every frame, not just the header. Preserve original animated bytes.
    await image.stats();
    return { width, height };
  } catch { return fail(400, 'GIF bozuk veya çözünürlük/kare sınırını aşıyor. Daha küçük bir GIF seç.'); }
}
export async function assertGifLibrarySchema() {
  if (!(await pool.query("SELECT to_regclass('gif_library') IS NOT NULL AS ok")).rows[0]?.ok) throw Error('GIF collection schema missing. Apply the additive development schema; use Publish for managed production.');
}
