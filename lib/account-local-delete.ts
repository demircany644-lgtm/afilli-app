import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitForLocalClaims } from '@/lib/local-account-data';
import { progressJournal } from './reading-progress-journal';

const deletedKey = (owner: string) => 'afilli:account-deleted:v1:' + owner;
const writes = new Map<string, Promise<unknown>>();
const deleted = new Set<string>();

/** Serialize local library writes so a late save cannot recreate a deleted cache. */
export function saveAccountCache(owner: string | null, value: string): Promise<void> {
  const key = 'afilli:v2:' + (owner ?? 'guest');
  const next = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (owner && (deleted.has(owner) || await AsyncStorage.getItem(deletedKey(owner)))) return;
    await AsyncStorage.setItem(key, value);
    if (owner && (deleted.has(owner) || await AsyncStorage.getItem(deletedKey(owner)))) await AsyncStorage.removeItem(key);
  });
  writes.set(key, next);
  void next.finally(() => { if (writes.get(key) === next) writes.delete(key); }).catch(() => {});
  return next;
}

/** Only call after a confirmed DELETE, never for ordinary logout or uncertain outcomes. */
export async function removeAccountCache(owner: string) {
  if (!owner || owner === 'guest') throw new Error('Hesap kimliği gerekli.');
  deleted.add(owner);
  await AsyncStorage.setItem(deletedKey(owner), '1');
  await progressJournal.purge(owner);
  await waitForLocalClaims();
  const key = 'afilli:v2:' + owner;
  await writes.get(key)?.catch(() => {});
  await AsyncStorage.removeItem(key);
  // Keep the ownership reservation, but not its recoverable plaintext copy.
  const raw = await AsyncStorage.getItem('afilli:legacy-owner:v1');
  const claim = raw ? raw.startsWith('{') ? JSON.parse(raw) : { ownerId: raw } : null;
  if (claim?.ownerId === owner) {
    await AsyncStorage.setItem('afilli:legacy-owner:v1', JSON.stringify({ ownerId: owner }));
    const guestRaw = await AsyncStorage.getItem('afilli:v2:guest');
    if (guestRaw && JSON.parse(guestRaw).guestAfterClaim !== owner) {
      // Only the pre-claim anonymous copy belongs to this owner. A subsequent
      // guest session carries guestAfterClaim and must remain untouched.
      await AsyncStorage.setItem('afilli:v2:guest', JSON.stringify({
        saved: [], library: {}, drafts: [], store: [], messages: [], notifications: [],
        name: 'Okur', bio: '', guestAfterClaim: owner,
      }));
    }
  }
  const legacyRaw = await AsyncStorage.getItem('afilli:v1');
  if (legacyRaw) {
    const legacy = JSON.parse(legacyRaw);
    const drafts = Array.isArray(legacy.drafts) ? legacy.drafts.filter((d: { ownerId?: string }) =>
      d.ownerId !== owner && (claim?.ownerId !== owner || !!d.ownerId)) : [];
    await AsyncStorage.setItem('afilli:v1', JSON.stringify(claim?.ownerId === owner ? {
      saved: [], library: {}, drafts, store: [], messages: [], notifications: [], name: 'Okur', bio: '',
    } : { ...legacy, drafts }));
  }
}
