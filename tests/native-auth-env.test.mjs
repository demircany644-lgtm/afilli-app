import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import checker from '../scripts/check-native-auth-env.cjs';

const { validateNativeAuthEnvironment: validate } = checker;
test('native builds require only the API hostname, not an external auth key', () => {
  assert.equal(validate({}).length, 1);
  assert.deepEqual(validate({ EXPO_PUBLIC_DOMAIN: 'api.example.invalid' }), []);
});
test('API domain rejects schemes, paths, ports and credentials', () => {
  for (const domain of ['https://api.example.invalid', 'api.example.invalid/api', 'user@api.example.invalid', 'api.example.invalid:443', 'api.example.invalid?x=1', 'localhost', '127.0.0.1', ' api.example.invalid ']) {
    assert.ok(validate({ EXPO_PUBLIC_DOMAIN: domain }).length, domain);
  }
});
test('invalid build configuration fails without printing values', () => {
  const script = fileURLToPath(new URL('../scripts/check-native-auth-env.cjs', import.meta.url));
  const domain = 'https://private.example.invalid';
  const result = spawnSync(process.execPath, [script], { env: { EXPO_PUBLIC_DOMAIN: domain }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(!(result.stdout + result.stderr).includes(domain));
  assert.equal(spawnSync(process.execPath, [script], { env: { EXPO_PUBLIC_DOMAIN: 'api.example.invalid' } }).status, 0);
});
test('the root keeps its error boundary, secure local auth and permanent bottom bar', () => {
  const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<ErrorBoundary FallbackComponent=\{StartupErrorFallback\}>/);
  assert.match(layout, /<AuthProvider>/);
  assert.match(layout, /<BottomNavigation \/>/);
  assert.doesNotMatch(layout, /ClerkProvider|CLERK_PUBLISHABLE_KEY|tokenCache/);
  const context = readFileSync(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
  assert.match(context, /SecureStore\.setItemAsync/);
  assert.doesNotMatch(context, /AsyncStorage|localStorage\.setItem/);
});
