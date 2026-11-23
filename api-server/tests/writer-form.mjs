import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const GENRES = ['Roman', 'Hikaye', 'Şiir', 'Fantastik', 'Bilim Kurgu', 'Korku', 'Aşk', 'Tarihi'];
const colors = new Proxy({}, { get: (_, name) => String(name) });
async function harness(file, initialProps, overrides = {}) {
  const states = [];
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => {
      const index = cursor++;
      if (index >= states.length) states.push(typeof initial === 'function' ? initial() : initial);
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useEffect: () => {},
    useRef: initial => react.useState({ current: initial })[0],
  };
  react.Fragment = 'Fragment';
  const dependencies = {
    react,
    'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
      Keyboard: { dismiss() {} }, StyleSheet: { create: value => value, hairlineWidth: 1 } },
    '@expo/vector-icons': { Feather: 'Feather' },
    '@/hooks/useTheme': { makeStyles: fn => () => fn({}) },
    '@/components/ui': { F: {}, tap() {} },
    '@/lib/writer-text': { GENRES, LANGUAGES: ['Türkçe', 'English'], TITLE_MAX: 100, DESC_MAX: 500, CHAPTER_TITLE_MAX: 150 },
    '@/components/writer/parts': { useWriterPalette: () => colors, writerPalette: () => colors,
      Chip: 'Chip', Segmented: 'Segmented', Label: 'Label' },
    '@/components/bulletins/common': { Sheet: 'Sheet', SheetRow: 'SheetRow', Btn: 'Btn' },
    ...overrides,
  };
  const source = await readFile(new URL('../../afilli/components/writer/' + file + '.tsx', import.meta.url), 'utf8');
  const code = (await transform(source, { loader: 'tsx', format: 'cjs' })).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    assert.ok(name in dependencies, `Unmocked dependency ${name}`);
    return dependencies[name];
  } });
  let props = initialProps;
  const render = nextProps => { cursor = 0; if (nextProps) props = nextProps; return module.exports[file](props); };
  return { render, states };
}
function allNodes(node) {
  if (Array.isArray(node)) return node.flatMap(allNodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...allNodes(node.props?.children)];
}
function byId(tree, id) {
  const node = allNodes(tree).find(node => node.props?.testID === id);
  assert.ok(node, `Missing ${id}`);
  return node;
}
const original = {
  title: 'Korunan kitap', description: 'Korunan açıklama', genres: ['Roman', 'Şiir'],
  language: 'Türkçe', ageRating: '13', completion: 'completed', cover: 'preset:forest',
  chapters: [{ id: 'one', title: 'Korunan bölüm', html: '<p>Kalıcı metin</p>', status: 'draft' }],
};
let edits = 0;
const api = { rec: { doc: structuredClone(original) }, edit(fn) {
  const next = fn(this.rec.doc);
  if (next !== this.rec.doc) { this.rec.doc = next; edits++; }
} };
const savedChapters = api.rec.doc.chapters;
const form = await harness('BookInfo', { api });
let tree = form.render();
assert.equal(edits, 0, 'Rendering must not rewrite saved metadata');
assert.deepEqual(api.rec.doc, original);
byId(tree, 'writer-category-open').props.onPress();
tree = form.render();
assert.equal(byId(tree, 'writer-category-sheet').props.visible, true);
assert.equal(edits, 0);
byId(tree, 'writer-category-sheet').props.onClose();
tree = form.render();
assert.equal(byId(tree, 'writer-category-sheet').props.visible, false);
assert.deepEqual(api.rec.doc, original, 'Dismissal must preserve all existing metadata');
byId(tree, 'writer-category-open').props.onPress();
tree = form.render();
byId(tree, 'genre-Roman').props.onPress();
tree = form.render();
assert.deepEqual([...api.rec.doc.genres], ['Roman', 'Şiir'], 'Choosing an existing category must not remove it or other saved genres');
assert.equal(byId(tree, 'writer-category-sheet').props.visible, false);
byId(tree, 'writer-category-open').props.onPress();
tree = form.render();
byId(tree, 'genre-Hikaye').props.onPress();
tree = form.render();
assert.deepEqual([...api.rec.doc.genres], ['Roman', 'Şiir', 'Hikaye']);
assert.equal(byId(tree, 'writer-category-sheet').props.visible, false, 'A successful choice closes the category list');
byId(tree, 'writer-category-open').props.onPress();
tree = form.render();
byId(tree, 'genre-Fantastik').props.onPress();
tree = form.render();
assert.deepEqual([...api.rec.doc.genres], ['Roman', 'Şiir', 'Hikaye'], 'Existing maximum-three category contract must remain intact');
assert.equal(byId(tree, 'writer-category-sheet').props.visible, true);
byId(tree, 'writer-category-sheet').props.onClose();
tree = form.render();
byId(tree, 'writer-category-remove-Şiir').props.onPress();
tree = form.render();
assert.deepEqual([...api.rec.doc.genres], ['Roman', 'Hikaye'], 'Category removal must be explicit');
assert.equal(api.rec.doc.chapters, savedChapters);
assert.equal(JSON.stringify(api.rec.doc.chapters), JSON.stringify(original.chapters));
assert.equal(api.rec.doc.cover, original.cover);
assert.equal(api.rec.doc.ageRating, original.ageRating);
assert.equal(api.rec.doc.language, original.language);
assert.equal(api.rec.doc.completion, original.completion);
const beforeDisclosure = JSON.stringify(api.rec.doc), beforeDisclosureEdits = edits;
byId(tree, 'writer-more-toggle').props.onPress();
tree = form.render();
assert.ok(byId(tree, 'writer-age'));
assert.ok(byId(tree, 'writer-completion'));
byId(tree, 'writer-more-toggle').props.onPress();
tree = form.render();
assert.equal(JSON.stringify(api.rec.doc), beforeDisclosure);
assert.equal(edits, beforeDisclosureEdits, 'Opening/collapsing advanced settings must not alter saved values');
byId(tree, 'writer-title').props.onChangeText('Yeni kitap adı');
byId(tree, 'writer-description').props.onChangeText('Yeni açıklama');
assert.equal(api.rec.doc.title, 'Yeni kitap adı');
assert.equal(api.rec.doc.description, 'Yeni açıklama');
assert.equal(JSON.stringify(api.rec.doc.chapters), JSON.stringify(original.chapters));
console.log('PASS category opening/dismissal, immediate closing after selection, multiple-genre preservation and explicit removal');

