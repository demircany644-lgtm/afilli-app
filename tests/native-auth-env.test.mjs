import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import checker from '../scripts/check-native-auth-env.cjs';

const { validateNativeAuthEnvironment: validate } = checker;
const keyFor = (environment) => `pk_${environment}_${Buffer.from('synthetic.example.invalid$').toString('base64')}`;
const configured = () => ({
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: keyFor('live'),
  EXPO_PUBLIC_DOMAIN: 'api.example.invalid',
  EAS_BUILD_PROFILE: 'production',
});

test('missing build variables fail instead of shipping a crashing app', () => {
  const problems = validate({});
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY')));
  assert.ok(problems.some((p) => p.includes('EXPO_PUBLIC_DOMAIN')));
});

test('a private key or malformed publishable key is rejected', () => {
  for (const key of [['sk', 'live', 'synthetic'].join('_'), 'pk_live_invalid', 'placeholder', ` ${keyFor('live')}`]) {
    assert.ok(validate({ ...configured(), EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: key }).some((p) => p.includes('invalid')));
  }
});

test('production requires a live public key; development can use a test key', () => {
  assert.deepEqual(validate(configured()), []);
  const testEnv = { ...configured(), EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: keyFor('test') };
  assert.ok(validate(testEnv).some((p) => p.includes('development key')));
  assert.deepEqual(validate({ ...testEnv, EAS_BUILD_PROFILE: 'development' }), []);
});

test('API domain rejects schemes, paths, ports and credentials', () => {
  for (const domain of ['https://api.example.invalid', 'api.example.invalid/api', 'user@api.example.invalid', 'api.example.invalid:443', 'api.example.invalid?x=1', 'localhost', '127.0.0.1', ' api.example.invalid ']) {
    assert.ok(validate({ ...configured(), EXPO_PUBLIC_DOMAIN: domain }).length, domain);
  }
});

test('the command exits unsuccessfully and never prints supplied values', () => {
  const script = fileURLToPath(new URL('../scripts/check-native-auth-env.cjs', import.meta.url));
  const env = { ...configured(), EXPO_PUBLIC_DOMAIN: 'https://api.example.invalid' };
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.ok(output.includes('EXPO_PUBLIC_DOMAIN'));
  assert.ok(!output.includes(env.EXPO_PUBLIC_DOMAIN));
  assert.ok(!output.includes(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY));
  assert.equal(spawnSync(process.execPath, [script], { env: configured() }).status, 0);
});

test('the check is wired to the native build lifecycle', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['eas-build-post-install'], 'node scripts/check-native-auth-env.cjs');
});

test('the root boundary wraps Clerk and keeps safe area and secure token cache', () => {
  const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<ErrorBoundary FallbackComponent=\{StartupErrorFallback\}>\s*<ClerkProvider/);
  assert.match(layout, /<SafeAreaProvider><ErrorFallback \{\.\.\.props\} \/><\/SafeAreaProvider>/);
  assert.match(layout, /tokenCache=\{tokenCache\}/);
  assert.match(layout, /<BottomNavigation \/>/);
});
