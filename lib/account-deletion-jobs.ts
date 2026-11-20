export type DeletionJob = { owner: string; requestId: string };
type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  getAllKeys: () => Promise<readonly string[]>;
};
const prefix = 'afilli:account-delete-job:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Provider-owned recovery coordinator. A job is durable BEFORE DELETE and is
 * never retired merely because a session ended, changed, or a write failed. */
export function createDeletionJobs(deps: {
  storage: Storage; newId: () => string;
  receipt: (requestId: string) => Promise<boolean>;
  purge: (owner: string) => Promise<void>;
  clearSavedSession: (owner: string) => Promise<void>;
}) {
  const { storage } = deps;
  let tail: Promise<unknown> = Promise.resolve();
  const knownDeleted = new Set<string>();
  async function jobs(): Promise<DeletionJob[]> {
    const result: DeletionJob[] = [];
    for (const key of (await storage.getAllKeys()).filter(k => k.startsWith(prefix))) {
      const raw = await storage.getItem(key);
      if (raw === null) continue;
      const job = JSON.parse(raw) as DeletionJob;
      if (typeof job?.owner !== 'string' || !job.owner || job.owner === 'guest' || typeof job.requestId !== 'string' || !uuid.test(job.requestId) || key !== prefix + job.requestId) throw new Error('Silme kurtarma kaydı okunamadı.');
      result.push(job);
    }
    return result;
  }
  return {
    jobs,
    async prepare(owner: string) {
      if (!owner || owner === 'guest') throw new Error('Hesap kimliği gerekli.');
      const job = { owner, requestId: deps.newId() };
      if (!uuid.test(job.requestId)) throw new Error('Silme isteği kimliği oluşturulamadı.');
      await storage.setItem(prefix + job.requestId, JSON.stringify(job));
      return job.requestId;
    },
    async reject(requestId: string) {
      // Only a known server rejection (not timeout or logout) can cancel intent.
      await storage.removeItem(prefix + requestId);
    },
    run(confirmedRequestId?: string): Promise<{ remaining: DeletionJob[]; failed: boolean }> {
      if (confirmedRequestId) knownDeleted.add(confirmedRequestId);
      const run = tail.catch(() => {}).then(async () => {
        const remaining: DeletionJob[] = [];
        let failed = false;
        for (const job of await jobs()) {
          try {
            const confirmedOwner = await storage.getItem('afilli:account-deleted:v1:' + job.owner);
            if (!knownDeleted.has(job.requestId) && !confirmedOwner && !await deps.receipt(job.requestId)) {
              remaining.push(job); continue;
            }
            knownDeleted.add(job.requestId);
            // No confirmation write is necessary here: the original durable
            // job plus the transactional server receipt survives first-write failure.
            await deps.purge(job.owner);
            await deps.clearSavedSession(job.owner);
            await storage.removeItem(prefix + job.requestId);
            knownDeleted.delete(job.requestId);
          } catch { failed = true; remaining.push(job); }
        }
        return { remaining, failed };
      });
      tail = run;
      return run;
    },
  };
}
