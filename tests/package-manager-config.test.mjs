import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const buildConfig = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));

function assertMatchingPnpm(config, packageManager) {
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager);
  assert.ok(match, 'packageManager must declare an exact pnpm version');
  assert.ok(config.build && Object.keys(config.build).length, 'Build profiles must exist');
  for (const [name, profile] of Object.entries(config.build)) {
    assert.equal(profile.pnpm, match[1], `${name}: build pnpm must match packageManager`);
  }
}

function validFixture() {
  return {
    build: {
      development: { pnpm: '10.26.1' },
      preview: { pnpm: '10.26.1' },
      production: { pnpm: '10.26.1' },
    },
  };
}

test('every build profile uses the workspace exact pnpm version', () => {
  assertMatchingPnpm(buildConfig, manifest.packageManager);
});

test('an older builder pnpm is rejected before a remote build is needed', () => {
  const config = validFixture();
  config.build.production.pnpm = '9.15.9';
  assert.throws(() => assertMatchingPnpm(config, manifest.packageManager), /production/);
});

test('a missing production pnpm version is rejected', () => {
  const config = validFixture();
  delete config.build.production.pnpm;
  assert.throws(() => assertMatchingPnpm(config, manifest.packageManager), /production/);
});
