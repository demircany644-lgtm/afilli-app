import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import vm from 'node:vm';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness() {
  const slots = []; let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => react.useState({ current: initial })[0], useEffect() {},
    createContext: value => ({ Provider: 'Provider', value }), useContext: ctx => ctx.value,
  };
  return { react, render(fn) { cursor = 0; return fn(); } };
}
async function load(file, dependencies, suffix = '') {
  const source = await readFile(new URL('../../afilli/components/writer/' + file + '.tsx', import.meta.url), 'utf8');
  const code = (await transform(source + suffix, { loader: 'tsx', format: 'cjs' })).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date,
    require(name) { assert.ok(name in dependencies, 'Unexpected import ' + name); return dependencies[name]; },
  });
  return module.exports;
}
function nodes(n) {
  if (Array.isArray(n)) return n.flatMap(nodes);
  return n && typeof n === 'object' ? [n, ...nodes(n.props?.children)] : [];
}
const id = (tree, value) => nodes(tree).find(n => n.props?.testID === value);
let actor = 'reader', requests = [], changed = [];
const h = harness(), styles = new Proxy({}, { get: (_, key) => key });
const common = { Btn: 'Btn', apiError: e => e.message, Avatar: 'Avatar', goSignIn() {} };
const base = {
  react: h.react, 'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', StyleSheet: { create: x => x },
    KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Platform: { OS: 'ios' }, ScrollView: 'ScrollView' },
  'react-native-keyboard-controller': { KeyboardAvoidingView: 'KeyboardAvoidingView' },
  '@/hooks/useTheme': { makeStyles: fn => () => fn({}) }, '@/components/ui': { F: {}, tap() {} },
  '@/context/CommunityContext': { useCommunity: () => ({ userId: actor, ready: true }) },
  '@/components/profile/hooks': { actorRequest: who => ({ headers: { 'X-Afilli-Actor': who } }),
    useOwnerGuard: who => () => who === actor, scoped: (key, who) => [...key, { as: who }] },
  '@/components/bulletins/common': common,
};
const { CommentOwnerActions } = await load('CommentOwnerActions', {
  ...base, './parts': { useWriterPalette: () => styles, writerPalette: () => styles },
  '@workspace/api-client-react': Object.fromEntries(['editWriterComment', 'deleteWriterComment'].map(name => [name, (...args) => {
    const result = deferred(); requests.push({ name, args, ...result }); return result.promise;
  }])),
});
const original = { id: 'one', bookId: 'book', body: 'Özgün yorum', author: { id: 'reader', nickname: 'Okur', avatar: null },
  deleted: false, parentId: null, chapterId: null, createdAt: '2026-01-01T00:00:00Z', replyCount: 1, reactions: [] };
let comment = original;
const render = () => h.render(() => CommentOwnerActions({ comment, blocked: false, onChanged(next) { comment = next; changed.push(next); } }));
id(render(), 'comment-edit-one').props.onPress();
id(render(), 'comment-edit-input-one').props.onChangeText('Yeni metin');
id(render(), 'comment-edit-save-one').props.onPress();
assert.equal(requests[0].args[0], 'one');
assert.equal(requests[0].args[1].body, 'Yeni metin');
requests[0].reject(new Error('Bağlantı kesildi')); await tick();
assert.equal(id(render(), 'comment-edit-input-one').props.value, 'Yeni metin', 'A failed save must retain the edit');
assert.equal(changed.length, 0);
id(render(), 'comment-edit-save-one').props.onPress();
id(render(), 'comment-edit-input-one').props.onChangeText('Gönderilirken yazılan yeni taslak');
requests[1].resolve({ ...original, body: 'Yeni metin' }); await tick();
assert.equal(id(render(), 'comment-edit-input-one').props.value, 'Gönderilirken yazılan yeni taslak');
assert.equal(comment.body, 'Yeni metin');
id(render(), 'comment-edit-save-one').props.onPress();
requests[2].resolve({ ...original, body: 'Gönderilirken yazılan yeni taslak' }); await tick();
assert.ok(id(render(), 'comment-edit-one'));
id(render(), 'comment-delete-one').props.onPress();
assert.ok(id(render(), 'comment-delete-confirm-one'));
assert.equal(requests.length, 3, 'Opening the confirmation must not delete anything');
id(render(), 'comment-delete-yes-one').props.onPress();
requests[3].reject(new Error('Silme kaydedilemedi')); await tick();
assert.ok(id(render(), 'comment-delete-confirm-one'));
assert.equal(comment.deleted, false);
id(render(), 'comment-delete-yes-one').props.onPress();
requests[4].resolve({ ...original, deleted: true, body: '', author: { id: 'deleted', nickname: '', avatar: null } }); await tick();
assert.equal(render(), null, 'Deleted comment must not keep owner controls or an empty editor');
comment = { ...original, author: { ...original.author, id: 'another' } };
assert.equal(render(), null);
comment = original;
id(render(), 'comment-edit-one').props.onPress();
const staleSave = id(render(), 'comment-edit-save-one').props.onPress;
actor = 'another'; staleSave();
assert.equal(requests.length, 5, 'An old account handler must never submit as the new account');
actor = 'reader';
console.log('PASS actual edit/delete controls: author-only, failure retention, new text during save, confirmation and account-switch guard');