const events = [];
const chapterProps = { chapter: original.chapters[0], count: 3, busy: false, disabled: false,
  onTitleChange: value => events.push(['title', value]), onAdd: () => events.push(['add']), onSave: () => events.push(['save']) };
const chapterForm = await harness('WriterChapterFields', chapterProps);
tree = chapterForm.render();
assert.equal(byId(tree, 'writer-chapter-title').props.value, original.chapters[0].title);
assert.equal(byId(tree, 'writer-chapter-title').props.maxLength, 150);
assert.deepEqual(events, [], 'Rendering chapter fields must never save or add automatically');
byId(tree, 'writer-chapter-title').props.onChangeText('Yeni bölüm adı');
byId(tree, 'writer-form-add-chapter').props.onPress();
byId(tree, 'writer-form-save-chapter').props.onPress();
assert.deepEqual(events, [['title', 'Yeni bölüm adı'], ['add'], ['save']]);
tree = chapterForm.render({ ...chapterProps, disabled: true });
assert.equal(byId(tree, 'writer-chapter-title').props.editable, false);
assert.equal(byId(tree, 'writer-form-add-chapter').props.disabled, true);
assert.equal(byId(tree, 'writer-form-save-chapter').props.disabled, true);
console.log('PASS controlled chapter title, explicit create/save callbacks and locked form controls');

