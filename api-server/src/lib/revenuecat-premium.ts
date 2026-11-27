import { ReplitConnectors } from '@replit/connectors-sdk';
import { fail } from './community';

const connectors = new ReplitConnectors();
type JsonResponse = { ok: boolean; json(): Promise<unknown> };
type Proxy = (connector: string, path: string, options: { method: 'GET' }) => Promise<JsonResponse>;
type JsonObject = Record<string, unknown>;

export type RevenueCatPlatform = 'ios' | 'android';
export type RevenueCatPackage = {
  packageId: string;
  packageIdentifier: string;
  productId: string;
  productIdentifier: string;
  productName: string;
  platform: RevenueCatPlatform;
};
export type RevenueCatConfig = {
  configured: boolean;
  message: string | null;
  iosPublicKey: string | null;
  androidPublicKey: string | null;
  packages: RevenueCatPackage[];
  projectId: string | null;
};

const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const rows = (value: unknown): JsonObject[] => {
  const root = object(value);
  return Array.isArray(root.items) ? root.items.map(object) : [];
};
const text = (...values: unknown[]) => values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null;
const apiProxy: Proxy = (connector, path, options) => connectors.proxy(connector, path, options);
let defaultConfigCache: { expiresAt: number; value: RevenueCatConfig } | null = null;
export const ACCOUNT_APPEAL_PRODUCT_IDENTIFIER = 'afilli_unban_appeal_200';

async function get(proxy: Proxy, path: string) {
  const response = await proxy('revenuecat', path, { method: 'GET' });
  if (!response.ok) return null;
  return response.json();
}

function appPlatform(type: unknown): RevenueCatPlatform | null {
  if (type === 'app_store') return 'ios';
  if (type === 'play_store') return 'android';
  return null;
}

function currentOffering(value: unknown, identifier?: string | null) {
  return rows(value).find((offering) => identifier
    ? text(offering.lookup_key, offering.identifier) === identifier
    : offering.is_current === true) ?? null;
}

function packageRows(offering: JsonObject): JsonObject[] {
  if (Array.isArray(offering.items)) {
    return offering.items.map((item) => object(object(item).package)).filter((item) => Object.keys(item).length > 0);
  }
  return Array.isArray(offering.packages) ? offering.packages.map(object) : [];
}

function productRows(pkg: JsonObject): JsonObject[] {
  if (Array.isArray(pkg.products)) {
    return pkg.products.map((entry) => {
      const record = object(entry);
      return Object.keys(object(record.product)).length ? object(record.product) : record;
    });
  }
  return Object.keys(object(pkg.product)).length ? [object(pkg.product)] : [];
}

export function buildRevenueCatConfig(
  projectId: string | null,
  offeringsPayload: unknown,
  appsPayload: unknown,
  publicKeysByApp: Record<string, unknown>,
  offeringIdentifier?: string | null,
): RevenueCatConfig {
  const unavailable = (message: string): RevenueCatConfig => ({
    configured: false, message, iosPublicKey: null, androidPublicKey: null, packages: [], projectId,
  });
  if (!projectId) return unavailable('RevenueCat projesi bağlı değil. Mevcut proje ve paketler bağlandığında burada görünür.');
  const offering = currentOffering(offeringsPayload, offeringIdentifier);
  if (!offering) return unavailable('RevenueCat içinde yayımlanmış bir güncel teklif bulunamadı.');

  const apps = rows(appsPayload).flatMap((app) => {
    const platform = appPlatform(app.type);
    return platform && typeof app.id === 'string' ? [{ id: app.id, platform }] : [];
  });
  const keyFor = (appId: string, prefix: 'appl_' | 'goog_') => rows(publicKeysByApp[appId])
    .map((key) => text(key.key, key.public_api_key, key.value))
    .find((key) => !!key && key.startsWith(prefix)) ?? null;
  const iosApp = apps.find((app) => app.platform === 'ios');
  const androidApp = apps.find((app) => app.platform === 'android');
  const iosPublicKey = iosApp ? keyFor(iosApp.id, 'appl_') : null;
  const androidPublicKey = androidApp ? keyFor(androidApp.id, 'goog_') : null;

  const current = packageRows(offering);
  const packages: RevenueCatPackage[] = [];
  for (const pkg of current) {
    const packageIdentifier = text(pkg.lookup_key, pkg.identifier);
    const packageId = text(pkg.id);
    if (!packageIdentifier || !packageId) continue;
    for (const product of productRows(pkg)) {
      const productId = text(product.id, product.product_id);
      const productIdentifier = text(product.store_identifier, product.identifier, product.product_identifier);
      const appId = text(product.app_id, object(product.app).id);
      const app = apps.find((candidate) => candidate.id === appId);
      if (!productId || !productIdentifier || !app) continue;
      packages.push({
        packageId, packageIdentifier, productId, productIdentifier,
        productName: text(product.display_name, product.title, pkg.display_name, productIdentifier) ?? productIdentifier,
        platform: app.platform,
      });
    }
  }
  const configured = packages.length > 0 && (!!iosPublicKey || !!androidPublicKey);
  return {
    configured,
    message: configured ? null : 'Güncel teklifte bu uygulama için satın alınabilir paket veya genel SDK anahtarı bulunamadı.',
    iosPublicKey, androidPublicKey, packages, projectId,
  };
}

