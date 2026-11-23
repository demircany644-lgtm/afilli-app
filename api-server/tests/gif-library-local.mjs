import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { transform } from 'esbuild';

async function load(path, imports) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const code = (await transform(source, { loader: 'ts', format: 'cjs' })).code, module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { if (!(name in imports)) throw Error('Unexpected import ' + name); return imports[name]; }, module, module.exports);
  return module.exports;
}
let requests = [], puts = 0, attempts = 0, ready = false, assets = [], pickerOptions;
const id = randomUUID(), clientId = randomUUID();
const gif = { provider: 'afilli', id, title: 'Original', url: `afilli://gif-library/${id}`, sourceUrl: `afilli://gif-library/${id}`, width: 1, height: 1, attribution: 'Afilli GIF', license: null };
const helper = await load('../../lib/library-gif-uploads.ts', {
  'react-native': { Platform: { OS: 'web' } },
  'expo-image-picker': { launchImageLibraryAsync: async options => { pickerOptions = options; return { canceled: false, assets }; } },
  'expo-file-system': {},
  'expo-crypto': { randomUUID },
  'expo/fetch': { fetch: async () => { puts++; return { ok: true }; } },
  '@workspace/api-client-react': {
    requestLibraryGifUpload: async input => { requests.push(input); return { id, ready, uploadUrl: ready ? null : 'https://storage.invalid/synthetic' }; },
    completeLibraryGifUpload: async () => { attempts++; ready = true; if (attempts === 1) throw Error('Lost completion acknowledgement'); return gif; },
  },
});
const valid = new Blob([Buffer.from('47494638396101000100800000ff00000000ff3b', 'hex')]);
assets = [
  { uri: 'local:one', file: valid, fileName: 'one.gif', fileSize: valid.size },
  { uri: 'local:two', file: valid, fileName: 'two.gif', fileSize: valid.size },
  { uri: 'local:fake', file: new Blob(['not-a-gif']), fileName: 'bad.gif' },
  { uri: 'local:huge', fileSize: 5242881, fileName: 'huge.gif' },
  { uri: 'local:wide', width: 9000, height: 9000, file: valid },
];
const picked = await helper.chooseLibraryGifs();
assert.equal(pickerOptions.quality, 1); assert.equal(pickerOptions.allowsEditing, false); assert.ok(pickerOptions.allowsMultipleSelection);
assert.equal(picked.length, 5); assert.equal(new Set(picked.map(p => p.clientId)).size, 5);
assert.equal(picked[0].error, undefined); assert.equal(picked[1].error, undefined);
assert.match(picked[2].error, /gerçek bir GIF/); assert.match(picked[3].error, /5 MB/); assert.match(picked[4].error, /2000/);
assert.ok(picked[0].uri.startsWith('blob:'));
for (const p of picked) await helper.releaseLibraryGif(p);
assets = Array(21).fill(assets[0]);
await assert.rejects(() => helper.chooseLibraryGifs(), /20 GIF/);
const item = { clientId, title: 'Original', uri: 'blob:local', size: 8, blob: new Blob(['GIF89a']) };
await assert.rejects(() => helper.uploadLibraryGif(item, {}, () => false), /Hesap/);
assert.equal(requests.length, 0);
await assert.rejects(() => helper.uploadLibraryGif({ ...item, error: 'Invalid' }, {}, () => true), /Invalid/);
assert.equal(requests.length, 0);
await assert.rejects(() => helper.uploadLibraryGif(item, {}, () => true), /Lost completion/);
assert.deepEqual(await helper.uploadLibraryGif(item, {}, () => true), gif);
assert.equal(puts, 1, 'Ready retry does not upload bytes again');
assert.deepEqual(requests.map(r => r.clientId), [clientId, clientId], 'Same file keeps idempotency identity');
const ctrl = new AbortController(); ctrl.abort();
await assert.rejects(() => helper.uploadLibraryGif(item, { signal: ctrl.signal }, () => true), /Hesap/);
assert.equal(requests.length, 2);

const storage = new Map(), drafts = await load('../../lib/chat-drafts.ts', {
  '@react-native-async-storage/async-storage': {
    getItem: async k => storage.get(k) ?? null, setItem: async (k, v) => storage.set(k, v),
    removeItem: async k => storage.delete(k), getAllKeys: async () => [...storage.keys()],
  },
});
const message = { clientId: randomUUID(), body: 'Caption', gif };
await drafts.enqueueOutbox('A', 'thread', message, () => '');
assert.deepEqual((await drafts.readChatDraft('A', 'thread')).outbox[0].gif, gif);
assert.deepEqual((await drafts.readChatDraft('B', 'thread')).outbox, []);
for (const bad of [{ ...gif, url: 'https://evil.invalid/track' }, { ...gif, id: 'not-uuid' }, { ...gif, sourceUrl: 'https://evil.invalid' }])
  assert.throws(() => drafts.parseChatDraft(JSON.stringify({ body: '', outbox: [{ ...message, gif: bad }] })));
await drafts.ackOutbox('A', 'thread', message.clientId);
assert.equal((await drafts.readChatDraft('A', 'thread')).outbox.length, 0);
process.stdout.write('PASS GIF retry identities, lost ACK, ready-file reuse, cancellation, owner guards, durable local GIF drafts and spoofed URI rejection\n');
