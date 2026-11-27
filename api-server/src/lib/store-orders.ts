import { pool, type PoolClient } from '@workspace/db';
import type { AdminStoreOrder, StoreCart, StoreCatalog, StoreOrder, StoreOrderItem, StoreOrderStatus, StoreProduct } from '@workspace/api-zod';
import { fail, transaction } from './community';

type Db = PoolClient | typeof pool;

type ProductRow = Omit<StoreProduct, 'categoryLabel' | 'currency' | 'priceKurus'> & { priceKurus: number | string };
const CATEGORY_LABEL: Record<StoreProduct['category'], string> = {
  perfume: 'Parfüm', accessory: 'Aksesuar', gift: 'Hediyeler', other: 'Diğer Ürünler',
};
const PRODUCT_COLUMNS = `id,name,category,product_type AS "productType",size_label AS "sizeLabel",
  price_kurus AS "priceKurus",image_key AS "imageKey"`;
export function publicStoreProduct(row: ProductRow): StoreProduct {
  return { ...row, category: row.category as StoreProduct['category'], categoryLabel: CATEGORY_LABEL[row.category as StoreProduct['category']],
    priceKurus: Number(row.priceKurus), currency: 'TRY' };
}

export async function assertStoreSchema(db: Pick<Db, 'query'> = pool) {
  const result = await db.query(`SELECT
    to_regclass('store_settings') IS NOT NULL AND to_regclass('store_cart_items') IS NOT NULL
    AND to_regclass('store_orders') IS NOT NULL AND to_regclass('store_order_items') IS NOT NULL
    AND to_regclass('store_products') IS NOT NULL AND to_regclass('store_product_uploads') IS NOT NULL AS ok`);
  if (!result.rows[0]?.ok) return fail(503, 'Mağaza veri yapısı henüz hazırlanmadı. Yöneticiye bildirildi.');
}

export async function storeIsActive(db: Db = pool): Promise<boolean> {
  const result = await db.query<{ active: boolean }>('SELECT active FROM store_settings WHERE id=true');
  return result.rows[0]?.active ?? false;
}

export async function catalog(): Promise<StoreCatalog> {
  await assertStoreSchema();
  const products = await pool.query<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM store_products
    ORDER BY display_order,created_at,id`);
  return { active: await storeIsActive(), products: products.rows.map(publicStoreProduct) };
}

export async function cartFor(userId: string, db: Db = pool): Promise<StoreCart> {
  await assertStoreSchema(db);
  const result = await db.query<ProductRow & { quantity: number }>(`SELECT ${PRODUCT_COLUMNS},c.quantity
    FROM store_cart_items c JOIN store_products p ON p.id=c.product_id
    WHERE c.user_id=$1 ORDER BY c.created_at,c.product_id`, [userId]);
  const items = result.rows.map((row) => {
    const product = publicStoreProduct(row);
    return { product, quantity: Number(row.quantity), subtotalKurus: product.priceKurus * Number(row.quantity) };
  });
  return { items, totalKurus: items.reduce((sum, item) => sum + item.subtotalKurus, 0) };
}

export async function addCartItem(userId: string, productId: string) {
  await assertStoreSchema();
  if (!(await pool.query('SELECT 1 FROM store_products WHERE id=$1', [productId])).rowCount) return fail(404, 'Ürün artık mevcut değil.');
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`store-cart:${userId}`]);
    const result = await db.query<{ quantity: number }>(`INSERT INTO store_cart_items(user_id,product_id,quantity)
      VALUES($1,$2,1) ON CONFLICT(user_id,product_id) DO UPDATE
      SET quantity=least(store_cart_items.quantity+1,99),updated_at=clock_timestamp()
      RETURNING quantity`, [userId, productId]);
    if (result.rows[0]?.quantity > 99) return fail(409, 'Bir üründen en fazla 99 adet eklenebilir.');
  });
  return cartFor(userId);
}

export async function updateCartItem(userId: string, productId: string, quantity: number) {
  await assertStoreSchema();
  if (!(await pool.query('SELECT 1 FROM store_products WHERE id=$1', [productId])).rowCount) return fail(404, 'Ürün artık mevcut değil.');
  const result = await pool.query(`UPDATE store_cart_items SET quantity=$3,updated_at=clock_timestamp()
    WHERE user_id=$1 AND product_id=$2`, [userId, productId, quantity]);
  if (!result.rowCount) return fail(404, 'Ürün sepetinde bulunamadı.');
  return cartFor(userId);
}

export async function removeCartItem(userId: string, productId: string) {
  await assertStoreSchema();
  await pool.query('DELETE FROM store_cart_items WHERE user_id=$1 AND product_id=$2', [userId, productId]);
  return cartFor(userId);
}

type OrderRow = StoreOrder & { userId?: string; nickname?: string; avatar?: string | null };
const orderRows = `SELECT o.id,o.status,o.total_kurus AS "totalKurus",o.decision_note AS "decisionNote",
  o.created_at AS "createdAt",o.updated_at AS "updatedAt",
  json_agg(json_build_object('productId',i.product_id,'name',i.name,'category',i.category,
    'productType',i.product_type,'sizeLabel',i.size_label,'priceKurus',i.price_kurus,
    'imageKey',i.image_key,'quantity',i.quantity) ORDER BY i.id) AS items`;

function normalizeOrder(row: OrderRow): OrderRow {
  return {
    ...row,
    totalKurus: Number(row.totalKurus),
    items: row.items.map((item: StoreOrderItem) => ({ ...item, priceKurus: Number(item.priceKurus), quantity: Number(item.quantity) })),
  };
}

export async function myOrders(userId: string): Promise<{ items: StoreOrder[] }> {
  await assertStoreSchema();
  const result = await pool.query<OrderRow>(`${orderRows}
    FROM store_orders o JOIN store_order_items i ON i.order_id=o.id
    WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC,o.id DESC LIMIT 50`, [userId]);
  return { items: result.rows.map(normalizeOrder) };
}

export async function createOrder(userId: string): Promise<StoreOrder> {
  await assertStoreSchema();
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`store-cart:${userId}`]);
    const rows = await db.query<ProductRow & { quantity: number }>(`SELECT ${PRODUCT_COLUMNS},c.quantity
      FROM store_cart_items c JOIN store_products p ON p.id=c.product_id
      WHERE c.user_id=$1 FOR UPDATE OF c`, [userId]);
    const items = rows.rows.map((row) => ({ product: publicStoreProduct(row), quantity: Number(row.quantity) }));
    if (!items.length) return fail(409, 'Sipariş talebi için önce sepete ürün ekle.');
    const totalKurus = items.reduce((sum, item) => sum + item.product.priceKurus * item.quantity, 0);
    const order = (await db.query<OrderRow>(`INSERT INTO store_orders(user_id,status,total_kurus)
      VALUES($1,'pending',$2) RETURNING id,status,total_kurus AS "totalKurus",decision_note AS "decisionNote",
        created_at AS "createdAt",updated_at AS "updatedAt"`, [userId, totalKurus])).rows[0];
    for (const { product, quantity } of items) {
      await db.query(`INSERT INTO store_order_items(order_id,product_id,name,category,product_type,size_label,price_kurus,image_key,quantity)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [order.id, product.id, product.name, product.category, product.productType, product.sizeLabel, product.priceKurus, product.imageKey, quantity]);
    }
    await db.query('DELETE FROM store_cart_items WHERE user_id=$1', [userId]);
    const inserted = (await db.query<OrderRow>(`${orderRows}
      FROM store_orders o JOIN store_order_items i ON i.order_id=o.id WHERE o.id=$1 GROUP BY o.id`, [order.id])).rows[0];
    return normalizeOrder(inserted);
  });
}