export async function revenueCatConfig(proxy: Proxy = apiProxy, offeringIdentifier?: string | null): Promise<RevenueCatConfig> {
  const cacheable = proxy === apiProxy && !offeringIdentifier;
  if (cacheable && defaultConfigCache && defaultConfigCache.expiresAt > Date.now()) return defaultConfigCache.value;
  const cache = (value: RevenueCatConfig) => {
    if (cacheable) defaultConfigCache = { value, expiresAt: Date.now() + 5 * 60_000 };
    return value;
  };
  try {
    const projectIdFromEnv = process.env.REVENUECAT_PROJECT_ID?.trim() || null;
    const projectPayload = await get(proxy, '/v2/projects?limit=100');
    const projects = rows(projectPayload);
    const projectId = projectIdFromEnv
      ?? (projects.length === 1 ? text(projects[0].id) : null);
    if (!projectId) {
      return cache(buildRevenueCatConfig(null, null, null, {}));
    }
    const [offeringsPayload, appsPayload] = await Promise.all([
      get(proxy, `/v2/projects/${encodeURIComponent(projectId)}/offerings?expand=items.package.product&limit=100`),
      get(proxy, `/v2/projects/${encodeURIComponent(projectId)}/apps?limit=100`),
    ]);
    const apps = rows(appsPayload);
    const publicKeys: Record<string, unknown> = {};
    await Promise.all(apps.flatMap((app) => {
      if (typeof app.id !== 'string' || !appPlatform(app.type)) return [];
      return [get(proxy, `/v2/projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(app.id)}/public_api_keys`)
        .then((value) => { publicKeys[app.id as string] = value; })];
    }));
    return cache(buildRevenueCatConfig(projectId, offeringsPayload, appsPayload, publicKeys, offeringIdentifier));
  } catch {
    return cache({
      configured: false,
      message: 'RevenueCat ayarları şu anda alınamıyor. Biraz sonra tekrar dene.',
      iosPublicKey: null, androidPublicKey: null, packages: [], projectId: null,
    });
  }
}

export async function accountAppealRevenueCatConfig(proxy: Proxy = apiProxy): Promise<RevenueCatConfig> {
  const config = await revenueCatConfig(proxy, 'afilli_account_appeal');
  const packages = config.packages.filter(item =>
    item.packageIdentifier === 'account_appeal' && item.productIdentifier === ACCOUNT_APPEAL_PRODUCT_IDENTIFIER);
  const configured = packages.length > 0 && (!!config.iosPublicKey || !!config.androidPublicKey);
  return {
    ...config,
    configured,
    message: configured ? null : 'RevenueCat içinde afilli_account_appeal teklifi, account_appeal paketi ve afilli_unban_appeal_200 adlı 200 TL tüketilebilir ürün yapılandırılmalı.',
    packages,
  };
}

export async function matchCurrentPackage(
  packageIdentifier: string, productIdentifier: string, platform: RevenueCatPlatform,
) {
  const config = await revenueCatConfig();
  return config.packages.find((item) => item.packageIdentifier === packageIdentifier
    && item.productIdentifier === productIdentifier && item.platform === platform) ?? null;
}

export async function verifyActiveRevenueCatEntitlement(
  owner: string, productId: string, productIdentifier: string, projectId: string | null,
  proxy: Proxy = apiProxy,
) : Promise<Date | null> {
  if (!projectId) return null;
  const value = await get(proxy, `/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(owner)}/active_entitlements?limit=100`);
  if (!value) return null;
  const now = Date.now();
  const match = rows(value).find((entitlement) => {
    const matchedProduct = entitlement.product_id === productId
      || entitlement.product_identifier === productIdentifier
      || entitlement.store_product_identifier === productIdentifier;
    const expiry = text(entitlement.expires_at, entitlement.expires_date);
    const active = entitlement.is_active !== false && (!expiry || Date.parse(expiry) > now);
    return matchedProduct && active;
  });
  const expiry = match ? text(match.expires_at, match.expires_date) : null;
  const expiresAt = expiry ? new Date(expiry) : null;
  return expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now ? expiresAt : null;
}

function purchaseTime(value: JsonObject) {
  const raw = value.purchased_at ?? value.purchase_date ?? value.created_at ?? value.purchased_at_ms;
  if (typeof raw === 'number') return new Date(raw < 10_000_000_000 ? raw * 1000 : raw);
  if (typeof raw === 'string') {
    const numeric = Number(raw);
    const date = Number.isFinite(numeric) && raw.trim() !== '' ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(raw);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

export async function verifyRevenueCatOneTimePurchase(
  owner: string, productId: string, productIdentifier: string, transactionId: string,
  projectId: string | null, notBefore: Date, proxy: Proxy = apiProxy,
) {
  if (!projectId) return null;
  const value = await get(proxy, `/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(owner)}/purchases?limit=100`);
  if (!value) return null;
  const purchase = rows(value).find(item => {
    const transaction = text(item.store_transaction_identifier, item.transaction_identifier, item.transaction_id);
    const product = item.product_id === productId || text(item.product_identifier, item.store_product_identifier) === productIdentifier;
    const refunded = item.is_refunded === true || !!item.refunded_at || item.status === 'refunded';
    const purchasedAt = purchaseTime(item);
    return transaction === transactionId && product && !refunded && !!purchasedAt && purchasedAt >= notBefore;
  });
  if (!purchase) return null;
  return {
    transactionId: text(purchase.store_transaction_identifier, purchase.transaction_identifier, purchase.transaction_id)!,
    productId: text(purchase.product_id)!,
    purchasedAt: purchaseTime(purchase)!,
  };
}

export function requirePremiumPlatform(value: unknown): RevenueCatPlatform {
  if (value !== 'ios' && value !== 'android') return fail(400, 'Satın alma yalnızca iOS veya Android uygulamasında yapılabilir.');
  return value;
}
