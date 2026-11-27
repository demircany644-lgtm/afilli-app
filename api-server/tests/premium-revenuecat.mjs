import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRevenueCatConfig, requirePremiumPlatform, verifyActiveRevenueCatEntitlement,
} from '../src/lib/revenuecat-premium.ts';

const fixture = () => ({
  current: {
    items: [{
      package: {
        id: 'pkg_monthly',
        lookup_key: '$rc_monthly',
        display_name: 'Monthly Premium',
        products: [
          { product: { id: 'prod_ios', store_identifier: 'afilli.monthly.ios', app_id: 'app_ios', display_name: 'Monthly' } },
          { product: { id: 'prod_android', store_identifier: 'afilli.monthly.android', app_id: 'app_android', display_name: 'Monthly' } },
        ],
      },
    }],
  },
  apps: { items: [{ id: 'app_ios', type: 'app_store' }, { id: 'app_android', type: 'play_store' }] },
  keys: { app_ios: { items: [{ key: 'appl_public_ios' }] }, app_android: { items: [{ key: 'goog_public_android' }] } },
});

test('config publishes only current offering packages with store-specific public keys', () => {
  const data = fixture();
  const config = buildRevenueCatConfig('proj_test', {
    items: [
      { is_current: false, items: [{ package: { id: 'old', lookup_key: 'old', products: [] } }] },
      { is_current: true, ...data.current },
    ],
  }, data.apps, data.keys);
  assert.equal(config.configured, true);
  assert.equal(config.iosPublicKey, 'appl_public_ios');
  assert.equal(config.androidPublicKey, 'goog_public_android');
  assert.deepEqual(config.packages.map((item) => [item.packageIdentifier, item.productIdentifier, item.platform]), [
    ['$rc_monthly', 'afilli.monthly.ios', 'ios'],
    ['$rc_monthly', 'afilli.monthly.android', 'android'],
  ]);
  assert.equal(Object.hasOwn(config.packages[0], 'price'), false);
});

test('missing project or current offering fails closed without inventing packages', () => {
  const data = fixture();
  assert.deepEqual(buildRevenueCatConfig(null, data.current, data.apps, data.keys).packages, []);
  const unavailable = buildRevenueCatConfig('proj_test', { items: [] }, data.apps, data.keys);
  assert.equal(unavailable.configured, false);
  assert.ok(unavailable.message);
  assert.deepEqual(unavailable.packages, []);
});

test('invalid platform cannot be used to submit an application', () => {
  assert.equal(requirePremiumPlatform('ios'), 'ios');
  assert.equal(requirePremiumPlatform('android'), 'android');
  assert.throws(() => requirePremiumPlatform('web'), (error) => error.status === 400);
});

test('purchase verification requires an active matching non-expired RevenueCat entitlement', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const proxy = async (_connector, path) => {
    assert.match(path, /customers\/user%2F1\/active_entitlements/);
    return { ok: true, json: async () => ({ items: [
      { product_id: 'another_product', expires_at: future },
      { product_id: 'prod_monthly', product_identifier: 'afilli.monthly', expires_at: future },
    ] }) };
  };
  const verified = await verifyActiveRevenueCatEntitlement('user/1', 'prod_monthly', 'afilli.monthly', 'proj_test', proxy);
  assert.ok(verified instanceof Date);
  assert.ok(verified.getTime() > Date.now());

  const expiredProxy = async () => ({ ok: true, json: async () => ({ items: [
    { product_id: 'prod_monthly', product_identifier: 'afilli.monthly', expires_at: '2000-01-01T00:00:00Z' },
  ] }) });
  assert.equal(await verifyActiveRevenueCatEntitlement('u', 'prod_monthly', 'afilli.monthly', 'proj_test', expiredProxy), null);
  const mismatchedProxy = async () => ({ ok: true, json: async () => ({ items: [
    { product_id: 'not-the-plan', expires_at: future },
  ] }) });
  assert.equal(await verifyActiveRevenueCatEntitlement('u', 'prod_monthly', 'afilli.monthly', 'proj_test', mismatchedProxy), null);
  assert.equal(await verifyActiveRevenueCatEntitlement('u', 'prod_monthly', 'afilli.monthly', null, proxy), null);
});
