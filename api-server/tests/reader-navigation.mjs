import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import vm from 'node:vm';

async function load(path, dependencies, suffix = '') {
  const source = await readFile(new URL('../../afilli/' + path, import.meta.url), 'utf8');
  const code = (await transform(source + suffix, { loader: 'tsx', format: 'cjs' })).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, setTimeout, clearTimeout,
    requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {},
    require(name) { assert.ok(name in dependencies, 'Unexpected import ' + name); return dependencies[name]; },
  });
  return module.exports;
}
function reactHarness() {
  const slots = []; let cursor = 0; let effects = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => react.useState({ current: initial })[0],
    useMemo: fn => fn(), useCallback: fn => fn,
    useEffect: fn => { effects.push(fn); },
  };
  return { react, async render(fn) { cursor = 0; effects = []; const result = fn(); for (const effect of effects) effect(); await new Promise(resolve => setImmediate(resolve)); return result; } };
}
function nodes(n) {
  if (Array.isArray(n)) return n.flatMap(nodes);
  return n && typeof n === 'object' ? [n, ...nodes(n.props?.children)] : [];
}
const byId = (tree, id) => nodes(tree).find(n => n.props?.testID === id);
const component = (tree, type) => nodes(tree).find(n => n.type === type);
const swipe = await load('lib/reader-swipe.ts', {});
const drag = (dx, dy = 0, vx = 0, numberActiveTouches = 1) => ({ dx, dy, vx, numberActiveTouches });
assert.equal(swipe.startsChapterSwipe(drag(30, 4)), true);
for (const value of [drag(20), drag(40, 50), drag(100, 0, 0, 2), drag(NaN), drag(Infinity)])
  assert.equal(swipe.startsChapterSwipe(value), false);
assert.equal(swipe.chapterSwipeStep(drag(80)), 1, 'Rightward means NEXT, as explicitly requested');
assert.equal(swipe.chapterSwipeStep(drag(-80)), -1);
assert.equal(swipe.chapterSwipeStep(drag(40, 0, .8)), 1);
for (const value of [drag(40, 0, -.8), drag(70), drag(100, 80), drag(100, 0, 0, 2), drag(NaN)])
  assert.equal(swipe.chapterSwipeStep(value), 0);
assert.equal(swipe.nextChapterIndex(2, 3, 1), null);
assert.equal(swipe.nextChapterIndex(0, 3, -1), null);
assert.equal(swipe.nextChapterIndex(-1, 3, 1), null);
assert.equal(swipe.nextChapterIndex(1, 3, 1), 2);
console.log('PASS swipe direction, vertical/tap/multi-touch guards, flick threshold and chapter boundaries');

const hook = reactHarness(), navigated = [];
const { useReaderSwipe } = await load('hooks/useReaderSwipe.ts', {
  react: hook.react, 'react-native': { PanResponder: { create: handlers => ({ panHandlers: handlers }) } },
  '@/lib/reader-swipe': swipe,
});
let props = { index: 0, count: 3, disabled: false, onSelectIndex: index => navigated.push(index) };
const handlers = await hook.render(() => useReaderSwipe(props));
assert.equal(handlers.onMoveShouldSetPanResponder(null, drag(80)), true);
handlers.onPanResponderGrant();
handlers.onPanResponderStart(null, drag(50, 0, 0, 2));
handlers.onPanResponderRelease(null, drag(100, 0, 0, 0));
assert.deepEqual(navigated, [], 'A multi-touch interaction must not advance on final finger release');
props = { ...props, disabled: true };
await hook.render(() => useReaderSwipe(props));
handlers.onPanResponderGrant();
handlers.onPanResponderRelease(null, drag(100));
assert.deepEqual(navigated, [], 'Even an earlier responder must respect current disabled/owner state');
props = { ...props, disabled: false, index: 1 };
await hook.render(() => useReaderSwipe(props));
handlers.onPanResponderRelease(null, drag(100));
assert.deepEqual(navigated, [2], 'Release must use latest chapter, not a stale closure');
console.log('PASS current-props responder, interrupted multi-touch and disabled navigation');

