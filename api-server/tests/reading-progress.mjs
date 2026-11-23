import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { transform } from 'esbuild';
async function load(file, deps) {
  const src = await readFile(new URL('../../lib/' + file, import.meta.url), 'utf8');
  const code = (await transform(src, { loader: 'ts', format: 'cjs' })).code, module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in deps)) throw new Error('Unexpected import ' + name);
    return deps[name];
  }, module, module.exports);
  return module.exports;
}
const memory = new Map();
let failPut = false, failClear = false, holdPut;
const storage = {
  getItem: async k => memory.get(k) ?? null,
  setItem: async (k, v) => { if (failPut) throw new Error('Disk full'); if (holdPut) await holdPut; memory.set(k, v); },
  removeItem: async k => { if (failClear) throw new Error('Disk unavailable'); memory.delete(k); },
};
const { createAsyncStorageJournal, progressJournalKey } = await load('reading-progress-journal.ts', { '@react-native-async-storage/async-storage': storage });
const journal = createAsyncStorageJournal(storage);
const { createProgressStore } = await load('reading-progress.ts', {
  react: {}, 'expo-crypto': { randomUUID }, '@workspace/api-client-react': {},
  './reading-progress-journal': { progressJournal: journal },
});
const tick = () => new Promise(r => setTimeout(r, 0));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await tick(); } assert.fail('Timed out'); }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const result = chapterId => ({ chapterId, resumed: true, chapterMissing: false });
let live = 'owner', calls = [], waits = [];
const transport = (owner, book, chapter) => {
  calls.push({ owner, book, chapter });
  const d = deferred(); waits.push(d); return d.promise.then(() => result(chapter));
};
const make = () => createProgressStore({ journal, transport, canSend: owner => owner === live });
let store = make();
store.seed('owner', 'book', 'A');
const off = store.subscribe('owner', 'book', () => {});
const b = store.request('owner', 'book', 'B');
await until(() => calls.length === 1);
const a = store.request('owner', 'book', 'A');
off(); // leaving the screen cannot drop the later target
await until(() => JSON.parse(memory.get(progressJournalKey('owner'))).book.chapterId === 'A');
waits[0].resolve();
await until(() => calls.length === 2);
assert.equal(calls[1].chapter, 'A');
assert.equal((await journal.get('owner', 'book')).chapterId, 'A', 'old B acknowledgement cannot erase pending A');
waits[1].resolve(); await Promise.all([a, b]); await store.settled('owner', 'book');
assert.equal(store.snapshot('owner', 'book').confirmed, 'A');
assert.equal(store.snapshot('owner', 'book').status, 'saved');
assert.equal(await journal.get('owner', 'book'), null);
// Each newer intent must finish journaling before its transport begins.
const delayed = deferred(); holdPut = delayed.promise;
const c = store.request('owner', 'book', 'C'); await tick();
assert.equal(calls.length, 2);
holdPut = null; delayed.resolve(); await until(() => calls.length === 3);
waits[2].resolve(); await c;
// A restart recovers an unsent target, and another owner cannot receive its posts.
live = 'other';
await store.request('owner', 'book', 'D');
assert.equal(calls.length, 3);
store = make();
const pending = await store.pending('owner', 'book');
assert.equal(pending.chapterId, 'D');
assert.equal(await store.pending('other', 'book'), null);
live = 'owner';
store.seed('owner', 'book', 'C');
const d = store.request('owner', 'book', pending.chapterId);
await until(() => calls.length === 4); waits[3].resolve(); await d;
assert.equal(calls[3].owner, 'owner');
// Disk failures fail closed, never claiming "saved" and never sending without a backup.
failPut = true;
await store.request('owner', 'disk', 'E');
assert.equal(calls.length, 4); assert.equal(store.snapshot('owner', 'disk').status, 'error');
failPut = false; store.retry('owner', 'disk');
await until(() => calls.length === 5); waits[4].resolve(); await store.settled('owner', 'disk');
assert.equal(store.snapshot('owner', 'disk').status, 'saved');
// Failed acknowledgement cleanup retains a recoverable journal, not a false saved state.
const f = store.request('owner', 'ack', 'F'); await until(() => calls.length === 6);
failClear = true; waits[5].resolve(); await f;
assert.equal(store.snapshot('owner', 'ack').status, 'error');
assert.equal((await journal.get('owner', 'ack')).chapterId, 'F');
failClear = false;
const retired = await store.pending('owner', 'ack'); await store.discard('owner', 'ack', retired);
assert.equal(await journal.get('owner', 'ack'), null);
// Tombstoned owners cannot resurrect pending metadata after account deletion.
await storage.setItem('afilli:account-deleted:v1:owner', '1');
await journal.purge('owner');
await assert.rejects(journal.put('owner', 'book', { chapterId: 'G', seq: 1, at: 1, token: randomUUID() }));
assert.equal(memory.has(progressJournalKey('owner')), false);
// Corrupt backups must not be silently replaced.
memory.set(progressJournalKey('broken'), '{bad');
await assert.rejects(journal.get('broken', 'book'));
assert.equal(memory.get(progressJournalKey('broken')), '{bad');
console.log('PASS reading progress: reverse selection, unmount, serialized posts, journal-before-send, restart, account isolation, disk/ack failures, deletion and corruption.');
