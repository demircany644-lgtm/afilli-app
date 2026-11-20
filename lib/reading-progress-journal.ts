import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pending, Journal } from './reading-progress';

export const progressJournalKey = (owner: string) => 'afilli:reading-pending:v1:' + owner;
const tombstoneKey = (owner: string) => 'afilli:account-deleted:v1:' + owner;
export function createAsyncStorageJournal(storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'> = AsyncStorage) {
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T,>(owner: string, fn: () => Promise<T>): Promise<T> => {
    const next = (chains.get(owner) ?? Promise.resolve()).catch(() => {}).then(fn);
    chains.set(owner, next); return next;
  };
  const read = async (owner: string): Promise<Record<string, Pending>> => {
    const raw = await storage.getItem(progressJournalKey(owner));
    if (!raw) return {};
    const map = JSON.parse(raw);
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some((v: unknown) => {
      const p = v as Partial<Pending> | null;
      return !p || typeof p.chapterId !== 'string' || !p.chapterId || typeof p.token !== 'string' || !p.token ||
        !Number.isSafeInteger(p.seq) || typeof p.at !== 'number' || !Number.isFinite(p.at);
    })) throw new Error('Okuma konumu yedeği okunamadı; kayıtların değiştirilmedi.');
    return map;
  };
  const write = async (owner: string, map: Record<string, Pending>) => {
    if (await storage.getItem(tombstoneKey(owner))) throw new Error('Hesap silinmiş.');
    if (!Object.keys(map).length) await storage.removeItem(progressJournalKey(owner));
    else await storage.setItem(progressJournalKey(owner), JSON.stringify(map));
    if (await storage.getItem(tombstoneKey(owner))) {
      await storage.removeItem(progressJournalKey(owner));
      throw new Error('Hesap silinmiş.');
    }
  };
  const journal: Journal & { purge: (owner: string) => Promise<void> } = {
    put: (owner, bookId, p) => serial(owner, async () => {
      if (await storage.getItem(tombstoneKey(owner))) throw new Error('Hesap silinmiş.');
      const map = await read(owner); map[bookId] = p; await write(owner, map);
    }),
    get: (owner, bookId) => serial(owner, async () => {
      if (await storage.getItem(tombstoneKey(owner))) return null;
      return (await read(owner))[bookId] ?? null;
    }),
    clear: (owner, bookId, token) => serial(owner, async () => {
      const map = await read(owner);
      if (map[bookId]?.token !== token) return;
      delete map[bookId]; await write(owner, map);
    }),
    purge: owner => serial(owner, () => storage.removeItem(progressJournalKey(owner))),
  };
  return journal;
}
export const progressJournal = createAsyncStorageJournal();
