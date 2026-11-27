import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { accountAppealRevenueCatConfig, buildRevenueCatConfig, verifyRevenueCatOneTimePurchase } from '../src/lib/revenuecat-premium.ts';
import { isAppealRouteAllowed } from '../src/lib/auth-session.ts';

const packagePayload = {
  items: [{
    lookup_key: 'afilli_account_appeal',
    items: [{
      package: {
        id: 'pkg_appeal',
        lookup_key: 'account_appeal',
        products: [{ product: {
          id: 'prod_appeal_ios',
          store_identifier: 'afilli_unban_appeal_200',
          display_name: 'Engel kaldırma başvurusu',
          app_id: 'app_ios',
        } }],
      },
    }],
  }, {
    lookup_key: 'current_premium',
    is_current: true,
    items: [{
      package: {
        id: 'pkg_premium',
        lookup_key: 'monthly',
        products: [{ product: {
          id: 'prod_premium',
          store_identifier: 'premium_monthly',
          app_id: 'app_ios',
        } }],
      },
    }],
  }],
};

test('account appeal reads only the dedicated offering and leaves Premium current offering separate', () => {
  const config = buildRevenueCatConfig('proj', packagePayload, { items: [{ id: 'app_ios', type: 'app_store' }] }, {
    app_ios: { items: [{ key: 'appl_public_key' }] },
  }, 'afilli_account_appeal');
  assert.equal(config.configured, true);
  assert.equal(config.packages.length, 1);
  assert.equal(config.packages[0].packageIdentifier, 'account_appeal');
  assert.equal(config.packages[0].productIdentifier, 'afilli_unban_appeal_200');
});

test('RevenueCat account-appeal config requires the fixed 200 TRY product in its own package', async () => {
  const previous = process.env.REVENUECAT_PROJECT_ID;
  process.env.REVENUECAT_PROJECT_ID = 'proj';
  const paths = new Map([
    ['/v2/projects/proj/offerings?expand=items.package.product&limit=100', packagePayload],
    ['/v2/projects/proj/apps?limit=100', { items: [{ id: 'app_ios', type: 'app_store' }] }],
    ['/v2/projects/proj/apps/app_ios/public_api_keys', { items: [{ key: 'appl_public_key' }] }],
  ]);
  const proxy = async (_connector, path, options) => {
    assert.equal(options.method, 'GET');
    const payload = paths.get(path);
    return { ok: !!payload, json: async () => payload };
  };
  try {
    const config = await accountAppealRevenueCatConfig(proxy);
    assert.equal(config.configured, true);
    assert.deepEqual(config.packages.map(item => item.productIdentifier), ['afilli_unban_appeal_200']);
    const wrongProduct = structuredClone(packagePayload);
    wrongProduct.items[0].items[0].package.products[0].product.store_identifier = 'different-product';
    paths.set('/v2/projects/proj/offerings?expand=items.package.product&limit=100', wrongProduct);
    const unavailable = await accountAppealRevenueCatConfig(proxy);
    assert.equal(unavailable.configured, false);
    assert.equal(unavailable.packages.length, 0);
  } finally {
    if (previous === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previous;
  }
});

test('server accepts only the matching, non-refunded purchase after the block date', async () => {
  const proxy = async (_connector, path, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(path, '/v2/projects/proj/customers/user-1/purchases?limit=100');
    return {
      ok: true,
      json: async () => ({ items: [
        { store_transaction_identifier: 'tx-old', product_id: 'prod-appeal', purchased_at: '2026-01-01T00:00:00Z' },
        { store_transaction_identifier: 'tx-refunded', product_id: 'prod-appeal', purchased_at: '2026-02-04T00:00:00Z', status: 'refunded' },
        { store_transaction_identifier: 'tx-valid', product_id: 'prod-appeal', purchased_at: '2026-02-05T00:00:00Z' },
      ] }),
    };
  };
  const blockDate = new Date('2026-02-01T00:00:00Z');
  const valid = await verifyRevenueCatOneTimePurchase('user-1', 'prod-appeal', 'afilli_unban_appeal_200', 'tx-valid', 'proj', blockDate, proxy);
  assert.equal(valid?.transactionId, 'tx-valid');
  assert.equal(valid?.productId, 'prod-appeal');
  assert.equal(await verifyRevenueCatOneTimePurchase('user-1', 'other-product', 'other', 'tx-valid', 'proj', blockDate, proxy), null);
  assert.equal(await verifyRevenueCatOneTimePurchase('user-1', 'prod-appeal', 'afilli_unban_appeal_200', 'tx-old', 'proj', blockDate, proxy), null);
  assert.equal(await verifyRevenueCatOneTimePurchase('user-1', 'prod-appeal', 'afilli_unban_appeal_200', 'tx-refunded', 'proj', blockDate, proxy), null);
});

test('appeal-only sessions cannot reach regular app APIs', () => {
  for (const [method, path] of [
    ['GET', '/api/auth/session'],
    ['GET', '/api/account-appeals/config'],
    ['GET', '/api/account-appeals/me'],
    ['POST', '/api/account-appeals/verify'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/book-notifications'],
    ['PATCH', '/api/book-notifications/123e4567-e89b-42d3-a456-426614174000'],
  ]) assert.equal(isAppealRouteAllowed(method, path), true, `${method} ${path} should be available`);
  for (const [method, path] of [
    ['GET', '/api/profile/me'],
    ['POST', '/api/messages'],
    ['GET', '/api/premium/me'],
    ['PATCH', '/api/book-notifications/not-a-uuid'],
  ]) assert.equal(isAppealRouteAllowed(method, path), false, `${method} ${path} must remain blocked`);
});

test('development database change is additive and contains no data deletion', async () => {
  const sql = await readFile(new URL('../tools/account-appeals.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS access_mode/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS account_appeals/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS account_appeals_transaction_unique/);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|INDEX)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bINSERT\s+INTO\b/i);
  const runner = await readFile(fileURLToPath(new URL('../tools/apply-account-appeals.ts', import.meta.url)), 'utf8');
  assert.match(runner, /REPLIT_DEPLOYMENT === '1'/);
  assert.match(runner, /REPLIT_DEV_DOMAIN/);
});
