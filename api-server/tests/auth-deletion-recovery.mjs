import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { transform } from 'esbuild';

// Exercise the real AuthProvider callbacks and effects with a deterministic hook
// harness; native storage/API boundaries are fake, no accounts are contacted.
const sources = new Map();
async function compile(file, deps) {
  let code = sources.get(file);
  if (!code) {
    code = (await transform(await readFile(new URL('../../afilli/' + file, import.meta.url), 'utf8'), { loader: file.endsWith('tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'transform' })).code;
    sources.set(file, code);
  }
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in deps)) throw new Error('Unexpected dependency ' + name);
    return deps[name];
  }, module, module.exports);
  return module.exports;
}
const oldUser = { id: 'old-owner', email: 'old@example.com', nickname: 'Eski', role: 'user' };
const newUser = { id: 'new-owner', email: 'new@example.com', nickname: 'Yeni', role: 'superadmin' };
const sessionKey = 'afilli_account_session_v1', jobPrefix = 'afilli:account-delete-job:v1:';
const localKey = owner => 'afilli:v2:' + owner;
function environment() {
  const e = {
    local: new Map([[localKey(oldUser.id), 'private old library'], [localKey(newUser.id), 'keep new library']]),
    secure: new Map([[sessionKey, JSON.stringify({ token: 'O'.repeat(43), user: oldUser })]]),
    writers: new Map([[oldUser.id, 'private manuscript'], [newUser.id, 'keep new manuscript']]),
    chats: new Map([[oldUser.id, 'private outbox'], [newUser.id, 'keep new outbox']]),
    receipts: new Set(), serverUser: oldUser, failConfirmation: false, failWriter: false, offline: false, failPrepare: false,
  };
  e.storage = {
    getItem: async k => e.local.get(k) ?? null,
    getAllKeys: async () => [...e.local.keys()],
    setItem: async (k, v) => {
      if (e.failConfirmation && k.startsWith('afilli:account-deleted:v1:')) throw new Error('First cleanup write failed');
      if (e.failPrepare && k.startsWith(jobPrefix)) throw new Error('Prepare write failed');
      e.local.set(k, v);
    },
    removeItem: async k => { e.local.delete(k); },
  };
  e.jobs = () => [...e.local.keys()].filter(k => k.startsWith(jobPrefix));
  return e;
}
async function mount(e) {
  const hooks = [], effects = [];
  let index = 0, dirty = false, value, alive = true;
  const same = (a, b) => a?.length === b?.length && a?.every((v, i) => Object.is(v, b[i]));
  const react = {
    createContext: () => ({ Provider: 'TestAuthProvider' }), useContext: () => value,
    useState(init) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init;
      return [hooks[i], next => {
        const result = typeof next === 'function' ? next(hooks[i]) : next;
        if (!Object.is(hooks[i], result)) { hooks[i] = result; dirty = true; }
      }];
    },
    useRef(init) { const i = index++; return hooks[i] ??= { current: init }; },
    useCallback(fn, deps) {
      const i = index++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { fn, deps };
      return hooks[i].fn;
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) {
        hooks[i]?.cleanup?.();
        hooks[i] = { deps }; effects.push(() => { hooks[i].cleanup = fn(); });
      }
    },
    createElement(type, props) { if (type === 'TestAuthProvider') value = props.value; return null; },
  };
  const { createDeletionJobs } = await compile('lib/account-deletion-jobs.ts', {});
  const { waitForLocalClaims } = await compile('lib/local-account-data.ts', { '@react-native-async-storage/async-storage': e.storage });
  const { progressJournal } = await compile('lib/reading-progress-journal.ts', { '@react-native-async-storage/async-storage': e.storage });
  const { removeAccountCache } = await compile('lib/account-local-delete.ts', {
    '@react-native-async-storage/async-storage': e.storage, '@/lib/local-account-data': { waitForLocalClaims },
    './reading-progress-journal': { progressJournal },
  });
  const { AuthProvider } = await compile('context/AuthContext.tsx', {
    react, 'react-native': { Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-secure-store': {
      getItemAsync: async k => e.secure.get(k) ?? null,
      setItemAsync: async (k, v) => { e.secure.set(k, v); },
      deleteItemAsync: async k => { e.secure.delete(k); },
    },
    '@react-native-async-storage/async-storage': e.storage,
    '@/lib/account-local-delete': { removeAccountCache },
    '@/lib/account-deletion-jobs': { createDeletionJobs },
    '@/lib/chat-drafts': { purgeOwnerChatDrafts: async owner => { e.chats.delete(owner); } },
    '@/lib/writer-store': { purgeOwnerWriterRecords: async owner => { if (e.failWriter) throw new Error('Writer disk unavailable'); e.writers.delete(owner); } },
    'expo-crypto': { randomUUID },
    '@tanstack/react-query': { useQueryClient: () => queryClient },
    '@workspace/api-client-react': {
      setAuthTokenGetter() {},
      getAccountSession: async () => { if (e.offline) throw new Error('Offline'); return { user: e.serverUser }; },
      getAccountDeletionStatus: async ({ requestId }) => { if (e.offline) throw new Error('Offline'); return { deleted: e.receipts.has(requestId) }; },
      loginAccount: async ({ email }) => {
        e.serverUser = email === newUser.email ? newUser : oldUser;
        return { user: e.serverUser, token: (e.serverUser.id === newUser.id ? 'N' : 'O').repeat(43) };
      },
      logoutAccount: async () => { e.serverUser = null; },
      registerAccount: async () => { throw new Error('Not used'); },
      resetAccountPassword: async () => { throw new Error('Not used'); },
    },
  });
  function render() { index = 0; dirty = false; AuthProvider({ children: null }); while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 25; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty && alive) render(); } }
  render(); await settle();
  return {
    get value() { if (dirty) render(); return value; },
    async act(fn) { const result = await fn(value); await settle(); return result; },
    unmount() { alive = false; for (const hook of hooks) hook?.cleanup?.(); },
  };
}
const queryClient = { clear() {}, cancelQueries: async () => {} };

