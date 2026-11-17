import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const image = 'ubuntu-26.04-jdk-17-ndk-r27b-sdk-58';

function assertAndroidImage(profile) {
  assert.equal(profile.android?.image, image, 'Android must select the documented SDK 58 / Java 17 image');
}

test('every Android profile selects the SDK-matched Java 17 environment', () => {
  assert.match(manifest.dependencies?.expo ?? manifest.devDependencies?.expo, /^[~^]?58\./);
  for (const profile of Object.values(config.build)) assertAndroidImage(profile);
  assert.equal(config.build.production.android.buildType, 'app-bundle');
});

test('a legacy Java 11 environment is rejected', () => {
  assert.throws(() => assertAndroidImage({ android: { image: 'ubuntu-20.04-jdk-11-ndk-r21e' } }), /Java 17/);
});

test('implicit Android image selection is rejected', () => {
  assert.throws(() => assertAndroidImage({}), /Java 17/);
});
