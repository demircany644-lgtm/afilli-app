import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/profile-crop.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const compiled = { exports: {} };
new Function('exports', 'module', javascript)(compiled.exports, compiled);
const { profileCropRect } = compiled.exports;

const centered = { rotation: 0, zoom: 1, dx: 0, dy: 0 };

test('avatar crop is square and cover crop is three to one', () => {
  const avatar = profileCropRect(4000, 3000, 'avatar', centered);
  const cover = profileCropRect(4000, 3000, 'cover', centered);
  assert.equal(avatar.width, avatar.height);
  assert.equal(cover.width / cover.height, 3);
  assert.deepEqual([avatar.x, avatar.y], [500, 0]);
  assert.deepEqual([cover.x, cover.y], [1, 834]);
});

test('zoom and drag keep the crop inside the image boundaries', () => {
  const crop = profileCropRect(1200, 800, 'cover', { rotation: 0, zoom: 2, dx: 1, dy: 1 });
  assert.equal(crop.width / crop.height, 3);
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.width <= crop.rotatedWidth);
  assert.ok(crop.y + crop.height <= crop.rotatedHeight);
  assert.equal(crop.x, crop.rotatedWidth - crop.width);
  assert.equal(crop.y, crop.rotatedHeight - crop.height);
});

test('rotated source dimensions are used for the crop', () => {
  const crop = profileCropRect(3000, 4000, 'cover', { ...centered, rotation: 90 });
  assert.deepEqual([crop.rotatedWidth, crop.rotatedHeight], [4000, 3000]);
  assert.equal(crop.width / crop.height, 3);
});
