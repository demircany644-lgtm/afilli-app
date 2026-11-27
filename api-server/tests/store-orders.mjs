import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
import { storeProductObject } from '../src/lib/store-products.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Development tests only');
const base = 'http://localhost:80/api', marker = randomUUID().replaceAll('-', '');
const password = `Store test ${randomUUID()}`;
const users = [], orderIds = [], productIds = [], uploadIds = [];
let checks = 0;

async function api(path, token, body, expected = 200, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${data?.error ?? ''}`);
  checks++;
  return data;
}

async function seed(role, index) {
  const id = `store_${marker}_${index}`, email = `store-${marker}-${index}@example.com`;
  users.push(id);
  await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `Store${index}`]);
  await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role) VALUES($1,$2,$3,$4)',
    [id, email, await hashPassword(password), role]);
  const login = await api('/auth/login', null, { email, password });
  return { id, email, token: login.token };
}

async function productMedia(id) {
  const response = await fetch(`${base}/store-product-media/${id}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.match(response.headers.get('cache-control') ?? '', /immutable/);
  const image = Buffer.from(await response.arrayBuffer());
  assert.equal((await sharp(image).metadata()).format, 'jpeg');
  checks++;
}

try {
  const admin = await seed('admin', 0), buyer = await seed('user', 1), other = await seed('user', 2);
  await api('/store/cart', null, undefined, 401);
  const publicCatalog = await api('/store/catalog', null);
  assert.equal(publicCatalog.active, false);
  const catalog = await api('/store/catalog', buyer.token);
  assert.equal(catalog.active, false, 'store request mode starts closed');
  assert.ok(catalog.products.length >= 4);
  const adminCatalog = await api('/admin/store-products', admin.token);
  assert.ok(adminCatalog.some((product) => product.id === catalog.products[0].id));
  await api('/admin/store-products', buyer.token, undefined, 403);

  const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#aa5533' } }).png().toBuffer();
  const uploadInput = { clientId: randomUUID(), contentType: 'image/png', size: png.length };
  await api('/admin/store-product-uploads', null, uploadInput, 401);
  await api('/admin/store-product-uploads', buyer.token, uploadInput, 403);
  const upload = await api('/admin/store-product-uploads', admin.token, uploadInput);
  uploadIds.push(upload.id);
  await api(`/admin/store-product-uploads/${upload.id}/complete`, other.token, undefined, 403, 'POST');
  const put = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
  assert.equal(put.status, 200); checks++;
  const complete = await api(`/admin/store-product-uploads/${upload.id}/complete`, admin.token, undefined, 200, 'POST');
  assert.equal(complete.imageKey, `upload:${upload.id}`);
  const created = await api('/admin/store-products', admin.token, {
    name: 'Synthetic Aksesuar', category: 'accessory', productType: 'Test ürün türü',
    sizeLabel: 'Test ölçüsü', priceKurus: 123456, imageKey: complete.imageKey,
  }, 201);
  productIds.push(created.id);
  assert.equal(created.priceKurus, 123456);
  assert.equal(created.category, 'accessory');
  await productMedia(upload.id);
  const dynamicCatalog = await api('/store/catalog', null);
  assert.ok(dynamicCatalog.products.some((product) => product.id === created.id && product.imageKey === complete.imageKey));
  const first = catalog.products[0];

  let cart = await api('/store/cart/items', buyer.token, { productId: first.id });
  assert.equal(cart.items[0].quantity, 1);
  cart = await api('/store/cart/items', buyer.token, { productId: first.id });
  assert.equal(cart.items[0].quantity, 2);
  assert.equal(cart.totalKurus, first.priceKurus * 2);
  await api('/store/cart/items', buyer.token, { productId: 'not-a-real-product' }, 404);

  assert.equal((await api('/store/cart', other.token)).items.length, 0, 'cart is owner-scoped');
  await api('/store/orders', other.token, {}, 409);
  const order = await api('/store/orders', buyer.token, {}, 201);
  orderIds.push(order.id);
  assert.equal(order.status, 'pending');
  assert.equal(order.totalKurus, first.priceKurus * 2);
  assert.equal((await api('/store/cart', buyer.token)).items.length, 0, 'submitted cart is cleared after snapshot');

  const queue = await api('/admin/store-orders', admin.token);
  const entry = queue.items.find((item) => item.id === order.id);
  assert.equal(entry.nickname, 'Store1');
  assert.equal(entry.items[0].productId, first.id);
  assert.equal(entry.items[0].quantity, 2);
  await api('/admin/store-orders', other.token, undefined, 403);
  await api(`/admin/store-orders/${order.id}/decision`, other.token, { decision: 'free', reason: 'Yetkim yok' }, 403);

  const paid = await api(`/admin/store-orders/${order.id}/decision`, admin.token,
    { decision: 'paid', reason: 'Ücretli işlem için onaylandı' });
  assert.equal(paid.status, 'payment_pending', 'paid decision never simulates a completed payment');
  await api(`/admin/store-orders/${order.id}/decision`, admin.token, { decision: 'free', reason: 'Yinelenen karar' }, 409);
  const buyerOrders = await api('/store/orders', buyer.token);
  assert.equal(buyerOrders.items.find((item) => item.id === order.id).status, 'payment_pending');
  const inbox = await api('/book-notifications', buyer.token);
  assert.ok(inbox.items.some((item) => item.kind === 'store_order' && item.body.includes('Ödeme alınmadı')));

  const freeOrder = await (async () => {
    await api('/store/cart/items', buyer.token, { productId: first.id });
    const result = await api('/store/orders', buyer.token, {}, 201);
    orderIds.push(result.id);
    return result;
  })();
  const free = await api(`/admin/store-orders/${freeOrder.id}/decision`, admin.token,
    { decision: 'free', reason: 'Ücretsiz talep onayı' });
  assert.equal(free.status, 'approved_free');

  await api('/admin/store-settings', admin.token, { active: true, reason: 'Sipariş talepleri açılıyor' }, 200, 'PUT');
  assert.equal((await api('/store/catalog', buyer.token)).active, true);
  await api('/admin/store-settings', admin.token, { active: false, reason: 'Mağaza talepleri kapatılıyor' }, 200, 'PUT');
  assert.equal((await api('/store/catalog', buyer.token)).active, false);

  const history = await api('/admin/history', admin.token);
  assert.ok(history.items.some((item) => item.targetType === 'store_order' && orderIds.includes(item.targetId)));
  console.log(`PASS ${checks} store API checks: private carts, trusted pricing, snapshot orders, admin catalog and image uploads, unpaid approvals, notifications, and settings.`);
} finally {
  await pool.query('DELETE FROM social_notifications WHERE recipient_id=ANY($1::text[]) OR actor_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[]) OR (target_type=$2 AND target_id=ANY($3::text[]))',
    [users, 'store_order', orderIds]);
  await pool.query('DELETE FROM store_orders WHERE id=ANY($1::uuid[])', [orderIds]);
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[]) AND target_type IN ($2,$3)', [users, 'store_product', 'store_product_upload']);
  await pool.query('DELETE FROM store_products WHERE id=ANY($1::text[])', [productIds]);
  await pool.query('DELETE FROM store_product_uploads WHERE id=ANY($1::uuid[])', [uploadIds]);
  for (const id of uploadIds) {
    for (const kind of ['source', 'asset']) {
      await storeProductObject(id, kind).delete({ ignoreNotFound: true }).catch(() => {});
    }
  }
  await pool.query('DELETE FROM store_cart_items WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM afilli_auth_sessions WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM afilli_auth_codes WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM afilli_auth_accounts WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [users]);
  await pool.end();
}