// Successful DELETE followed by the FIRST local confirmation write failing.
{
  const e = environment(); let h = await mount(e);
  assert.equal(h.value.userId, oldUser.id);
  const id = await h.act(s => s.beginDeletion(oldUser.id));
  assert.equal(e.jobs().length, 1); // Durable BEFORE remote success.
  e.serverUser = null; e.receipts.add(id); e.failConfirmation = true;
  assert.equal(await h.act(s => s.finalizeDeletion(oldUser.id, id)), false);
  assert.equal(h.value.userId, null); assert.ok(h.value.forgetError);
  assert.equal(e.jobs().length, 1); assert.equal(e.local.has(localKey(oldUser.id)), true);
  h.unmount(); e.failConfirmation = false; h = await mount(e);
  assert.equal(h.value.userId, null); assert.equal(h.value.forgetError, null);
  assert.equal(e.jobs().length, 0); assert.equal(e.local.has(localKey(oldUser.id)), false);
  assert.equal(e.writers.has(oldUser.id), false); assert.equal(e.chats.has(oldUser.id), false);
  assert.equal(e.secure.has(sessionKey), false);
  assert.equal(e.local.get(localKey(newUser.id)), 'keep new library');
  h.unmount();
}

// Partial cleanup must survive both another login and restart, without wiping
// the newer account's identity, session, library, manuscript, or outbox.
{
  const e = environment(); let h = await mount(e);
  const id = await h.act(s => s.beginDeletion(oldUser.id));
  e.serverUser = null; e.receipts.add(id); e.failWriter = true;
  assert.equal(await h.act(s => s.finalizeDeletion(oldUser.id, id)), false);
  await h.act(s => s.login(newUser.email, 'synthetic'));
  assert.equal(h.value.userId, newUser.id); assert.equal(h.value.role, 'superadmin');
  assert.ok(h.value.forgetError); assert.equal(e.jobs().length, 1);
  assert.equal(JSON.parse(e.secure.get(sessionKey)).user.id, newUser.id);
  h.unmount(); h = await mount(e);
  assert.equal(h.value.userId, newUser.id); assert.ok(h.value.forgetError); assert.equal(e.jobs().length, 1);
  e.failWriter = false;
  assert.equal(await h.act(s => s.retryForget()), true);
  assert.equal(h.value.userId, newUser.id); assert.equal(h.value.forgetError, null);
  assert.equal(e.jobs().length, 0); assert.equal(e.writers.has(oldUser.id), false);
  assert.equal(e.local.get(localKey(newUser.id)), 'keep new library');
  assert.equal(e.writers.get(newUser.id), 'keep new manuscript'); assert.equal(e.chats.get(newUser.id), 'keep new outbox');
  assert.equal(JSON.parse(e.secure.get(sessionKey)).user.id, newUser.id);
  h.unmount();
}

// A lost response cannot resurrect the native cached owner offline; reconnect
// uses the original durable job + server receipt without a repeated DELETE.
{
  const e = environment(); let h = await mount(e);
  const id = await h.act(s => s.beginDeletion(oldUser.id));
  e.serverUser = null; e.receipts.add(id);
  await h.act(s => s.abortDeletion(oldUser.id, id, false));
  h.unmount(); e.offline = true; h = await mount(e);
  assert.equal(h.value.userId, null); assert.equal(h.value.offline, true);
  assert.equal(e.jobs().length, 1); assert.equal(e.writers.has(oldUser.id), true);
  e.offline = false; await h.act(s => s.retry());
  assert.equal(h.value.userId, null); assert.equal(h.value.offline, false);
  assert.equal(e.jobs().length, 0); assert.equal(e.writers.has(oldUser.id), false);
  h.unmount();
}

// Known rejection preserves local contents; failure to prepare prevents DELETE.
{
  const e = environment(); const h = await mount(e);
  e.failPrepare = true;
  await assert.rejects(h.act(s => s.beginDeletion(oldUser.id)), /isteği gönderilmedi/);
  assert.equal(e.jobs().length, 0); assert.equal(h.value.userId, oldUser.id);
  e.failPrepare = false; const id = await h.act(s => s.beginDeletion(oldUser.id));
  await h.act(s => s.abortDeletion(oldUser.id, id, true));
  assert.equal(e.jobs().length, 0); assert.equal(e.local.get(localKey(oldUser.id)), 'private old library');
  assert.equal(e.writers.has(oldUser.id), true);
  h.unmount();
}
console.log('PASS real AuthProvider recovery: first cleanup write failure + restart, partial cleanup + different login + restart, newer-session preservation, lost response + offline restore block, known rejection and prepare failure.');