const controlHarness = reactHarness(), controlCalls = [];
let allowSelection = false;
const controlColors = new Proxy({}, { get: (_, key) => String(key) });
const { ReaderControls } = await load('components/writer/ReaderControls.tsx', {
  react: controlHarness.react,
  'react-native': { FlatList: 'FlatList', Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View',
    Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 360, height: 800 }),
    StyleSheet: { create: x => x, hairlineWidth: 1, absoluteFill: {} } },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
  '@expo/vector-icons': { Feather: 'Feather' }, '@/hooks/useTheme': { makeStyles: fn => () => fn({}) },
  '@/components/ui': { F: {}, tap() {} },
  '@/components/writer/parts': { useWriterPalette: () => controlColors, writerPalette: () => controlColors },
});
let controlProps = {
  chapters: Array.from({ length: 201 }, (_, index) => ({ id: 'c' + index, title: 'Bölüm ' + index, status: 'published' })),
  currentId: 'c1', disabled: false, fontSize: 14, night: false, reading: true, bookTitle: 'Kontrol',
  onSelect: id => { controlCalls.push(id); return allowSelection; }, onFontChange: delta => controlCalls.push(delta),
  onNightToggle() {}, onDetails() {},
};
const renderControls = () => controlHarness.render(() => ReaderControls(controlProps));
let controlTree = await renderControls();
assert.equal(byId(controlTree, 'authored-font-smaller').props.disabled, true);
byId(controlTree, 'chapter-list-open').props.onPress();
controlTree = await renderControls();
assert.equal(component(controlTree, 'Modal').props.visible, true);
let list = component(controlTree, 'FlatList');
assert.equal(list.props.data.length, 201);
assert.equal(list.props.getItemLayout(null, 200).offset, 56 * 200);
let row = list.props.renderItem({ item: controlProps.chapters[1], index: 1 });
assert.equal(row.props.accessibilityState.selected, true);
row.props.onPress(); controlTree = await renderControls();
assert.equal(component(controlTree, 'Modal').props.visible, true, 'Rejected selection must not close the picker');
allowSelection = true;
list = component(controlTree, 'FlatList');
list.props.renderItem({ item: controlProps.chapters[200], index: 200 }).props.onPress();
controlTree = await renderControls();
assert.equal(component(controlTree, 'Modal').props.visible, false);
assert.equal(controlCalls.at(-1), 'c200');
controlProps = { ...controlProps, fontSize: 28, disabled: true };
controlTree = await renderControls();
assert.equal(byId(controlTree, 'authored-font-larger').props.disabled, true);
assert.equal(component(controlTree, 'FlatList').props.renderItem({ item: controlProps.chapters[0], index: 0 }).props.disabled, true);
console.log('PASS real picker controls: 201 chapter rows, selection highlight, rejection/close behavior and disabled font/position controls');

const chapter = (id, status = 'published') => ({ id, title: 'Bölüm ' + id, html: '<p>Korunan metin</p>', status });
const published = { id: 'book', title: 'Korunan kitap', genres: ['Roman'], author: { id: 'author', nickname: 'Test yazarı' },
  chapters: [chapter('a'), chapter('private', 'draft'), chapter('b'), chapter('c')] };
