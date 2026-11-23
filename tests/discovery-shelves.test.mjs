import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SHELVES, SORTS, resolveDiscoveryShelf } from '../lib/discovery-shelves.ts';

test('home contains exactly four sections in the requested order', () => {
  assert.deepEqual(SHELVES.map(s => s.title), [
    'Afilli Önerileri', 'Çok Okunanlar', 'Popüler Kitaplar', 'Yeni Yazılan Kitaplar',
  ]);
  assert.equal(new Set(SHELVES.map(s => s.id)).size, 4);
  assert.deepEqual(SHELVES.map(s => s.sort), ['new', 'read', 'popular', 'new']);
});

test('every Tümü link resolves to its own heading and existing server sort', () => {
  for (const shelf of SHELVES) {
    assert.equal(resolveDiscoveryShelf(shelf.id, shelf.sort), shelf);
    assert.ok(SORTS.includes(shelf.sort));
    assert.equal(resolveDiscoveryShelf(shelf.id, 'invalid'), shelf);
  }
});

test('recommendations and newest retain separate identity despite sharing a feed', () => {
  const recommendations = resolveDiscoveryShelf('oneriler');
  const newest = resolveDiscoveryShelf('yeni-yazilan');
  assert.equal(recommendations.sort, newest.sort);
  assert.notEqual(recommendations.id, newest.id);
  assert.notEqual(recommendations.title, newest.title);
  assert.equal(resolveDiscoveryShelf(undefined, 'new'), newest);
});

test('legacy read and popular links retain their rankings', () => {
  assert.equal(resolveDiscoveryShelf('cok-okunan', 'new').sort, 'read');
  assert.equal(resolveDiscoveryShelf('populer', 'new').sort, 'popular');
  assert.equal(resolveDiscoveryShelf(undefined, 'read').id, 'cok-okunan');
  assert.equal(resolveDiscoveryShelf(undefined, 'popular').id, 'populer');
});

test('unknown and malformed route inputs safely default to released newest books', () => {
  for (const section of [undefined, null, '', 'unknown', ['oneriler'], {}, 5]) {
    assert.equal(resolveDiscoveryShelf(section).id, 'yeni-yazilan');
    assert.equal(resolveDiscoveryShelf(section, 'read').id, 'cok-okunan');
  }
  for (const sort of [undefined, null, '', 'invalid', ['new'], {}, 5]) {
    assert.equal(resolveDiscoveryShelf('unknown', sort).sort, 'new');
  }
});

test('each sort change uses its canonical heading instead of an old section title', () => {
  for (const initial of SHELVES) {
    for (const sort of SORTS) {
      const next = resolveDiscoveryShelf(undefined, sort);
      assert.equal(next.sort, sort);
      assert.equal(next.title, sort === 'new' ? 'Yeni Yazılan Kitaplar'
        : sort === 'read' ? 'Çok Okunanlar' : 'Popüler Kitaplar');
      assert.equal(resolveDiscoveryShelf(initial.id).title, initial.title);
    }
  }
});

test('search remounts by section identity, so newest cannot keep recommendation state', () => {
  const source = readFileSync(new URL('../app/search.tsx', import.meta.url), 'utf8');
  assert.match(source, /key=\{initialTab \+ ':' \+ shelf\.id\}/);
  assert.match(source, /useState<DiscoveryShelf>\(initialShelf\)/);
  assert.match(source, /const sort = shelf\.sort/);
  assert.match(source, /const shelfTitle = shelf\.title/);
  assert.match(source, /setShelf\(resolveDiscoveryShelf\(undefined, s\)\)/);
  assert.match(source, /<BookPages key=\{sort \+ '\|' \+ search\}/);
});

test('all four home sections reuse the existing cover, retry, empty and scroll UI', () => {
  const source = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /SHELVES\.map\(\(sec\) => <Shelf key=\{sec\.id\}/);
  assert.match(source, /params: \{ section: sec\.id, sort: sec\.sort \}/);
  for (const id of ['home-section-', 'home-all-', 'home-retry-', 'home-empty-', 'home-shelf-']) {
    assert.ok(source.includes(`'${id}' + sec.id`));
  }
  assert.match(source, /const cover = homeCoverLayout\(h\)/);
  assert.match(source, /showsVerticalScrollIndicator=\{false\}/);
});
