import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const memory = new Map();
let failRemove = false;
const storage = {
  getItem: async key => memory.get(key) ?? null,
  setItem: async (key, value) => { memory.set(key, value); },
  removeItem: async key => { if (failRemove) throw new Error('Disk unavailable'); memory.delete(key); },
};
const code = (await transform(await readFile(new URL('../../lib/account-local-delete.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' })).code;
function load() {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/lib/local-account-data') return { waitForLocalClaims: async () => {} };
    if (name === './reading-progress-journal') return { progressJournal: { purge: owner => storage.removeItem('afilli:reading-pending:v1:' + owner) } };
    return storage;
  }, module, module.exports);
  return module.exports;
}
const { saveAccountCache, removeAccountCache } = load();
const guestData = JSON.stringify({ guestAfterClaim: 'removed', drafts: [{ body: 'new guest data' }] });
await saveAccountCache('removed', 'private manuscript');
await saveAccountCache('other', 'other author data');
await saveAccountCache(null, guestData);
memory.set('afilli:legacy-owner:v1', JSON.stringify({ ownerId: 'removed', state: { drafts: ['private recovery copy'] } }));
memory.set('afilli:v1', JSON.stringify({ drafts: [{ ownerId: 'removed', body: 'remove' }, { body: 'claimed anonymous copy' }, { ownerId: 'other', body: 'keep' }] }));
await Promise.all([saveAccountCache('removed', 'queued before deletion'), removeAccountCache('removed')]);
await saveAccountCache('removed', 'late unmount write');
assert.equal(memory.has('afilli:v2:removed'), false);
assert.equal(memory.get('afilli:v2:other'), 'other author data');
assert.equal(memory.get('afilli:v2:guest'), guestData);
assert.deepEqual(JSON.parse(memory.get('afilli:legacy-owner:v1')), { ownerId: 'removed' });
assert.deepEqual(JSON.parse(memory.get('afilli:v1')).drafts, [{ ownerId: 'other', body: 'keep' }]);
// A second JS context or restart also respects the durable marker.
await load().saveAccountCache('removed', 'must not resurrect');
assert.equal(memory.has('afilli:v2:removed'), false);
await assert.rejects(removeAccountCache('guest'));
failRemove = true;
await assert.rejects(removeAccountCache('removed'), /Disk unavailable/);
assert.equal(memory.get('afilli:v2:other'), 'other author data');
failRemove = false;
await removeAccountCache('removed');
// Legacy records owned explicitly by the deleted user are also removed when
// another account holds the anonymous import reservation.
const otherClaim = JSON.stringify({ ownerId: 'other', state: { drafts: ['other snapshot'] } });
memory.set('afilli:legacy-owner:v1', otherClaim);
memory.set('afilli:v1', JSON.stringify({ name: 'keep name', drafts: [{ ownerId: 'removed', body: 'remove' }, { body: 'keep anonymous' }, { ownerId: 'other', body: 'keep' }] }));
await removeAccountCache('removed');
assert.equal(memory.get('afilli:legacy-owner:v1'), otherClaim);
assert.deepEqual(JSON.parse(memory.get('afilli:v1')), { name: 'keep name', drafts: [{ body: 'keep anonymous' }, { ownerId: 'other', body: 'keep' }] });
// A pre-claim anonymous snapshot is owned by the deleted claimant; unlike a
// newer guest session it must not leave recoverable private text behind.
memory.set('afilli:legacy-owner:v1', JSON.stringify({ ownerId: 'removed' }));
memory.set('afilli:v2:guest', JSON.stringify({ drafts: [{ body: 'claimed old anonymous text' }] }));
await removeAccountCache('removed');
assert.deepEqual(JSON.parse(memory.get('afilli:v2:guest')).drafts, []);
console.log('PASS local deletion: pending and late writes, restart safety, legacy plaintext removal, unrelated/guest preservation and cleanup retry.');
