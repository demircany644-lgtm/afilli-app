import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool, type PoolClient } from '@workspace/db';
import type { AdminStoreProductCreateInput, AdminStoreProductUploadInput, StoreProduct } from '@workspace/api-zod';
import { objectStorageClient } from './bulletin-storage';
import { assertStoreSchema, publicStoreProduct } from './store-orders';
import { fail, uuid } from './community';

const SIDECAR = 'http://127.0.0.1:1106';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
type UploadRow = { id: string; ownerId: string; contentType: string; size: number; ready: boolean };
type ProductRow = Omit<StoreProduct, 'categoryLabel' | 'currency' | 'priceKurus'> & { priceKurus: number | string };

export function storeProductObject(id: string, kind: 'source' | 'asset') {
  uuid(id);
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw Error('Ürün görseli depolaması yapılandırılmadı.');
  const [bucket, ...parts] = `${directory}/store-products/${id}/${kind}`.replace(/^\/+/, '').split('/');
  return objectStorageClient.bucket(bucket!).file(parts.join('/'));
}

async function signedStoreProductUpload(id: string) {
  const file = storeProductObject(id, 'source');
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket_name: file.bucket.name, object_name: file.name, method: 'PUT',
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Error('Ürün görseli yükleme bağlantısı oluşturulamadı.');
  return (await response.json() as { signed_url: string }).signed_url;
}

export function storeProductUploadUrl(id: string) {
  return signedStoreProductUpload(uuid(id));
}

export async function requestStoreProductUpload(db: PoolClient, ownerId: string, input: AdminStoreProductUploadInput) {
  await assertStoreSchema(db);
  if (!IMAGE_TYPES.has(input.contentType) || input.size < 1 || input.size > MAX_UPLOAD_BYTES) {
    return fail(400, 'JPEG, PNG veya WebP ürün görseli en fazla 10 MB olabilir.');
  }
  const previous = (await db.query<UploadRow>(`SELECT id,owner_id AS "ownerId",content_type AS "contentType",
    size,ready FROM store_product_uploads WHERE owner_id=$1 AND client_id=$2 FOR UPDATE`, [ownerId, input.clientId])).rows[0];
  if (previous && (previous.contentType !== input.contentType || Number(previous.size) !== input.size)) {
    return fail(409, 'Bu yükleme kimliği başka bir görsel için kullanılmış.');
  }
  const id = previous?.id ?? randomUUID();
  if (!previous) {
    await db.query(`INSERT INTO store_product_uploads(id,owner_id,client_id,object_path,content_type,size)
      VALUES($1,$2,$3,$4,$5,$6)`, [id, ownerId, input.clientId, `store-products/${id}`, input.contentType, input.size]);
  }
  return { id };
}