const discussionHarness = harness(), cache = [];
const qc = {
  setQueriesData(filter, update) { for (const row of cache) if (filter.predicate({ queryKey: row.key })) row.data = update(row.data); },
  invalidateQueries: async () => {},
};
const discussion = await load('BookComments', {
  ...base, react: discussionHarness.react,
  '@expo/vector-icons': { Feather: 'Feather' }, '@tanstack/react-query': { useQueryClient: () => qc },
  'expo-crypto': { randomUUID: () => 'test' },
  '@workspace/api-client-react': { getGetBookCommentThreadsQueryKey: book => ['/api/authored-books/' + book + '/comment-threads'] },
  '@/components/writer/parts': { useWriterPalette: () => styles, writerPalette: () => styles },
  './CommentOwnerActions': { CommentOwnerActions: 'CommentOwnerActions' },
}, '\nexport {CommentNode, replaceDiscussionComment};');
const rootKey = '/api/authored-books/book/comment-threads';
cache.push(
  { key: [rootKey, 'pages', { as: 'reader' }], data: { pages: [{ items: [original], nextCursor: 'cursor' }], pageParams: [null] } },
  { key: ['/api/writer-comments/one/path', { as: 'reader' }], data: [original] },
  { key: [rootKey, 'pages', { as: 'another' }], data: { pages: [{ items: [original], nextCursor: null }] } },
);
const deleted = { ...original, deleted: true, body: '', author: { id: 'deleted', nickname: '', avatar: null } };
discussion.replaceDiscussionComment(qc, 'book', 'reader', deleted);
assert.equal(cache[0].data.pages[0].items[0].deleted, true);
assert.equal(cache[0].data.pages[0].nextCursor, 'cursor');
assert.equal(cache[1].data[0].deleted, true);
assert.equal(cache[2].data.pages[0].items[0].deleted, false, 'Another account cache must not be changed');
const promoted = discussionHarness.render(() => discussion.CommentNode({ c: deleted, depth: 0, bookId: 'book', onCount() {} }));
assert.equal(promoted.type.name, 'Replies', 'Deleted parents must expose replies directly without a comment card');
const leafHarness = harness();
const leaf = await load('BookComments', {
  ...base, react: leafHarness.react,
  '@expo/vector-icons': { Feather: 'Feather' }, '@tanstack/react-query': { useQueryClient: () => qc },
  'expo-crypto': { randomUUID: () => 'test' }, '@workspace/api-client-react': {},
  '@/components/writer/parts': { useWriterPalette: () => styles, writerPalette: () => styles },
  './CommentOwnerActions': { CommentOwnerActions: 'CommentOwnerActions' },
}, '\nexport {CommentNode};');
assert.equal(leafHarness.render(() => leaf.CommentNode({ c: { ...deleted, replyCount: 0 }, depth: 0, bookId: 'book', onCount() {} })), null);
console.log('PASS owner-scoped cache refresh, preserved pagination, invisible deleted leaf and promoted parent replies');

const focusHarness = harness();
const root = { ...original, id: 'focus-root', bookId: 'book', chapterId: 'chapter-a', paragraphId: 'paragraph-a' };
const child = { ...root, id: 'focus-child', parentId: root.id };
let roots = [root], path = [root, child];
const scopedDiscussion = await load('BookComments', {
  ...base, react: focusHarness.react,
  '@expo/vector-icons': { Feather: 'Feather' },
  '@tanstack/react-query': { useQueryClient: () => qc, useInfiniteQuery: () => ({ data: { pages: [{ items: roots }] } }) },
  'expo-crypto': { randomUUID: () => 'test' },
  '@workspace/api-client-react': {
    useGetWriterCommentPath: () => ({ data: path }),
    getGetBookCommentThreadsQueryKey: id => ['/api/authored-books/' + id + '/comment-threads'],
    getGetWriterCommentPathQueryKey: id => ['/api/writer-comments/' + id + '/path'],
  },
  '@/components/writer/parts': { useWriterPalette: () => styles, writerPalette: () => styles },
  './CommentOwnerActions': { CommentOwnerActions: 'CommentOwnerActions' },
}, '\nexport {CommentNode,FocusedThread};');
const context = { scope: 'paragraph', chapterId: 'chapter-a', paragraphId: 'paragraph-a' };
assert.equal(scopedDiscussion.commentInContext(root, 'book', context), true);
for (const wrong of [{ scope: 'book' }, { scope: 'chapter', chapterId: 'chapter-a' },
  { ...context, chapterId: 'chapter-b' }, { ...context, paragraphId: 'paragraph-b' }])
  assert.equal(scopedDiscussion.commentInContext(root, 'book', wrong), false);
assert.equal(scopedDiscussion.commentInContext(root, 'another-book', context), false);
function elements(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(elements)];
}
const props = { bookId: 'book', context, onCount() {}, placeholder: '', testID: 'focused-context', empty: '', focusId: child.id };
let tree = focusHarness.render(() => scopedDiscussion.CommentThreads(props));
assert.equal(elements(tree).filter(n => n.type === scopedDiscussion.FocusedThread).length, 1);
assert.equal(elements(tree).filter(n => n.type === scopedDiscussion.CommentNode && n.props.c.id === root.id).length, 0,
  'A pinned root must not also render in the ordinary list');
tree = focusHarness.render(() => scopedDiscussion.FocusedThread(props));
const chain = elements(tree).filter(n => n.type === scopedDiscussion.CommentNode);
assert.equal(chain.find(n => n.props.c.id === root.id).props.expandable, false);
assert.equal(chain.find(n => n.props.c.id === child.id).props.expandable, true);
roots = [];
assert.equal(focusHarness.render(() => scopedDiscussion.FocusedThread({ ...props, context: { ...context, chapterId: 'chapter-b' } })), null);
tree = focusHarness.render(() => scopedDiscussion.CommentThreads({ ...props, context: { ...context, chapterId: 'chapter-b' } }));
assert.equal(elements(tree).filter(n => n.type === scopedDiscussion.FocusedThread).length, 0);
console.log('PASS notification threads stay in their book/chapter/paragraph, render once and do not duplicate ancestor replies.');
