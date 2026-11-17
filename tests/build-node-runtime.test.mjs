import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));

function assertBuildNode(profile) {
  assert.equal(profile.node, '24.22.1', 'Build must select the verified SDK-compatible Node runtime');
}

test('all external build profiles select the verified Node runtime', () => {
  for (const profile of Object.values(config.build)) assertBuildNode(profile);
});

test('Node 18 cannot silently return to the build profiles', () => {
  assert.throws(() => assertBuildNode({ node: '18.18.0' }), /SDK-compatible/);
});

test('a missing build Node version is rejected', () => {
  assert.throws(() => assertBuildNode({}), /SDK-compatible/);
});
