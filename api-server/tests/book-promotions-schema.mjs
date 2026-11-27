import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('book promotion migration only adds isolated tables and guards production setup', async () => {
  const sql = (await readFile(new URL('../tools/book-promotions.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS book_promotion_settings/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS book_promotion_requests/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.match(sql, /book_promotion_one_open_per_book/);
  assert.match(sql, /status IN \('pending','active'\)/);
  assert.doesNotMatch(sql, /(?:^|;)\s*(DROP|TRUNCATE|DELETE|UPDATE|ALTER)\b/i);
  const runner = await readFile(new URL('../tools/apply-book-promotions.ts', import.meta.url), 'utf8');
  assert.match(runner, /NODE_ENV === 'production'/);
  assert.match(runner, /!process\.env\.REPLIT_DEV_DOMAIN/);
});
