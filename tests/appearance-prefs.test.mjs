import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrefs, normalizePrefs, clampVolume, serializePrefs, createLatestWriter, DEFAULT_PREFS, MAX_VOLUME } from '../lib/appearancePrefs.ts';

test('defaults keep the original cream theme', () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.equal(DEFAULT_PREFS.theme, 'classic');
  assert.equal(DEFAULT_PREFS.volume, 0.12);
});
test('garbage and JSON null do not throw', () => {
  assert.deepEqual(parsePrefs('{nope'), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('null'), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs({ theme: 'neon', sound: 'yes' }), DEFAULT_PREFS);
});
test('volume is finite and capped at 0.15', () => {
  assert.equal(clampVolume(NaN), 0.12);
  assert.equal(clampVolume(Infinity), 0.12);
  assert.equal(clampVolume(1), MAX_VOLUME);
  assert.equal(clampVolume(-3), 0);
  assert.equal(clampVolume(0.061), 0.06);
});
test('round trip lava prefs', () => {
  const p = { theme: 'lava', sound: false, volume: 0.09 };
  assert.deepEqual(parsePrefs(serializePrefs(p)), p);
});
test('writer is serialized and latest wins', async () => {
  const written = []; let release; const results = [];
  const w = createLatestWriter(async (v) => { written.push(v); if (v === 1) await new Promise((r) => { release = r; }); }, (e) => results.push(e));
  const first = w.save(1); w.save(2); w.save(3);
  release(); await first;
  assert.deepEqual(written, [1, 3]);
  assert.deepEqual(results, [null]);
});
test('write failure is reported', async () => {
  const results = [];
  const w = createLatestWriter(async () => { throw new Error('disk'); }, (e) => results.push(e));
  await w.save(1);
  assert.equal(results.length, 1); assert.ok(results[0] instanceof Error);
});
