import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const memory = new Map();
let failWrite = false, forcedId = null;
const storage = {
  getItem: async key => memory.get(key) ?? null,
  setItem: async (key, value) => { if (failWrite) throw new Error('Disk full'); memory.set(key, value); },
  removeItem: async key => memory.delete(key),
  getAllKeys: async () => [...memory.keys()],
};
const crypto = { randomUUID: () => forcedId ?? randomUUID(), CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_, text) => createHash('sha256').update(text).digest('hex') };
async function load(file, dependencies) {
  const source = await readFile(new URL('../../lib/' + file, import.meta.url), 'utf8');
  const code = (await transform(source, { loader: 'ts', format: 'cjs' })).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Error, require: name => {
    if (!(name in dependencies)) throw new Error('Unexpected import: ' + name);
    return dependencies[name];
  } });
  return module.exports;
}
const store = await load('writer-store.ts', { '@/lib/writer-storage': storage, 'expo-crypto': crypto });
const text = await load('writer-text.ts', { 'expo-crypto': crypto });
const dependencies = { './writer-store': store, './writer-text': text, 'expo-crypto': crypto };
const creator = await load('writer-create.ts', dependencies);
assert.equal(memory.size, 0, 'Importing the entry helpers must not create a book');
await assert.rejects(creator.createWriterBook('author-A', () => false), /Hesap değişti/);
assert.equal(memory.size, 0);
const id = await creator.createWriterBook('author-A', () => true);
const saved = await store.readRecord('author-A', id);
assert.equal(saved.owner, 'author-A');
assert.equal(saved.doc.chapters.length, 1);
assert.equal(await store.readRecord('author-B', id), null);
const original = JSON.stringify(saved);
forcedId = id;
await assert.rejects(creator.createWriterBook('author-A', () => true), /çakıştı/);
forcedId = null;
assert.equal(JSON.stringify(await store.readRecord('author-A', id)), original);
const beforeFailure = (await store.listRecords('author-A')).records.length;
failWrite = true;
await assert.rejects(creator.createWriterBook('author-A', () => true), /Disk full/);
failWrite = false;
assert.equal((await store.listRecords('author-A')).records.length, beforeFailure);
let current = true;
const switched = await load('writer-create.ts', { ...dependencies, './writer-store': {
  ...store, updateRecord: (...args) => { current = false; return store.updateRecord(...args); },
} });
await assert.rejects(switched.createWriterBook('author-A', () => current), /Hesap değişti/);
assert.equal((await store.listRecords('author-A')).records.length, beforeFailure);
assert.equal(JSON.stringify(await store.readRecord('author-A', id)), original);
console.log('PASS explicit durable creation, account-switch guard, owner isolation, collision and storage-failure preservation');

const many = { ...text.emptyDocument(), chapters: Array.from({ length: 241 }, (_, index) => text.newChapter(index + 1)) };
await store.updateRecord('author-A', id, record => ({ ...record, doc: many, version: record.version + 1, editStamp: store.newStamp() }));
assert.equal((await store.readRecord('author-A', id)).doc.chapters.length, 241);
const baseline = await store.fingerprintDocument(saved.doc, 1);
const next = await store.fingerprintDocument(many, 1);
const delta = store.chapterDelta(many, baseline, next, randomUUID());
assert.equal(delta.upserts.length, 241);
assert.equal(delta.chapterOrder.length, 241);
const { chapterWindow, CHAPTER_PAGE_SIZE } = await load('writer-chapter-pages.ts', {});
for (const count of [0, 1, 20, 21, 200, 201, 241, 10001]) {
  const pages = chapterWindow(count, 0).pages;
  const visited = [];
  for (let page = 0; page < pages; page++) {
    const range = chapterWindow(count, page);
    assert.ok(range.end - range.start <= CHAPTER_PAGE_SIZE);
    for (let index = range.start; index < range.end; index++) visited.push(index);
  }
  assert.deepEqual(visited, Array.from({ length: count }, (_, index) => index));
  assert.equal(chapterWindow(count, -5).page, 0);
  assert.equal(chapterWindow(count, 999999).page, pages - 1);
}
console.log('PASS 241-chapter local save/reopen/delta and bounded, complete page access beyond chapter 200');

async function creationHarness(createWriterBook, onOpen) {
  const states = [], refs = [];
  let focusCallback, blur;
  const react = {
    useCallback: fn => fn,
    useRef: value => { const ref = { current: value }; refs.push(ref); return ref; },
    useState: value => { const index = states.length; states.push(value); return [value, next => { states[index] = next; }]; },
  };
  const module = await load('../components/writer/useNewWriterBook.ts', {
    react, 'expo-router': { useFocusEffect: fn => { focusCallback = fn; blur = fn(); } },
    '@/lib/writer-create': { createWriterBook },
  });
  const hook = module.useNewWriterBook('author-A', onOpen);
  return { hook, states, refs, blur: () => blur(), focus: () => { blur = focusCallback(); } };
}
let calls = 0, finish;
const opened = [];
const repeated = await creationHarness(async () => { calls++; return new Promise(resolve => { finish = resolve; }); }, id => opened.push(id));
const firstClick = repeated.hook.create(), secondClick = repeated.hook.create();
assert.equal(calls, 1);
finish('one-book');
await Promise.all([firstClick, secondClick]);
await repeated.hook.create();
assert.deepEqual(opened, ['one-book']);
assert.equal(calls, 1, 'Navigation remains locked after committing the new book');
repeated.blur();
await repeated.hook.create();
assert.equal(calls, 1);
const switchedOpens = [];
const late = await creationHarness(async () => new Promise(resolve => { finish = resolve; }), id => switchedOpens.push(id));
const pending = late.hook.create();
late.refs[2].current = 'author-B';
finish('old-owner-book');
await pending;
assert.deepEqual(switchedOpens, [], 'A changed account must never be navigated to the former owner’s new book');
let attempts = 0;
const retryOpens = [];
const failed = await creationHarness(async () => {
  if (++attempts === 1) throw new Error('Disk full');
  return 'retried-book';
}, id => retryOpens.push(id));
await failed.hook.create();
assert.equal(failed.states[0], false);
assert.match(failed.states[1], /Disk full/);
await failed.hook.create();
assert.deepEqual(retryOpens, ['retried-book']);
let committed = 0, navigationAttempts = 0;
const navigation = await creationHarness(async () => { committed++; return 'committed-book'; }, () => {
  if (++navigationAttempts === 1) throw new Error('Navigation failed');
});
await navigation.hook.create();
await navigation.hook.create();
assert.equal(committed, 1, 'Retrying navigation must reuse the already committed new book');
assert.equal(navigationAttempts, 2);
console.log('PASS double-click deduplication, focus/navigation locks, late-account guard and safe creation/navigation retries');
