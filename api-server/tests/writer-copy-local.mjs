import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { copyWriterDocument } from '../../lib/writer-copy.ts';

const source = {
  title: 'Bağımsız kitap kopyası',
  description: 'Aynı içerik, ayrı taslak.',
  genres: ['Roman'],
  ageRating: 'all',
  language: 'Türkçe',
  completion: 'ongoing',
  cover: 'preset:forest',
  chapters: [
    { id: 'old-1', title: 'Birinci', html: '<p>Metin</p>', status: 'published' },
    { id: 'old-2', title: 'İkinci', html: '<p>Başka metin</p>', status: 'draft' },
  ],
};
const original = structuredClone(source);
const ids = ['new-1', 'new-2'];
const copied = copyWriterDocument(source, () => ids.shift());
assert.deepEqual(copied.chapters.map(ch => ch.id), ['new-1', 'new-2']);
assert.ok(copied.chapters.every(ch => ch.status === 'draft'));
assert.deepEqual(copied.chapters.map(ch => [ch.title, ch.html]), original.chapters.map(ch => [ch.title, ch.html]));
assert.deepEqual({ ...copied, chapters: undefined }, { ...original, chapters: undefined });
assert.deepEqual(source, original, 'copying never mutates the source document');

const html = await readFile(new URL('../../components/writer/HtmlView.tsx', import.meta.url), 'utf8');
const reader = await readFile(new URL('../../app/authored-book/[id].tsx', import.meta.url), 'utf8');
const discussion = await readFile(new URL('../../components/writer/ReaderDiscussion.tsx', import.meta.url), 'utf8');
const shelf = await readFile(new URL('../../components/writer/WriterShelf.tsx', import.meta.url), 'utf8');
assert.match(html, /onLongPress=\{onParagraphLongPress/);
assert.match(reader, /paragraph-long-press-comment/);
assert.match(discussion, /scope: 'paragraph', chapterId, paragraphId: p\.id/);
assert.match(discussion, /meta\.readCount/);
assert.match(shelf, /copyWriterBook\(/);
console.log('PASS mobile manuscript copies, long-press paragraph targets, and chapter read display contracts');