export async function completeStoreProductUpload(db: PoolClient, ownerId: string, rawId: string) {
  await assertStoreSchema(db);
  const id = uuid(rawId);
  const row = (await db.query<UploadRow>(`SELECT id,owner_id AS "ownerId",content_type AS "contentType",
    size,ready FROM store_product_uploads WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!row || row.ownerId !== ownerId) return fail(404, 'Ürün görseli yüklemesi bulunamadı.');
  if (row.ready) return { id, imageKey: `upload:${id}` };
  if (!IMAGE_TYPES.has(row.contentType) || Number(row.size) > MAX_UPLOAD_BYTES) return fail(400, 'Ürün görseli geçersiz.');
  const source = storeProductObject(id, 'source');
  let bytes: Buffer;
  try {
    const [metadata] = await source.getMetadata();
    if (Number(metadata.size) !== Number(row.size) || Number(row.size) > MAX_UPLOAD_BYTES) {
      return fail(400, 'Yüklenen görselin boyutu kaydedilen bilgiyle eşleşmiyor.');
    }
    [bytes] = await source.download({ start: 0, end: MAX_UPLOAD_BYTES - 1 });
  } catch (error) {
    if (typeof error === 'object' && error && 'status' in error) throw error;
    return fail(400, 'Görsel henüz yüklenmedi. Yeniden dene.');
  }
  if (bytes.length !== Number(row.size)) return fail(400, 'Yüklenen görselin boyutu geçersiz.');
  let optimized: Buffer;
  let outputWidth = 0, outputHeight = 0;
  try {
    const input = sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 });
    const originalMetadata = await input.metadata();
    const expected = row.contentType === 'image/jpeg' ? 'jpeg' : row.contentType === 'image/png' ? 'png' : 'webp';
    if (originalMetadata.format !== expected || !originalMetadata.width || !originalMetadata.height
      || originalMetadata.width > 6000 || originalMetadata.height > 6000
      || originalMetadata.width * originalMetadata.height > 40_000_000) return fail(400, 'Seçilen dosya gerçek ve geçerli bir ürün görseli değil.');
    optimized = await sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 })
      .rotate().resize({ width: 1400, height: 1800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    const outputMetadata = await sharp(optimized).metadata();
    outputWidth = outputMetadata.width ?? 0; outputHeight = outputMetadata.height ?? 0;
  } catch { return fail(400, 'Görsel okunamadı. Geçerli bir JPEG, PNG veya WebP seç.'); }
  await storeProductObject(id, 'asset').save(optimized, {
    resumable: false, contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  });
  await db.query('UPDATE store_product_uploads SET ready=true,width=$2,height=$3 WHERE id=$1',
    [id, outputWidth, outputHeight]);
  return { id, imageKey: `upload:${id}` };
}

export async function getAdminStoreProducts() {
  await assertStoreSchema();
  const rows = await pool.query<ProductRow>(`SELECT id,name,category,product_type AS "productType",
    size_label AS "sizeLabel",price_kurus AS "priceKurus",image_key AS "imageKey"
    FROM store_products ORDER BY display_order,created_at,id`);
  return rows.rows.map(publicStoreProduct);
}

export async function createStoreProduct(db: PoolClient, adminId: string, input: AdminStoreProductCreateInput) {
  await assertStoreSchema(db);
  const name = input.name.trim(), productType = input.productType.trim(), sizeLabel = input.sizeLabel.trim();
  if (name.length < 2 || name.length > 120 || !productType || productType.length > 80 || !sizeLabel || sizeLabel.length > 60) {
    return fail(400, 'Ürün adı, türü ve boyutunu kontrol et.');
  }
  const uploadId = uuid(input.imageKey.slice('upload:'.length));
  const upload = (await db.query<UploadRow>(`SELECT id,owner_id AS "ownerId",content_type AS "contentType",
    size,ready FROM store_product_uploads WHERE id=$1 FOR UPDATE`, [uploadId])).rows[0];
  if (!upload || upload.ownerId !== adminId || !upload.ready) return fail(400, 'Ürün görseli önce yüklenip doğrulanmalı.');

  const existing = (await db.query<ProductRow>(`SELECT id,name,category,product_type AS "productType",
    size_label AS "sizeLabel",price_kurus AS "priceKurus",image_key AS "imageKey"
    FROM store_products WHERE image_key=$1`, [input.imageKey])).rows[0];
  if (existing) {
    const same = existing.name === name && existing.category === input.category
      && existing.productType === productType && existing.sizeLabel === sizeLabel
      && Number(existing.priceKurus) === input.priceKurus;
    if (!same) return fail(409, 'Bu görsel daha önce başka bir ürün kaydında kullanılmış.');
    return publicStoreProduct(existing);
  }
  const id = `product-${randomUUID()}`;
  const displayOrder = Number((await db.query<{ next: number }>(
    'SELECT coalesce(max(display_order),0)+10 AS next FROM store_products')).rows[0].next);
  const result = await db.query<ProductRow>(`INSERT INTO store_products
    (id,name,category,product_type,size_label,price_kurus,image_key,display_order,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id,name,category,product_type AS "productType",size_label AS "sizeLabel",
      price_kurus AS "priceKurus",image_key AS "imageKey"`,
  [id, name, input.category, productType, sizeLabel, input.priceKurus, input.imageKey, displayOrder, adminId]);
  return publicStoreProduct(result.rows[0]);
}

export async function productImageIsListed(id: string) {
  await assertStoreSchema();
  const result = await pool.query(`SELECT 1 FROM store_products p JOIN store_product_uploads u
    ON p.image_key='upload:'||u.id::text WHERE u.id=$1 AND u.ready`, [uuid(id)]);
  return !!result.rowCount;
}
