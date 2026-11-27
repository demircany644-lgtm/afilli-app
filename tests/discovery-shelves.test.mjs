import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { HOME_BOOK_CATEGORIES, RECOMMENDATION_CATEGORIES, RECOMMENDATION_RANKS, SHELVES, SORTS, resolveDiscoveryShelf } from '../lib/discovery-shelves.ts';
import { homeCategoryCarouselLayout } from '../lib/home-cover-layout.ts';

test('discovery retains its established shelf identifiers and ranking rules', () => {
  assert.deepEqual(SHELVES.map(s => s.title), [
    'Afilli Önerileri', 'Çok Okunanlar', 'Popüler Kitaplar', 'Yeni Yazılan Kitaplar',
  ]);
  assert.equal(new Set(SHELVES.map(s => s.id)).size, 4);
  assert.deepEqual(SHELVES.map(s => s.sort), ['new', 'read', 'popular', 'new']);
});

test('recommendation categories and metric-ranked rows stay in the requested order', () => {
  assert.deepEqual(RECOMMENDATION_CATEGORIES.map(c => c.title), [
    'Romantik', 'Gerilim – Polisiye – Gizem', 'Fantastik', 'Mafya – Yeraltı Dünyası',
    'Bilim Kurgu – Distopya', 'Dram – Hayat Hikâyeleri',
  ]);
  assert.deepEqual(RECOMMENDATION_RANKS.map(s => [s.title, s.sort]), [
    ['En Çok Okunan Kitaplar', 'read'],
    ['En Çok Beğenilen Kitaplar', 'popular'],
  ]);
  assert.deepEqual(RECOMMENDATION_RANKS.map(s => s.routeSection), ['cok-okunan', 'populer']);
});

test('home categories follow the requested order and only fantasy/science fiction uses read ranking', () => {
  assert.deepEqual(HOME_BOOK_CATEGORIES.map((c) => [c.title, c.sort]), [
    ['Aşk Romanı', 'new'],
    ['En Çok Okunanlar – Fantastik / Bilim Kurgu', 'read'],
    ['Polisiye / Gerilim', 'new'],
    ['Mafya', 'new'],
    ['Psikolojik İlişkiler', 'new'],
    ['Dram / Hayat Hikâyeleri', 'new'],
  ]);
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
  assert.match(source, /key=\{initialTab \+ ':' \+ shelf\.id \+ ':' \+ \(initialCategory \?\? 'all'\)\}/);
  assert.match(source, /useState<DiscoveryShelf>\(initialShelf\)/);
  assert.match(source, /const sort = shelf\.sort/);
  assert.match(source, /const shelfTitle = shelf\.title/);
  assert.match(source, /setShelf\(resolveDiscoveryShelf\(undefined, s\)\)/);
  assert.match(source, /<BookPages key=\{sort \+ '\|' \+ search \+ '\|' \+ \(category \?\? 'all'\)\}/);
});

test('home retains recommendations and renders one independent, cover-only carousel per category', () => {
  const source = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /<Shelf sec=\{SHELVES\[0\]\}/);
  assert.doesNotMatch(source, /SHELVES\.map/);
  assert.match(source, /HOME_BOOK_CATEGORIES\.map\(\(category\) => \(/);
  assert.match(source, /<CategoryBookSection\s+key=\{category\.id\}\s+category=\{category\}/);
  assert.match(source, /q\.data && items\.length === 0\) return null/);
  assert.match(source, /home-category-all-/);
  assert.match(source, /<ScrollView\s+horizontal\s+nestedScrollEnabled/);
  assert.match(source, /testID=\{'home-category-shelf-' \+ category\.id\}/);
  assert.match(source, /items\.map\(\(book\) => \(/);
  assert.match(source, /testID=\{'home-category-book-' \+ category\.id \+ '-' \+ book\.id\}/);
  assert.doesNotMatch(source, /home-category-read-/);
  assert.doesNotMatch(source, /home-category-title-/);
  assert.match(source, /homeCategoryCarouselLayout\(width, pad\)/);
  assert.match(source, /contentContainerStyle=\{\{ paddingHorizontal: pad, gap, paddingTop: 2, paddingBottom: 14 \}\}/);
  assert.match(source, /RECOMMENDATION_RANKS\.map/);
  assert.ok(source.indexOf('HOME_BOOK_CATEGORIES.map') < source.indexOf('<RecommendationDetails'),
    'the requested categories follow Afilli Önerileri before the separate ranking shelves');
  assert.match(source, /params: \{ section: sec\.routeSection \?\? sec\.id, sort: sec\.sort \}/);
  assert.match(source, /refetchInterval: 60_000/);
  for (const id of ['home-section-', 'home-retry-', 'home-shelf-']) {
    assert.ok(source.includes(`'${id}' + sec.id`));
  }
  assert.match(source, /home-all-/);
  assert.match(source, /const cover = homeCoverLayout\(h\)/);
  assert.match(source, /showsVerticalScrollIndicator=\{false\}/);
});

test('category covers show two complete books and about half of a third on phone widths', () => {
  for (const [width, padding] of [[402, 18], [360, 18], [320, 14]]) {
    const { coverWidth, coverHeight, gap } = homeCategoryCarouselLayout(width, padding);
    const visible = width - padding * 2;
    const thirdBookPeek = visible - (coverWidth * 2 + gap * 2);
    assert.ok(coverWidth > 0);
    assert.ok(coverHeight >= coverWidth * 1.49 && coverHeight <= coverWidth * 1.51);
    assert.ok(thirdBookPeek >= coverWidth * 0.45 && thirdBookPeek <= coverWidth * 0.7,
      `${width}px screen should show a partial third cover`);
  }
});

test('home category see-all links retain their custom category filters in search', () => {
  const source = readFileSync(new URL('../app/search.tsx', import.meta.url), 'utf8');
  assert.match(source, /\[\.\.\.RECOMMENDATION_CATEGORIES, \.\.\.HOME_BOOK_CATEGORIES\]\.find\(\(category\) => category\.id === p\.category\)/);
  assert.match(source, /discoveryCategoryTitle\(category\)/);
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(home, /params: \{ category: category\.id, sort: category\.sort \}/);
});

test('central discovery exposes every category and filters before opening book pages', () => {
  const source = readFileSync(new URL('../app/search.tsx', import.meta.url), 'utf8');
  assert.match(source, /RECOMMENDATION_CATEGORIES\.map\(\(item\) =>/);
  assert.match(source, /testID=\{'discovery-category-' \+ item\.id\}/);
  assert.match(source, /setCategory\(item\.id\)/);
  assert.match(source, /category \? \{ category \} : \{\}/);
  assert.match(source, /<BookPages key=\{sort \+ '\|' \+ search \+ '\|' \+ \(category \?\? 'all'\)\}/);
  assert.match(source, /category \? 'Bu kategoride kitap yok'/);
});

test('non-home top bars do not expose home-only discovery or message actions', () => {
  const source = readFileSync(new URL('../components/bulletins/TopBar.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /icon\('search'/);
  assert.doesNotMatch(source, /icon\('message-circle'/);
  assert.match(source, /icon\('user', '\/profile', 'Profil'\)/);
});