async function readerHarness({ owner = 'reader', pending = false, draft = false } = {}) {
  const h = reactHarness(), writes = [];
  let guarded = true, gesture;
  const state = { desired: null, status: 'idle', error: null };
  const progressStore = {
    settled: async () => {}, pending: async () => null, seed() {}, discard: async () => {},
    request: async (...args) => writes.push(args), retry() {},
  };
  const colors = new Proxy({}, { get: (_, key) => String(key) });
  const types = names => Object.fromEntries(names.map(name => [name, name]));
  const deps = {
    react: h.react, 'react-native': { ...types(['View', 'Pressable', 'Text']), Platform: { OS: 'web' }, StyleSheet: { create: x => x } },
    '@/hooks/useTheme': { makeStyles: fn => () => fn({}) }, '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router: {}, useLocalSearchParams: () => ({}) }, '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@workspace/api-client-react': {
      useGetAuthoredBook: () => ({ data: draft ? null : published, isLoading: false }),
      useGetWriterBook: () => ({ data: draft ? { document: { ...published, chapters: [chapter('d', 'draft')] } } : null, isLoading: false }),
      useGetReadingPosition: () => ({ data: { chapterId: 'a', resumed: true }, isFetchedAfterMount: true, isFetching: pending }),
      getGetAuthoredBookQueryKey: () => [], getGetWriterBookQueryKey: () => [], getGetReadingPositionQueryKey: () => [],
    },
    '@/components/ui': { F: {}, tap() {} }, '@/components/MagazineUI': { MagazineScrollView: 'MagazineScrollView' },
    '@/components/bulletins/TopBar': { TopBar: 'TopBar' },
    '@/components/bulletins/common': { ...types(['Avatar', 'Btn']), apiError: () => '', goSignIn() {}, OFFLINE: '' },
    '@/components/profile/hooks': { scoped: () => [], actorRequest: () => ({}), useOwnerGuard: () => () => guarded, compactCount: x => String(x ?? 0) },
    '@/context/CommunityContext': { useCommunity: () => ({ userId: owner, ready: true }) },
    '@/context/AppContext': { useApp: () => ({ isSaved: () => false, ready: true }) },
    '@/components/writer/parts': { ...types(['WriterCover', 'Banner', 'Skeleton', 'FadeIn']), useWriterPalette: () => colors, writerPalette: () => colors, useCoverUri: () => null },
    '@/components/writer/HtmlView': { HtmlView: 'HtmlView' }, '@/components/writer/BookComments': { BookComments: 'BookComments' },
    '@/components/writer/CopyGuard': types(['CopyGuard', 'CopyProtectionHint']),
    '@/lib/writer-text': { chapterStats: () => ({ words: 2, minutes: 1 }), escapeHtml: x => x, AGE_LABEL: {} },
    '@/lib/reading-progress': { progressStore, useProgress: () => state },
    '@/lib/book-subscriptions': { useSavedBookSetter: () => ({}) },
    '@/components/writer/ReaderControls': { ReaderControls: 'ReaderControls' },
    '@/hooks/useReaderSwipe': { useReaderSwipe: value => { gesture = value; return {}; } },
  };
  const { TestReader } = await load('app/authored-book/[id].tsx', deps, '\nexport { Reader as TestReader };');
  const render = () => h.render(() => TestReader({ bookId: 'book', preview: draft, focusComment: null, notifChapter: null }));
  let tree;
  for (let i = 0; i < 4; i++) tree = await render();
  return { render, tree, writes, guard: value => { guarded = value; }, gesture: () => gesture };
}
const r = await readerHarness();
let tree = r.tree, controls = component(tree, 'ReaderControls');
assert.deepEqual(Array.from(controls.props.chapters, c => c.id), ['a', 'b', 'c'], 'Draft chapters must never enter the published picker');
assert.equal(controls.props.onSelect('private'), false);
assert.equal(controls.props.onSelect('b'), true);
assert.deepEqual(r.writes, [['reader', 'book', 'b']]);
tree = await r.render(); controls = component(tree, 'ReaderControls');
assert.equal(controls.props.reading, true);
controls.props.onNightToggle(); tree = await r.render(); controls = component(tree, 'ReaderControls');
assert.equal(controls.props.night, true);
assert.equal(controls.props.currentId, 'b', 'Changing reading appearance must not change the selected chapter');
assert.equal(component(tree, 'TopBar'), undefined, 'Read action must enter the uncluttered reading view');
assert.ok(component(tree, 'BookComments'), 'Entering reading must not unmount comment drafts');
assert.equal(controls.props.onSelect('c'), true);
tree = await r.render();
assert.equal(byId(tree, 'authored-next').props.disabled, true);
controls = component(tree, 'ReaderControls');
controls.props.onFontChange(100); tree = await r.render();
assert.equal(component(tree, 'ReaderControls').props.fontSize, 28);
component(tree, 'ReaderControls').props.onFontChange(-100); tree = await r.render();
assert.equal(component(tree, 'ReaderControls').props.fontSize, 14);
component(tree, 'ReaderControls').props.onDetails(); tree = await r.render();
assert.ok(component(tree, 'TopBar'));
r.guard(false);
assert.equal(component(tree, 'ReaderControls').props.onSelect('a'), false, 'A stale account callback must not move or persist another account');
const blocked = await readerHarness({ pending: true });
assert.equal(component(blocked.tree, 'ReaderControls').props.disabled, true);
assert.equal(component(blocked.tree, 'ReaderControls').props.onSelect('b'), false);
assert.equal(blocked.gesture().disabled, true);
assert.equal(blocked.writes.length, 0);
for (const args of [{ owner: null }, { draft: true }]) {
  const local = await readerHarness(args);
  local.guard(false); // Guest navigation must not require a signed-in-owner guard.
  const localControls = component(local.tree, 'ReaderControls');
  if (args.owner === null) assert.equal(localControls.props.onSelect('b'), true);
  assert.equal(local.writes.length, 0, 'Guests and private drafts must not write published reading positions');
}
console.log('PASS actual reader wiring: published-only list, guest/draft safety, pending hydration, owner guard, durable chapter intent, details/comments and font limits');