const saveEvents = [];
let releaseEditor;
const screenApi = {
  rec: { doc: structuredClone(original), publication: 'draft' }, signed: false, loading: false, frozen: false,
  view: { kind: 'local', text: 'Cihaza kaydedildi' }, flushRef: { current: () => {
    saveEvents.push('flush');
    return new Promise(resolve => { releaseEditor = resolve; });
  } },
  edit(fn) { this.rec = { ...this.rec, doc: fn(this.rec.doc) }; this.liveRef.current = this.rec; },
  async persistNow() { saveEvents.push(['persist', this.rec.doc.chapters[0].html]); return true; },
  liveRef: { current: null },
};
screenApi.liveRef.current = screenApi.rec;
const screen = await harness('WriterScreen', { owner: 'guest', id: 'test-book', offline: true }, {
  'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
    useWindowDimensions: () => ({ width: 360, height: 800 }), StyleSheet: { create: value => value, hairlineWidth: 1 } },
  'expo-router': { router: { push() {}, replace() {} } },
  '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
  '@workspace/api-client-react': Object.fromEntries(['getGetWriterLibraryQueryKey', 'getGetPublishedBooksQueryKey',
    'getGetAuthoredBookQueryKey', 'getGetAuthoredBooksQueryKey'].map(name => [name, () => []])),
  '@/components/bulletins/common': { Btn: 'Btn', apiError: (_, fallback) => fallback, goSignIn() {} },
  '@/components/KeyboardAwareScrollViewCompat': { KeyboardAwareScrollViewCompat: 'KeyboardAwareScrollViewCompat' },
  '@/context/CommunityContext': { useCommunity: () => ({ person: null }) },
  '@/components/writer/useWriterBook': { useWriterBook: () => screenApi },
  ...Object.fromEntries(['CoverCard', 'BookInfo', 'WriterChapterFields', 'ChapterList', 'EditorPanel'].map(name =>
    ['@/components/writer/' + name, { [name]: name }])),
  '@/components/writer/parts': { useWriterPalette: () => colors, writerPalette: () => colors,
    Toast: 'Toast', Banner: 'Banner', Confirm: 'Confirm', Skeleton: 'Skeleton', FadeIn: 'FadeIn' },
  '@/lib/writer-text': { publishProblems: () => [], newChapter: number => ({ id: 'new-chapter', title: 'Bölüm ' + number, html: '', status: 'draft' }) },
  '@/lib/writer-store': { isDirty: () => false },
});
tree = screen.render();
const currentChapterFields = allNodes(tree).find(node => node.type === 'WriterChapterFields');
assert.ok(currentChapterFields);
currentChapterFields.props.onTitleChange('Doğrudan değişen bölüm başlığı');
assert.equal(screenApi.rec.doc.chapters[0].title, 'Doğrudan değişen bölüm başlığı');
currentChapterFields.props.onSave();
assert.deepEqual(saveEvents, ['flush'], 'Do not persist or claim success before the editor finishes flushing');
screenApi.edit(doc => ({ ...doc, chapters: doc.chapters.map(ch => ({ ...ch, html: '<p>Son yazılan metin</p>' })) }));
releaseEditor();
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(saveEvents, ['flush', ['persist', '<p>Son yazılan metin</p>']]);
assert.ok(screen.states.some(state => state?.tone === 'ok' && state.text.includes('Taslak kaydedildi')));
saveEvents.length = 0;
screenApi.flushRef.current = async () => { saveEvents.push('flush-failed'); throw new Error('Editör yanıt vermedi'); };
allNodes(screen.render()).find(node => node.type === 'WriterChapterFields').props.onSave();
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(saveEvents, ['flush-failed'], 'A failed editor flush must not be reported as a saved chapter');
assert.ok(screen.states.some(state => state?.tone === 'err' && state.text === 'Editör yanıt vermedi'));
currentChapterFields.props.onAdd();
assert.equal(screenApi.rec.doc.chapters.length, 2);
assert.equal(screenApi.rec.doc.chapters[0].html, '<p>Son yazılan metin</p>');
assert.ok(allNodes(screen.render()).find(node => node.type === 'BookInfo'), 'Adding a chapter from the form must keep book metadata accessible');
let editorProps = allNodes(screen.render()).find(node => node.type === 'EditorPanel').props;
editorProps.setFocus(true);
tree = screen.render();
tree.props.onLayout({ nativeEvent: { layout: { height: 620 } } });
byId(tree, 'writer-status').props.onLayout({ nativeEvent: { layout: { height: 60 } } });
editorProps.onChromeHeight(100);
tree = screen.render();
assert.equal(allNodes(tree).find(node => node.type === 'EditorPanel').props.height, 442);
assert.ok(byId(tree, 'writer-focus-save'));
const focusScroll = allNodes(tree).find(node => node.type === 'KeyboardAwareScrollViewCompat');
const scrollCalls = [];
focusScroll.props.onScrollReady({ scrollTo: position => scrollCalls.push(position.y) });
focusScroll.props.onContentSizeChange();
assert.deepEqual(scrollCalls, [0], 'Expanding/reflowing the writing view must reveal the toolbar without remounting the editor');
assert.ok(!allNodes(tree).some(node => node.props?.testID === 'writer-open-shelf'), 'Compact save/status controls must fit a phone width; the permanent footer still provides the library');
assert.ok(!allNodes(tree).some(node => node.type === 'BookInfo'));
screenApi.frozen = true;
assert.equal(byId(screen.render(), 'writer-focus-save').props.disabled, true);
screenApi.frozen = false;
byId(tree, 'writer-focus-exit').props.onPress();
assert.ok(allNodes(screen.render()).some(node => node.type === 'BookInfo'), 'Leaving expanded view must restore the form, not navigate or replace the book');
allNodes(screen.render()).find(node => node.type === 'KeyboardAwareScrollViewCompat').props.onContentSizeChange();
assert.deepEqual(scrollCalls, [0], 'Normal editing must not force scrolling on every metadata layout change');
console.log('PASS owner-bound title integration, chapter creation, flush-before-save ordering and explicit flush-failure feedback');

