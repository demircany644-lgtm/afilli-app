import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/writer-storage.ts', import.meta.url), 'utf8');

// Model SDK 58's asynchronous native write, including File.move changing uri.
// No device files, production data or native modules are touched.
function fixture() {
  const files = new Map(), dirs = new Set(), legacy = new Map();
  const control = { failWrite: false, partialWrite: false, failMove: false };
  const join = parts => parts.map(p => typeof p === 'string' ? p : p.uri).join('/');
  class Directory {
    constructor(...parts) { this.uri = join(parts); }
    get name() { return this.uri.split('/').at(-1); }
    get exists() { return dirs.has(this.uri); }
    create() { dirs.add(this.uri); dirs.add('document/afilli-writer-v1'); }
    list() {
      const parent = this.uri + '/';
      return [...dirs].filter(p => p.startsWith(parent) && !p.slice(parent.length).includes('/')).map(p => new Directory(p))
        .concat([...files.keys()].filter(p => p.startsWith(parent) && !p.slice(parent.length).includes('/')).map(p => new File(p)));
    }
  }
  class File {
    constructor(...parts) { this.uri = join(parts); }
    get name() { return this.uri.split('/').at(-1); }
    get exists() { return files.has(this.uri); }
    async write(bytes) {
      await new Promise(resolve => setImmediate(resolve));
      if (control.failWrite) throw new Error('disk full');
      files.set(this.uri, control.partialWrite ? bytes.slice(0, 10) : bytes);
    }
    async text() {
      if (!files.has(this.uri)) throw new Error('ENOENT');
      return files.get(this.uri);
    }
    async move(target) {
      await new Promise(resolve => setImmediate(resolve));
      if (control.failMove) throw new Error('rename failed');
      files.set(target.uri, files.get(this.uri)); files.delete(this.uri); this.uri = target.uri;
    }
    delete() { files.delete(this.uri); }
  }
  const asyncStorage = {
    getItem: async key => legacy.get(key) ?? null,
    removeItem: async key => { legacy.delete(key); },
    getAllKeys: async () => [...legacy.keys()],
  };
  const mocks = {
    '@react-native-async-storage/async-storage': { default: asyncStorage, __esModule: true },
    'expo-file-system': { Directory, File, Paths: { document: 'document' } },
    'expo-crypto': { randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' },
      digestStringAsync: async (_, value) => createHash('sha256').update(value).digest('hex') },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => { if (!mocks[name]) throw new Error(name); return mocks[name]; } });
  return { storage: module.exports.default, files, legacy, control };
}
const key = 'afilli:writer:v1:book:reader_1:book-1';

test('native save waits for asynchronous bytes before verification and commit', async () => {
  const { storage, files } = fixture();
  await storage.setItem(key, 'Türkçe bölüm metni');
  assert.equal(await storage.getItem(key), 'Türkçe bölüm metni');
  assert.equal(files.size, 1, 'moving the temporary File must not delete the committed file');
  assert.ok([...files.keys()][0].endsWith('.json'));
});
for (const mode of ['failWrite', 'partialWrite', 'failMove']) {
  test(`${mode} preserves the last acknowledged manuscript`, async () => {
    const { storage, control, files } = fixture();
    await storage.setItem(key, 'önceki tam kitap');
    control[mode] = true;
    await assert.rejects(storage.setItem(key, 'yeni kitap'));
    assert.equal(await storage.getItem(key), 'önceki tam kitap');
    assert.equal([...files.keys()].some(p => p.endsWith('.tmp')), false);
  });
}
test('deletion marker prevents resurrection from old AsyncStorage bytes', async () => {
  const { storage, legacy } = fixture();
  await storage.setItem(key, 'metin');
  await storage.removeItem(key);
  legacy.set(key, 'eski metin');
  assert.equal(await storage.getItem(key), null);
});
test('interrupted temporary generation is ignored, not treated as a committed book', async () => {
  const { storage, files } = fixture();
  await storage.setItem(key, 'korunan kitap');
  const folder = [...files.keys()][0].split('/').slice(0, -1).join('/');
  files.set(folder + '/9999999999999999-interrupted.tmp', 'partial');
  assert.equal(await storage.getItem(key), 'korunan kitap');
});
test('corrupt committed bytes fail explicitly without erasing data or falling back', async () => {
  const { storage, files, legacy } = fixture();
  await storage.setItem(key, 'korunan kitap');
  files.set([...files.keys()][0], '{broken');
  legacy.set(key, 'older snapshot');
  await assert.rejects(storage.getItem(key), /silinmedi/);
  assert.equal(files.size, 1);
  assert.equal(legacy.get(key), 'older snapshot');
});
