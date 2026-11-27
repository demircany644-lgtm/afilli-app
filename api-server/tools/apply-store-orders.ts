import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';

if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) {
  throw new Error('Development schema setup only; production requires the reviewed additive migration.');
}

const client = await pool.connect();
try {
  await client.query(await readFile(new URL('./store-orders.sql', import.meta.url), 'utf8'));
  const result = await client.query(`SELECT
    to_regclass('store_settings') IS NOT NULL AND to_regclass('store_cart_items') IS NOT NULL
    AND to_regclass('store_orders') IS NOT NULL AND to_regclass('store_order_items') IS NOT NULL
    AND to_regclass('store_products') IS NOT NULL AND to_regclass('store_product_uploads') IS NOT NULL
    AND (SELECT active=false FROM store_settings WHERE id=true) AS ok`);
  if (!result.rows[0]?.ok) throw new Error('Additive store schema verification failed.');
  console.log('Development store tables verified; existing account and content data were not changed.');
} finally {
  client.release();
  await pool.end();
}