if (process.argv.includes('--prepare-fixture')) {
  if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Development fixture only');
  const { randomUUID } = await import('node:crypto');
  const { writeFile } = await import('node:fs/promises');
  const { accounts } = await import('./helpers/accounts.mjs');
  const { hashPassword } = await import('../src/lib/auth-crypto.ts');
  const { pool } = await import('@workspace/db');
  const email = `reader-stage-${randomUUID()}@example.com`, password = `Synthetic-${randomUUID()}`;
  let user;
  try {
    user = await accounts.users.createUser({ emailAddress: [email], firstName: 'Okuma kontrolü' });
    await pool.query('UPDATE afilli_auth_accounts SET password_hash=$2 WHERE user_id=$1', [user.id, await hashPassword(password)]);
    const session = await accounts.sessions.createSession({ userId: user.id });
    const token = (await accounts.sessions.getToken(session.id)).jwt, bookId = randomUUID();
    const chapters = ['Başlangıç', 'Yolculuk', 'Son', 'Gizli taslak'].map((title, index) => ({
      id: randomUUID(), title, status: index === 3 ? 'draft' : 'published',
      html: `<p>${title}: <strong>Kalın yazı</strong>, <span style="font-weight:300">ince yazı</span>, <span style="font-size:22px">büyük yazı</span>.</p>` +
        Array.from({ length: 14 }, (_, paragraph) => `<p>${title} ${paragraph + 1}. Okur dikey kaydırarak metni okumaya devam eder. Bu metin yalnızca geliştirme ortamındaki otomatik kontrol için oluşturulmuştur.</p>`).join(''),
    }));
    const document = { title: 'Okuma ekranı kontrolü', description: 'Geçici geliştirme kontrolü', genres: ['Roman'],
      ageRating: 'all', language: 'Türkçe', completion: 'completed', cover: 'preset:forest', chapters };
    const call = async (suffix, method, body) => {
      const response = await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/writer-books/${bookId}${suffix}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Afilli-Actor': user.id },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, 200, value?.error ?? String(response.status));
      return value;
    };
    const saved = await call('', 'PUT', { document, expectedRevision: 0, saveId: randomUUID(), localId: bookId });
    await call('/publication', 'POST', { expectedRevision: saved.revision, action: 'publish' });
    const file = `generated-artifacts/writer-management-${randomUUID()}.json`;
    await writeFile(new URL('../../../' + file, import.meta.url), JSON.stringify({ userId: user.id, email, password, bookId, chapterIds: chapters.map(c => c.id) }));
    console.log('BROWSER_FIXTURE=' + file);
  } catch (error) {
    if (user) {
      await pool.query('DELETE FROM authored_books WHERE author_id=$1', [user.id]);
      await accounts.users.deleteUser(user.id);
      await pool.query('DELETE FROM community_users WHERE id=$1', [user.id]);
    }
    throw error;
  } finally { await pool.end(); }
}