export async function adminOrders(offset: number): Promise<{ items: AdminStoreOrder[]; total: number; nextOffset: number | null }> {
  await assertStoreSchema();
  const result = await pool.query<OrderRow>(`${orderRows},o.user_id AS "userId",u.nickname,u.avatar
    FROM store_orders o JOIN store_order_items i ON i.order_id=o.id
    JOIN community_users u ON u.id=o.user_id
    GROUP BY o.id,u.id ORDER BY o.created_at DESC,o.id DESC LIMIT 25 OFFSET $1`, [offset]);
  const total = Number((await pool.query('SELECT count(*)::int AS n FROM store_orders')).rows[0].n);
  return { items: result.rows.map((row) => normalizeOrder(row) as AdminStoreOrder), total, nextOffset: offset + 25 < total ? offset + 25 : null };
}

export async function decideOrder(db: PoolClient, adminId: string, id: string,
  decision: 'paid' | 'free' | 'reject' | 'pending', reason: string) {
  await assertStoreSchema(db);
  const before = (await db.query<{ id: string; userId: string; status: StoreOrderStatus }>(
    'SELECT id,user_id AS "userId",status FROM store_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!before) return fail(404, 'Sipariş talebi bulunamadı.');
  if (before.status !== 'pending') return fail(409, 'Bu sipariş artık beklemede değil.');
  const status: StoreOrderStatus = decision === 'paid' ? 'payment_pending'
    : decision === 'free' ? 'approved_free' : decision === 'reject' ? 'rejected' : 'pending';
  await db.query(`UPDATE store_orders SET status=$2,decision=$3,decision_note=$4,
    decided_by=$5,updated_at=clock_timestamp() WHERE id=$1`, [id, status, decision, reason, adminId]);
  const message = decision === 'paid'
    ? 'Mağaza sipariş talebin ücretli işlem için onaylandı. Ödeme alınmadı; ödeme sağlayıcısı henüz bağlı değil.'
    : decision === 'free' ? 'Mağaza sipariş talebin ücretsiz olarak onaylandı. Ödeme alınmadı.'
      : decision === 'reject' ? 'Mağaza sipariş talebin reddedildi.' : 'Mağaza sipariş talebin beklemede bırakıldı.';
  await db.query(`INSERT INTO social_notifications(recipient_id,actor_id,kind,event_key,notification_body)
    VALUES($1,$2,'store_order',$3,$4) ON CONFLICT(recipient_id,event_key) DO NOTHING`,
  [before.userId, adminId, `store:${id}:${decision}`, message]);
  return { orderId: id, userId: before.userId, status };
}

export async function adminStoreSettings() {
  await assertStoreSchema();
  const result = await pool.query<{ active: boolean; updatedAt: Date | null }>(
    'SELECT active,updated_at AS "updatedAt" FROM store_settings WHERE id=true');
  const row = result.rows[0];
  return { active: row?.active ?? false, updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null };
}

export async function setStoreActive(db: PoolClient, adminId: string, active: boolean) {
  await assertStoreSchema(db);
  const result = await db.query(`INSERT INTO store_settings(id,active,updated_at,updated_by)
    VALUES(true,$1,clock_timestamp(),$2) ON CONFLICT(id) DO UPDATE SET active=excluded.active,
    updated_at=excluded.updated_at,updated_by=excluded.updated_by
    RETURNING active,updated_at AS "updatedAt"`, [active, adminId]);
  return { active: result.rows[0].active, updatedAt: new Date(result.rows[0].updatedAt).toISOString() };
}