// Optional development-only fixture for a focused browser pass. No mail is sent.
if (process.argv.includes('--prepare-fixture')) {
  if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Development fixture only');
  const { randomUUID } = await import('node:crypto');
  const { writeFile } = await import('node:fs/promises');
  const { accounts } = await import('./helpers/accounts.mjs');
  const { hashPassword } = await import('../src/lib/auth-crypto.ts');
  const { pool } = await import('@workspace/db');
  const email = `writer-form-${randomUUID()}@example.com`, password = `Synthetic-${randomUUID()}`;
  let user;
  try {
    user = await accounts.users.createUser({ emailAddress: [email], firstName: 'Form kontrolü' });
    await pool.query('UPDATE afilli_auth_accounts SET password_hash=$2 WHERE user_id=$1', [user.id, await hashPassword(password)]);
    const session = await accounts.sessions.createSession({ userId: user.id });
    const token = (await accounts.sessions.getToken(session.id)).jwt, bookId = randomUUID();
    const seed = { ...original, chapters: [{ ...original.chapters[0], id: randomUUID() }] };
    const response = await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/writer-books/${bookId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Afilli-Actor': user.id },
      body: JSON.stringify({ document: seed, expectedRevision: 0, saveId: randomUUID(), localId: bookId }),
    });
    assert.equal(response.status, 200, await response.text());
    const file = `generated-artifacts/writer-management-${randomUUID()}.json`;
    await writeFile(new URL('../../../' + file, import.meta.url), JSON.stringify({ userId: user.id, email, password, bookId }));
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
