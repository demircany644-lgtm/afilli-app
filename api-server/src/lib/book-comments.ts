import { pool } from '@workspace/db';
import type { WriterComment, WriterCommentInput, WriterCommentPage } from '@workspace/api-zod';
import { fail, uuid, type Transaction } from './community';
import { writerRow } from './writer-service';
import { legacyDocument } from './writer-document';
import { commentTree } from './book-comment-query';
import { socialNotify } from './social';
import { readerContext, assertReaderParagraph } from './reader-interactions';
import { readerAction } from './reader-spam';

type Db = Transaction | typeof pool;
type Scope = { id: string; chapters: string[]; author: string };
type NodeRow = WriterComment & { cursorDate: string };
const publicNode = ({ cursorDate: _cursorDate, ...node }: NodeRow): WriterComment => node;
export function bookCursor(value: unknown) {
  if (value === undefined) return { date: null, id: null };
  if (typeof value !== 'string' || value.length > 100) return fail(400, 'Geçersiz sayfa.');
  const [date, id, extra] = value.split('|');
  if (extra || !date || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(date)
    || date.startsWith('0000') || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString() !== date.replace(/(\.\d{3})\d+Z$/, '$1Z')) return fail(400, 'Geçersiz sayfa.');
  return { date, id: uuid(id) };
}
export async function commentScope(id: string, db: Db = pool, lock = false): Promise<Scope> {
  const row = await writerRow(id, db, lock);
  if (!row.public_visible) return fail(404, 'Yayınlanmış kitap bulunamadı.');
  return { id, author: row.author_id, chapters: (row.published_data ?? legacyDocument(row)).chapters.map(c => c.id) };
}
async function nodes(scope: Scope, who: string | null, where: string, extra: unknown[], db: Db) {
  const result = await db.query<NodeRow>(`WITH RECURSIVE ${commentTree()}
    SELECT n.id,n.book_id AS "bookId",n.parent_id AS "parentId",n.chapter_id AS "chapterId",rt.paragraph_id AS "paragraphId",n.created_at AS "createdAt",
    to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorDate",
    c.id IS NULL AS deleted,coalesce(c.body,'Bu yorum kaldırıldı.') AS body,
    CASE WHEN c.id IS NULL THEN json_build_object('id','deleted','nickname','Kaldırılan yorum','avatar',NULL)
      ELSE json_build_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar) END AS author,
    (SELECT count(*)::int FROM visible_comment_nodes child JOIN live_comment_nodes l ON l.id=child.id WHERE child.parent_id=n.id) AS "replyCount",
    (SELECT json_build_array(
      json_build_object('reaction','like','count',count(*) FILTER(WHERE reaction='like'),
        'selected',coalesce(bool_or(user_id=$3 AND reaction='like'),false)),
      json_build_object('reaction','love','count',count(*) FILTER(WHERE reaction='love'),
        'selected',coalesce(bool_or(user_id=$3 AND reaction='love'),false)))
      FROM writer_comment_reactions WHERE comment_id=n.id) AS reactions
    FROM visible_comment_nodes n JOIN live_comment_nodes l ON l.id=n.id
    LEFT JOIN writer_comments c ON c.id=n.id LEFT JOIN community_users u ON u.id=c.author_id
    LEFT JOIN reader_comment_targets rt ON rt.comment_id=n.id
    WHERE ${where}`, [scope.id, scope.chapters, who, ...extra]);
  return result.rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
}
export async function commentNode(id: string, who: string | null, db: Db = pool, scope?: Scope) {
  if (!scope) {
    const book = (await db.query<{ book_id: string }>('SELECT book_id FROM writer_comment_nodes WHERE id=$1', [id])).rows[0];
    if (!book) return fail(404, 'Yorum bulunamadı.');
    scope = await commentScope(book.book_id, db);
  }
  const node = (await nodes(scope, who, 'n.id=$4', [id], db))[0] ?? fail(404, 'Yorum bulunamadı veya artık erişilemiyor.');
  return publicNode(node);
}
export async function commentPage(scope: Scope, who: string | null, parent: string | null, cursor: unknown,
  filter: { scope?: string; chapterId?: string; paragraphId?: string } = {}): Promise<WriterCommentPage> {
  const { date, id } = bookCursor(cursor);
  const mode = filter.scope ?? (filter.paragraphId ? 'paragraph' : filter.chapterId ? 'chapter' : null);
  if (mode && !['book', 'chapter', 'paragraph'].includes(mode)) return fail(400, 'Geçersiz yorum alanı.');
  if ((mode === 'chapter' || mode === 'paragraph') && (!filter.chapterId || !scope.chapters.includes(filter.chapterId)))
    return fail(404, 'Bu bölüm henüz yayında değil.');
  if ((mode === 'book' && (filter.chapterId || filter.paragraphId)) || (mode === 'chapter' && filter.paragraphId))
    return fail(400, 'Yorum alanı ile bölüm veya paragraf eşleşmiyor.');
  if (mode === 'paragraph') {
    if (!filter.paragraphId) return fail(400, 'Paragrafı seç.');
    const row = await pool.query('SELECT id FROM reader_paragraphs WHERE id=$1 AND book_id=$2 AND chapter_id=$3',
      [filter.paragraphId, scope.id, filter.chapterId]);
    if (!row.rowCount) return fail(404, 'Paragraf bulunamadı.');
  }
  const rows = await nodes(scope, who, `n.parent_id IS NOT DISTINCT FROM $4::uuid
    AND ($5::timestamptz IS NULL OR (n.created_at,n.id)<($5::timestamptz,$6::uuid))
    AND ($7::text IS NULL
      OR ($7='book' AND n.chapter_id IS NULL AND rt.paragraph_id IS NULL)
      OR ($7='chapter' AND n.chapter_id=$8::uuid AND rt.paragraph_id IS NULL)
      OR ($7='paragraph' AND n.chapter_id=$8::uuid AND rt.paragraph_id=$9::uuid))
    ORDER BY n.created_at DESC,n.id DESC LIMIT 21`, [parent, date, id, mode, filter.chapterId ?? null, filter.paragraphId ?? null], pool);
  const items = rows.slice(0, 20), last = items.at(-1);
  return { items: items.map(publicNode), nextCursor: rows.length > 20 && last ? `${last.cursorDate}|${last.id}` : null };
}
export async function commentPath(id: string, who: string | null) {
  const context = (await pool.query<{ book_id: string }>('SELECT book_id FROM writer_comment_nodes WHERE id=$1', [id])).rows[0];
  if (!context) return fail(404, 'Yorum bulunamadı.');
  const scope = await commentScope(context.book_id);
  await commentNode(id, who, pool, scope);
  const path = (await pool.query<{ id: string }>(`WITH RECURSIVE ancestors AS (
    SELECT id,parent_id,0 AS depth FROM writer_comment_nodes WHERE id=$1 UNION ALL
    SELECT n.id,n.parent_id,a.depth+1 FROM writer_comment_nodes n JOIN ancestors a ON n.id=a.parent_id
  ) SELECT id FROM ancestors ORDER BY depth DESC`, [id])).rows.map(r => r.id);
  return (await nodes(scope, who, 'n.id=ANY($4::uuid[]) ORDER BY array_position($4::uuid[],n.id)', [path], pool)).map(publicNode);
}
export async function addComment(db: Transaction, book: string, actor: string, input: WriterCommentInput) {
  const body = input.body.trim();
  if (!body) return fail(400, 'Yorumunu yaz.');
  const scope = await commentScope(book, db, true);
  let requestedChapter = input.chapterId ?? null;
  if (input.paragraphId) {
    const target = (await db.query<{ chapter_id: string }>('SELECT chapter_id FROM reader_paragraphs WHERE id=$1 AND book_id=$2',
      [input.paragraphId, book])).rows[0] ?? fail(404, 'Paragraf bulunamadı.');
    if (requestedChapter && requestedChapter !== target.chapter_id) return fail(400, 'Paragraf başka bir bölüme ait.');
    requestedChapter = target.chapter_id;
  }
  const existing = (await db.query<{ id: string; body: string; chapter_id: string | null; parent_id: string | null; paragraph_id: string | null }>(
    `SELECT c.id,c.body,c.chapter_id,c.parent_id,t.paragraph_id FROM writer_comments c
    LEFT JOIN reader_comment_targets t ON t.comment_id=c.id WHERE c.book_id=$1 AND c.author_id=$2 AND c.client_id=$3`,
    [book, actor, input.clientId])).rows[0];
  if (existing) {
    const chapterMatches = input.parentId && input.chapterId == null ? true : existing.chapter_id === requestedChapter;
    const paragraphMatches = input.parentId && input.paragraphId === undefined ? true : existing.paragraph_id === (input.paragraphId ?? null);
    if (existing.body !== body || existing.parent_id !== (input.parentId ?? null) || !chapterMatches || !paragraphMatches) return fail(409, 'Bu gönderim kimliği başka bir yorum için kullanıldı.');
    return commentNode(existing.id, actor, db, scope);
  }
  let chapter = requestedChapter, paragraph = input.paragraphId ?? null, recipient = scope.author;
  if (input.parentId) {
    const parent = await commentNode(input.parentId, actor, db, scope);
    if (parent.deleted) return fail(404, 'Kaldırılmış yoruma yanıt verilemez.');
    const locked = await db.query('SELECT id FROM writer_comments WHERE id=$1 AND NOT moderation_hidden FOR UPDATE', [parent.id]);
    if (!locked.rowCount) return fail(404, 'Yorum artık erişilemiyor.');
    if (chapter && chapter !== parent.chapterId) return fail(400, 'Yanıt, üst yorumun bölümüne aittir.');
    if (input.paragraphId !== undefined && (input.paragraphId ?? null) !== (parent.paragraphId ?? null))
      return fail(400, 'Yanıt, üst yorumun paragrafına aittir.');
    chapter = parent.chapterId; paragraph = parent.paragraphId ?? null; recipient = parent.author.id;
  }
  if (chapter && !scope.chapters.includes(chapter)) return fail(404, 'Bu bölüm henüz yayında değil.');
  if (paragraph) {
    if (!chapter) return fail(400, 'Paragrafın bölümü eksik.');
    await assertReaderParagraph(db, await readerContext(book, chapter, db), paragraph, !!input.parentId);
  }
  await readerAction(db, actor, 'comment:' + body);
  const row = (await db.query<{ id: string }>(`INSERT INTO writer_comments(book_id,author_id,client_id,chapter_id,parent_id,body)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [book, actor, input.clientId, chapter, input.parentId ?? null, body])).rows[0];
  if (paragraph) await db.query('INSERT INTO reader_comment_targets(comment_id,paragraph_id) VALUES($1,$2)', [row.id, paragraph]);
  const kind = input.parentId ? 'comment_reply' : 'book_comment';
  await socialNotify(db, recipient, actor, kind, `${kind}:${row.id}`, null, book, row.id, chapter);
  return commentNode(row.id, actor, db, scope);
}

/** Keep the same book-then-content lock order as replies, moderation and publication. */
async function ownedComment(db: Transaction, id: string, actor: string) {
  const record = (await db.query<{ book_id: string }>('SELECT book_id FROM writer_comment_nodes WHERE id=$1', [id])).rows[0];
  if (!record) return fail(404, 'Yorum bulunamadı.');
  const scope = await commentScope(record.book_id, db, true);
  const node = await commentNode(id, actor, db, scope);
  if (node.deleted) return fail(404, 'Yorum artık bulunmuyor.');
  if (node.author.id !== actor) return fail(403, 'Yalnızca kendi yorumunu değiştirebilirsin.');
  const locked = await db.query('SELECT id FROM writer_comments WHERE id=$1 AND author_id=$2 AND NOT moderation_hidden FOR UPDATE', [id, actor]);
  if (!locked.rowCount) return fail(404, 'Yorum artık erişilemiyor.');
  return { scope, node };
}

export async function editComment(db: Transaction, id: string, actor: string, text: string) {
  const body = text.trim();
  if (!body) return fail(400, 'Yorumunu yaz.');
  const { scope, node } = await ownedComment(db, id, actor);
  if (node.body === body) return node;
  await readerAction(db, actor, 'edit:' + body);
  await db.query('UPDATE writer_comments SET body=$3 WHERE id=$1 AND author_id=$2', [id, actor, body]);
  return commentNode(id, actor, db, scope);
}

export async function deleteComment(db: Transaction, id: string, actor: string): Promise<WriterComment> {
  const { node } = await ownedComment(db, id, actor);
  // Do NOT delete writer_comment_nodes: children belong to their own authors.
  await db.query('DELETE FROM writer_comments WHERE id=$1 AND author_id=$2', [id, actor]);
  return { ...node, deleted: true, body: '', author: { id: 'deleted', nickname: '', avatar: null },
    reactions: node.reactions.map(reaction => ({ ...reaction, count: 0, selected: false })) };
}
