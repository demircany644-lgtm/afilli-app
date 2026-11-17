import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { removeLibraryEntry } from '../lib/library.ts';
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
  const library = await readFile(new URL('app/(tabs)/library.tsx', base), 'utf8');
  assert.match(home, /pathname: '\/search', params: \{ section: sec.id \}/);
  assert.match(home, /pathname: '\/book\/\[id\]'/);
  assert.match(search, /b\.alias, b\.genre/);
  assert.match(search, /useGetPublishedBooks/);
  assert.match(library, /\.\.\.saved, \.\.\.Object\.keys\(library\)/);
  assert.match(library, /library-remove-confirm/);
});
