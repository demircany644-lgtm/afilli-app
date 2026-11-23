import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { cleanHtml } from '../src/lib/writer-document.ts';

const engineSource = await readFile(new URL('../../afilli/lib/writer-editor-html.ts', import.meta.url), 'utf8');
new vm.Script(engineSource.match(/const ENGINE = String\.raw`([\s\S]*?)`;/)[1]);
const commands = [], weights = [];
const commandSource = engineSource.match(/function cmd\(n,v\)\{[\s\S]*?changed\(\);snap\(\);emitNow\(\);state\(\);\}/)[0];
const commandContext = {
  restoreSel() {}, snap() {}, changed() {}, emitNow() {}, state() {},
  ed: { getAttribute: () => 'true' },
  document: { execCommand: (...args) => commands.push(args) },
  weight: (...args) => weights.push(args),
};
vm.runInNewContext(commandSource, commandContext);
commandContext.cmd('thin');
commandContext.cmd('normal');
commandContext.cmd('paragraph');
commandContext.cmd('size', 'small');
commandContext.cmd('size', 'large');
assert.deepEqual(weights, [['300', false], ['400', true]]);
assert.deepEqual(commands, [['removeFormat', false, null], ['formatBlock', false, '<p>'],
  ['fontSize', false, '2'], ['fontSize', false, '5']]);
commandContext.ed.getAttribute = () => 'false';
commandContext.cmd('thin');
commandContext.cmd('bold');
assert.equal(commands.length, 4, 'Locked/conflicted documents must ignore toolbar commands');
assert.equal(weights.length, 2);

// A collapsed selection establishes the requested typing style without deleting
// any text; the zero-width caret marker is removed from serialized manuscripts.
const inserted = [];
let caret;
const range = {
  collapsed: true, cloneRange() { return this; }, insertNode(node) { inserted.push(node); },
  setStart(node, offset) { caret = { node, offset }; }, collapse() {},
};
const selection = { rangeCount: 1, anchorNode: {}, getRangeAt: () => range, removeAllRanges() {}, addRange() {} };
const weightContext = {
  ed: { contains: () => true }, lastRange: null, window: { getSelection: () => selection },
  document: {
    createElement: () => ({ style: {}, appendChild(child) { this.firstChild = child; } }),
    createTextNode: text => ({ textContent: text }),
  },
};
vm.runInNewContext(engineSource.match(/function weight\(value,reset\)\{[\s\S]*?\n\}/)[0], weightContext);
weightContext.weight('300', false);
assert.equal(inserted[0].style.fontWeight, '300');
assert.equal(caret.offset, 1);
assert.equal(caret.node.textContent, '\u200b');
selection.rangeCount = 0;
weightContext.weight('300', false);
assert.equal(inserted.length, 1, 'No selection must not create or replace manuscript nodes');
selection.rangeCount = 1;
weightContext.ed.contains = () => false;
weightContext.weight('300', false);
assert.equal(inserted.length, 1, 'Selections outside the chapter must not be changed');
assert.match(engineSource, /replace\(\/\\u200b\/g,''\)/);
assert.match(engineSource, /pointerdown[\s\S]*?t:'activate'/);
const exits = [];
let keyboardListener;
vm.runInNewContext(engineSource.split('\n').find(line => line.startsWith("ed.addEventListener('keydown'")), {
  ed: { addEventListener: (_, fn) => { keyboardListener = fn; } }, post: event => exits.push(event.t),
});
let escaped = false;
keyboardListener({ key: 'Escape', preventDefault: () => { escaped = true; } });
assert.equal(escaped, true);
assert.deepEqual(exits, ['deactivate'], 'Escape inside the iframe/WebView must reach the parent writing view');
console.log('PASS engine syntax, normal/thin/paragraph commands, typing-style caret and selection guards');

const manuscript = '<h1>Başlık</h1><p style="text-align:center"><span style="font-weight:300;font-size:14px">ince</span> ' +
  '<span style="font-weight:700;font-size:22px">kalın</span> ' +
  '<span style="font-weight:400;font-style:normal;font-size:16px">normal</span></p><ol><li>Bir</li><li>İki</li></ol>' +
  '<blockquote>Alıntı</blockquote><p><em>Eğik</em></p>';
const safe = cleanHtml(manuscript);
for (const value of ['font-weight:300', 'font-weight:700', 'font-weight:400', 'font-style:normal',
  'font-size:14px', 'font-size:22px', 'text-align:center', '<ol>', '<li>Bir</li>', '<h1>', '<blockquote>']) assert.ok(safe.includes(value), value);
assert.equal(cleanHtml(safe), safe, 'Saved formatting must survive repeated sanitization');
const unsafe = cleanHtml('<script>alert(1)</script><span onclick="bad()" style="font-weight:300;position:fixed;font-size:999px;background-image:url(javascript:bad)">Güvenli</span>');
assert.match(unsafe, /font-weight:300/);
assert.doesNotMatch(unsafe, /script|onclick|position|999|javascript|background-image/);
console.log('PASS existing server sanitizer retains supported styles, paragraphs and lists without allowing active markup');

