import { createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { getReaderParagraphs } from '@workspace/reader-core';
import type { ReaderChapter, ReaderParagraph } from '@workspace/api-zod';
import { fail, type Transaction } from './community';
import { writerRow } from './writer-service';
import { legacyDocument } from './writer-document';
import { commentTree } from './book-comment-query';

type Db = Transaction | typeof pool;
export type ReaderContext = { bookId: string; chapterId: string; html: string; chapters: string[]; authorId: string };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export async function readerContext(bookId: string, chapterId: string, db: Db = pool, lock = false): Promise<ReaderContext> {
  const book = await writerRow(bookId, db, lock);
  if (!book.public_visible) return fail(404, 'Yayınlanmış kitap bulunamadı.');
  const doc = book.published_data ?? legacyDocument(book);
  const chapter = doc.chapters.find(item => item.id === chapterId);
  if (!chapter) return fail(404, 'Bu bölüm henüz yayında değil.');
  return { bookId, chapterId, html: chapter.html, chapters: doc.chapters.map(item => item.id), authorId: book.author_id };
}

/** Unique unchanged text survives insertions elsewhere. Duplicate text is tied to
 * the exact snapshot: ambiguity must archive a thread, never move it elsewhere. */
async function paragraphRegistry(context: ReaderContext, db: Db) {
  const contentHash = digest(context.html);
  const paragraphs = getReaderParagraphs(context.html).map(item => ({
    ...item, text: item.text.normalize('NFC').trim().replace(/\s+/g, ' '),
  })).filter(item => !!item.text);
  const frequencies = new Map<string, number>(), occurrences = new Map<string, number>();
  const previous = (await db.query<{ content_key: string }>(
    'SELECT content_key FROM reader_paragraphs WHERE book_id=$1 AND chapter_id=$2',
    [context.bookId, context.chapterId])).rows;
  const ambiguous = new Set(previous.filter(row => row.content_key.includes(':')).map(row => row.content_key.split(':')[0]));
  for (const item of paragraphs) frequencies.set(item.text, (frequencies.get(item.text) ?? 0) + 1);
  const keys = paragraphs.map(item => {
    const occurrence = occurrences.get(item.text) ?? 0;
    occurrences.set(item.text, occurrence + 1);
    const fingerprint = digest(item.text);
    return fingerprint + ((frequencies.get(item.text) ?? 0) > 1 || ambiguous.has(fingerprint) ? `:${contentHash}:${occurrence}` : '');
  });
  if (keys.length) await db.query(`INSERT INTO reader_paragraphs(book_id,chapter_id,content_key,quote)
    SELECT $1,$2,k,q FROM unnest($3::text[],$4::text[]) AS source(k,q) ON CONFLICT DO NOTHING`,
  [context.bookId, context.chapterId, keys, paragraphs.map(item => Array.from(item.text).slice(0, 200).join(''))]);
  const rows = (await db.query<{ id: string; content_key: string; quote: string }>(
    'SELECT id,content_key,quote FROM reader_paragraphs WHERE book_id=$1 AND chapter_id=$2',
    [context.bookId, context.chapterId])).rows;
  const byKey = new Map(rows.map(row => [row.content_key, row]));
  const current = paragraphs.map((item, i) => ({ ...byKey.get(keys[i])!, path: item.path }));
  return { contentHash, current, rows };
}

export async function assertReaderParagraph(db: Db, context: ReaderContext, paragraphId: string, allowArchived = false) {
  const registry = await paragraphRegistry(context, db);
  const found = registry.rows.find(row => row.id === paragraphId);
  if (!found) return fail(404, 'Paragraf bu bölüme ait değil.');
  if (!allowArchived && !registry.current.some(row => row.id === paragraphId)) return fail(409, 'Bu paragrafın metni değişti. Önceki konuşma arşivde korunuyor; bölümü yenile.');
}

export async function readerChapter(context: ReaderContext, actor: string | null, db: Db = pool): Promise<ReaderChapter> {
  const registry = await paragraphRegistry(context, db);
  const counts = (await db.query<{ paragraph_id: string | null; count: number }>(`WITH RECURSIVE ${commentTree()}
    SELECT t.paragraph_id,count(*)::int AS count FROM visible_comment_nodes n JOIN writer_comments c ON c.id=n.id
    LEFT JOIN reader_comment_targets t ON t.comment_id=n.id WHERE n.chapter_id=$3 GROUP BY t.paragraph_id`,
  [context.bookId, context.chapters, context.chapterId])).rows;
  const likes = (await db.query<{ paragraph_id: string | null; count: number; liked: boolean }>(`SELECT paragraph_id,
    count(*)::int AS count,coalesce(bool_or(user_id=$3),false) AS liked FROM reader_likes
    WHERE book_id=$1 AND chapter_id=$2 GROUP BY paragraph_id`, [context.bookId, context.chapterId, actor])).rows;
  const reads = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM reader_chapter_reads WHERE book_id=$1 AND chapter_id=$2',
    [context.bookId, context.chapterId]);
  const countMap = new Map(counts.map(row => [row.paragraph_id, row.count]));
  const likeMap = new Map(likes.map(row => [row.paragraph_id, row]));
  const item = (row: { id: string; quote: string; path?: string }, archived: boolean): ReaderParagraph => ({
    id: row.id, path: row.path ?? '', quote: row.quote, archived,
    commentCount: countMap.get(row.id) ?? 0, likeCount: likeMap.get(row.id)?.count ?? 0, liked: likeMap.get(row.id)?.liked ?? false,
  });
  const currentIds = new Set(registry.current.map(row => row.id));
  return {
    bookId: context.bookId, chapterId: context.chapterId, contentHash: registry.contentHash,
    likeCount: likeMap.get(null)?.count ?? 0, liked: likeMap.get(null)?.liked ?? false,
    readCount: reads.rows[0]?.count ?? 0,
    commentCount: counts.reduce((sum, row) => sum + row.count, 0), chapterCommentCount: countMap.get(null) ?? 0,
    paragraphs: registry.current.map(row => item(row, false)),
    archived: registry.rows.filter(row => !currentIds.has(row.id) && ((countMap.get(row.id) ?? 0) > 0 || (likeMap.get(row.id)?.count ?? 0) > 0))
      .map(row => item(row, true)),
  };
}

/** Counts a published chapter once per reader and day; authors' own reads stay out of public totals. */
export async function recordChapterRead(db: Transaction, context: ReaderContext, actor: string) {
  if (context.authorId !== actor) await db.query(`INSERT INTO reader_chapter_reads(book_id,chapter_id,reader_id)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [context.bookId, context.chapterId, actor]);
  return readerChapter(context, actor, db);
}

export async function readerLike(db: Transaction, book: string, chapter: string, actor: string, liked: boolean, paragraph: string | null) {
  const context = await readerContext(book, chapter, db, true);
  if (paragraph) await assertReaderParagraph(db, context, paragraph, !liked);
  if (liked) await db.query(`INSERT INTO reader_likes(book_id,chapter_id,paragraph_id,user_id)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [book, chapter, paragraph, actor]);
  else await db.query(`DELETE FROM reader_likes WHERE book_id=$1 AND chapter_id=$2
    AND paragraph_id IS NOT DISTINCT FROM $3::uuid AND user_id=$4`, [book, chapter, paragraph, actor]);
  return readerChapter(context, actor, db);
}
