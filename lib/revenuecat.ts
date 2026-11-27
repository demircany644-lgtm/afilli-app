export type StoreProduct = {
  identifier: string;
  priceString: string;
  price?: number;
  currencyCode?: string;
};
export type StorePackage = { identifier: string; product: StoreProduct };
export type StoreOffering = { availablePackages: StorePackage[] };
export type PurchasesSdk = {
  configure: (options: { apiKey: string; appUserID: string }) => void;
  logIn: (appUserID: string) => Promise<unknown>;
  getOfferings: () => Promise<{ current: StoreOffering | null; all?: Record<string, StoreOffering | undefined> }>;
  purchasePackage: (pkg: StorePackage) => Promise<unknown>;
  restorePurchases: () => Promise<unknown>;
};

let configuredKey = '';
let configuredUserId = '';

export async function purchasesSdk(apiKey: string, appUserID: string): Promise<PurchasesSdk> {
  const imported = await import('react-native-purchases');
  const sdk = (imported.default ?? imported) as unknown as PurchasesSdk;
  if (configuredKey !== apiKey) {
    sdk.configure({ apiKey, appUserID });
    configuredKey = apiKey;
    configuredUserId = appUserID;
  } else if (configuredUserId !== appUserID) {
    await sdk.logIn(appUserID);
    configuredUserId = appUserID;
  }
  return sdk;
}
