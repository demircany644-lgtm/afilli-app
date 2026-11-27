import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('store migration is additive and defaults order requests to closed', async () => {
  const sql = (await readFile(new URL('../tools/store-orders.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS store_settings/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS store_cart_items/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS store_orders/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS store_order_items/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS store_products/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS store_product_uploads/);
  assert.match(sql, /ON CONFLICT\(id\) DO NOTHING/);
  assert.match(sql, /INSERT INTO store_settings\(id,active\) VALUES\(true,false\) ON CONFLICT\(id\) DO NOTHING/);
  assert.doesNotMatch(sql, /(?:^|;)\s*(DROP|TRUNCATE|DELETE|UPDATE|ALTER)\b/i);
  const runner = await readFile(new URL('../tools/apply-store-orders.ts', import.meta.url), 'utf8');
  assert.match(runner, /NODE_ENV === 'production'/);
  assert.match(runner, /!process\.env\.REPLIT_DEV_DOMAIN/);
});
