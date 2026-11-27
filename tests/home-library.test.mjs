import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { removeLibraryEntry } from '../lib/library.ts';
import { FEATURED_BOOK_INTERVAL_MS, featuredBookIndex } from '../lib/library.ts';
import { parseSampleChat, sampleChatKey } from '../lib/sample-chat.ts';

test('removing one reader entry preserves other books and all authored content', () => {
  const old = { saved: ['one', 'two'], library: { one: 1, two: 2 }, drafts: [{ id: 'my-writing', body: 'Kendi metnim' }], profile: { nickname: 'Okur' } };
  const next = removeLibraryEntry(old, 'one');
  assert.deepEqual(next.saved, ['two']);
  assert.deepEqual(next.library, { two: 2 });
  assert.equal(next.drafts, old.drafts);
  assert.equal(next.profile, old.profile);
  assert.deepEqual(old.library, { one: 1, two: 2 });
  assert.deepEqual(old.saved, ['one', 'two']);
});

test('removing an unknown reader entry cannot delete authored drafts', () => {
  const old = { saved: ['one'], library: {}, drafts: [{ id: 'same-id' }] };
  assert.deepEqual(removeLibraryEntry(old, 'same-id'), old);
});

test('the featured new-book slot advances by seven-day windows and resets for new releases', () => {
  const published = Date.parse('2026-11-20T12:00:00.000Z');
  assert.equal(FEATURED_BOOK_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(featuredBookIndex(published, published), 0);
  assert.equal(featuredBookIndex(published, published + FEATURED_BOOK_INTERVAL_MS - 1), 0);
  assert.equal(featuredBookIndex(published, published + FEATURED_BOOK_INTERVAL_MS), 1);
  assert.equal(featuredBookIndex(published, published + FEATURED_BOOK_INTERVAL_MS * 3), 3);
  assert.equal(featuredBookIndex(published, published - 1), 0);
  assert.equal(featuredBookIndex('not-a-date', published), 0);
  assert.equal(featuredBookIndex(published + FEATURED_BOOK_INTERVAL_MS, published + FEATURED_BOOK_INTERVAL_MS), 0);
});

test('demo conversations are isolated by both account and thread', () => {
  assert.notEqual(sampleChatKey('reader-a', 'one'), sampleChatKey('reader-b', 'one'));
  assert.notEqual(sampleChatKey('reader-a', 'one'), sampleChatKey('reader-a', 'two'));
  assert.notEqual(sampleChatKey('reader:a', 'b'), sampleChatKey('reader', 'a:b'));
});

test('a valid saved demo message round trips without alteration', () => {
  const lines = [{ id: 'one', body: 'Türkçe örnek mesaj', createdAt: '2026-11-17T12:00:00.000Z' }];
  assert.deepEqual(parseSampleChat(JSON.stringify(lines)), lines);
  assert.deepEqual(parseSampleChat(null), []);
});

test('damaged demo records fail explicitly instead of becoming empty chats', () => {
  for (const raw of ['bad json', '{}', '[null]', '[{"id":"one","body":"","createdAt":"yesterday"}]', JSON.stringify(Array(201).fill({ id: 'one', body: 'text', createdAt: '2026-11-17T00:00:00Z' }))]) {
    assert.throws(() => parseSampleChat(raw));
  }
});

test('home cards, discovery and saving retain their working route contracts', async () => {
  const base = new URL('../', import.meta.url);
  const home = await readFile(new URL('app/(tabs)/index.tsx', base), 'utf8');
  const search = await readFile(new URL('app/search.tsx', base), 'utf8');
  const discoveryParts = await readFile(new URL('components/discovery/parts.tsx', base), 'utf8');
  const library = await readFile(new URL('app/(tabs)/library.tsx', base), 'utf8');
  assert.match(home, /pathname: '\/search', params: \{ section: sec\.routeSection \?\? sec\.id, sort: sec\.sort \}/);
  assert.match(home, /openBook\(b\.id\)/);
  assert.match(discoveryParts, /pathname: '\/authored-book\/\[id\]'/);
  assert.match(discoveryParts, /card\.genres\.join\(' · '\)/);
  assert.match(search, /useGetDiscoveryBooks/);
  assert.match(library, /title="Kaydettiklerim" ids=\{saved\} mode="saved"/);
  assert.match(library, /title="Okuduklarım" ids=\{readIds\} mode="read"/);
  assert.match(library, /title="En Çok Okunan Kitap" sort="read"/);
  assert.match(library, /<RotatingLatestBookShelf/);
  assert.match(library, /useGetReaderReadBooks/);
  const shelf = await readFile(new URL('components/discovery/SavedBooks.tsx', base), 'utf8');
  assert.match(shelf, /<ScrollView horizontal/);
  assert.match(shelf, /library-remove-confirm-/);
  assert.match(shelf, /openBook\(id\)/);
});
