// Run: node --experimental-strip-types --test lib/reader-core/test/paragraphs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getReaderParagraphs, parseHtml, MAX_DEPTH } from '../src/index.ts';

test('direct blocks use b.i paths and skip blank/img/hr', () => {
  const html = '<p>Bir</p><p> </p><hr><img src="x"><p>İki &amp; üç</p>';
  assert.deepEqual(getReaderParagraphs(html), [{ path: 'b.0', text: 'Bir' }, { path: 'b.4', text: 'İki & üç' }]);
});

test('inline runs use r + out.length', () => {
  const html = 'önce<p>orta</p>sonra';
  assert.deepEqual(getReaderParagraphs(html).map((p) => p.path), ['br0', 'b.1', 'br2']);
});

test('lists use l + j and nested containers keep parent key', () => {
  const html = '<ul><li>a</li><li><p>b</p></li></ul><blockquote><p>c</p></blockquote>';
  assert.deepEqual(getReaderParagraphs(html).map((p) => p.path), ['b.0l0', 'b.0l1.0', 'b.1.0']);
});

test('entities decoded exactly once', () => {
  const root = parseHtml('<p>&amp;lt;</p>');
  assert.equal((root.kids[0] as { kids: string[] }).kids[0], '&lt;');
});

test('excessive nesting is capped without losing text', () => {
  const n = 50000;
  const html = '<div>'.repeat(n) + 'derin metin' + '</div>'.repeat(n) + '<p>sonra</p>';
  let depth = 0; let el = parseHtml(html) as { kids: unknown[] };
  while (el.kids.length && typeof el.kids[0] === 'object') { el = el.kids[0] as { kids: unknown[] }; depth++; }
  assert.ok(depth <= MAX_DEPTH + 1);
  const paras = getReaderParagraphs(html);
  assert.ok(paras.some((p) => p.text === 'derin metin'));
  assert.ok(paras.some((p) => p.text === 'sonra'));
});