const F = { body: 'Inter_400Regular', med: 'Inter_500Medium', semi: 'Inter_600SemiBold', serifBold: 'PlayfairDisplay_700Bold' };
const palette = new Proxy({}, { get: () => '#3e2a1a' });
const states = []; let cursor = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState: initial => { const i = cursor++; if (i >= states.length) states.push(initial); return [states[i], value => { states[i] = value; }]; },
  useEffect() {},
};
let platform = 'android';
const native = { Text: 'Text', View: 'View', Platform: { get OS() { return platform; } }, StyleSheet: { create: value => value } };
const dependencies = {
  react, 'react-native': native, '@expo/vector-icons': {},
  '@/hooks/useTheme': { makeStyles: fn => () => fn({}) },
  '@workspace/api-client-react': {}, '@/components/ui': { F },
  '@/components/profile/hooks': {}, '@/context/CommunityContext': {},
  '@/lib/writer-text': { decodeEntities: value => value },
  '@workspace/reader-core': await import('../../reader-core/src/index.ts'),
  './CopyGuard': { CopyGuard: 'CopyGuard', CopyProtectionHint: 'CopyProtectionHint' },
  '@/components/writer/parts': { useWriterPalette: () => palette, writerPalette: () => palette, Confirm: 'Confirm' },
  '@/components/bulletins/common': {},
};
async function loadComponent(name, extras = {}) {
  const source = await readFile(new URL('../../afilli/components/writer/' + name + '.tsx', import.meta.url), 'utf8');
  const code = (await transform(source + (name === 'HtmlView' ? '\nexport const styleForTest=styleOf;' : ''), { loader: 'tsx', format: 'cjs' })).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(key) {
    assert.ok(key in { ...dependencies, ...extras }, 'Unexpected dependency ' + key);
    return ({ ...dependencies, ...extras })[key];
  } });
  return module.exports;
}
const reader = await loadComponent('HtmlView');
for (const os of ['android', 'ios', 'web']) {
  platform = os;
  const thin = reader.styleForTest({ style: 'font-weight:300;font-size:14px' });
  assert.equal(thin.fontWeight, '300');
  assert.equal(thin.fontFamily, os === 'android' ? 'sans-serif-light' : os === 'ios' ? 'System' : 'system-ui');
  assert.equal(thin.fontSize, 14);
}
assert.equal(reader.styleForTest({ style: 'font-weight:400;font-style:normal' }).fontFamily, F.body);
assert.equal(reader.styleForTest({ style: 'font-weight:700' }).fontFamily, F.semi);
assert.equal(reader.styleForTest({ style: 'font-style:normal' }).fontStyle, 'normal');
assert.equal(reader.styleForTest({ style: 'font-size:999px;font-family:evil;position:fixed' }).fontSize, undefined);
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'string' ? node : node && typeof node === 'object' ? text(node.props?.children) : '';
}
cursor = 0;
const rendered = reader.HtmlView({ html: safe, owner: null, fontSize: 34 });
const thinText = nodes(rendered).find(node => node.type === 'Text' && text(node) === 'ince');
assert.ok(thinText);
const thinStyle = Object.assign({}, ...[thinText.props.style].flat(Infinity).filter(Boolean));
assert.equal(thinStyle.fontWeight, '300');
assert.equal(thinStyle.fontSize, 28, 'Reader enlargement must scale author-selected small text');
const boldText = nodes(rendered).find(node => node.type === 'Text' && text(node) === 'kalın');
assert.equal(Object.assign({}, ...[boldText.props.style].flat(Infinity).filter(Boolean)).fontSize, 44);
assert.ok(nodes(rendered).some(node => text(node) === '1.'));
assert.ok(nodes(rendered).some(node => text(node) === '2.'));
cursor = 0;
const aligned = reader.HtmlView({
  html: '<div style="font-size:22px"><ol><li style="text-align:center"><p>Ortadaki satır</p></li><li style="text-align:right">Sağdaki satır</li></ol></div>',
  owner: null,
});
for (const [label, alignment] of [['Ortadaki satır', 'center'], ['Sağdaki satır', 'right']]) {
  const line = nodes(aligned).find(node => node.type === 'Text' && node.props.selectable === false && text(node) === label);
  const lineStyle = Object.assign({}, ...[line.props.style].flat(Infinity).filter(Boolean));
  assert.equal(lineStyle.textAlign, alignment, 'List item alignment must apply to direct and nested paragraphs');
  assert.equal(lineStyle.fontSize, 22, 'Nested paragraphs must inherit the author-selected size');
}
console.log('PASS native/web reader font weights, normal style reset, enlarged author sizes and ordered-list markers');

const issued = [];
const toolbar = await loadComponent('Toolbar', {
  '@/components/ui': { F, tap() {} },
  '@expo/vector-icons': { Feather: 'Feather', MaterialCommunityIcons: 'MaterialCommunityIcons' },
});
states.length = 0;
const toolbarProps = { sel: { weight: 'thin', bold: false, block: 'h1' }, cmd: (...args) => issued.push(args), x: {} };
const draw = () => { cursor = 0; return toolbar.Toolbar(toolbarProps); };
let tools = draw();
for (const [label, command] of [['Normal yazı', 'normal'], ['İnce yazı', 'thin'], ['Numaralı liste', 'insertOrderedList']]) {
  nodes(tools).find(node => node.props.label === label).props.onPress();
  assert.equal(issued.at(-1)[0], command);
}
nodes(tools).find(node => node.props.label === 'Stiller').props.onPress();
tools = draw();
nodes(tools).find(node => node.props.id === 'style-p').props.onPress();
assert.equal(issued.at(-1)[0], 'paragraph', 'Paragraph must actually leave heading/quote blocks, not just change weight');
nodes(tools).find(node => node.props.label === 'Yazı boyutu').props.onPress();
tools = draw();
nodes(tools).find(node => node.props.id === 'size-large').props.onPress();
assert.deepEqual(issued.at(-1), ['size', 'large']);
console.log('PASS toolbar normal, thin, numbered list, paragraph and large-size controls reach their real engine commands');
