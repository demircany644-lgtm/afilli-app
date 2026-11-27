import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { gifLibrary } from '@workspace/db';

test('shared official GIF schema preserves owners safely and deduplicates retry identities', () => {
  const config = getTableConfig(gifLibrary);
  assert.equal(config.name, 'gif_library');
  assert.equal(config.foreignKeys.length, 1);
  assert.equal(config.foreignKeys[0].getName(), 'gif_library_owner_id_fkey');
  assert.equal(config.foreignKeys[0].onDelete, 'set null');
  assert.ok(config.uniqueConstraints.some(c => c.name === 'gif_library_owner_client'));
  assert.ok(config.columns.some(c => c.name === 'object_path'));
});
test('GIF migration adds only its own table/index; development runner cannot target production', async () => {
  const sql = (await readFile(new URL('../tools/gif-library.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  assert.doesNotMatch(sql, /(?:^|;)\s*(DROP|TRUNCATE|DELETE|UPDATE|ALTER)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS gif_library/);
  const runner = await readFile(new URL('../tools/apply-gif-library.ts', import.meta.url), 'utf8');
  assert.match(runner, /NODE_ENV === 'production'/);
  assert.match(runner, /!process\.env\.REPLIT_DEV_DOMAIN/);
  assert.doesNotMatch(runner, /execSync|push-force/);
});
