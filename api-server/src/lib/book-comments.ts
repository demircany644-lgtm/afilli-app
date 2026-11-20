import { pool } from '@workspace/db';
import type { WriterComment, WriterCommentInput, WriterCommentPage } from '@workspace/api-zod';
import { fail, uuid, type Transaction } from './community';
import { writerRow } from './writer-service';
import { legacyDocument } from './writer-document';
import { commentTree } from './book-comment-query';
import { socialNotify } from './social';

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
    SELECT n.id,n.book_id AS "bookId",n.parent_id AS "parentId",n.chapter_id AS "chapterId",n.created_at AS "createdAt",
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
export async function commentPage(scope: Scope, who: string | null, parent: string | null, cursor: unknown): Promise<WriterCommentPage> {
  const { date, id } = bookCursor(cursor);
  const rows = await nodes(scope, who, `n.parent_id IS NOT DISTINCT FROM $4::uuid
    AND ($5::timestamptz IS NULL OR (n.created_at,n.id)<($5::timestamptz,$6::uuid))
    ORDER BY n.created_at DESC,n.id DESC LIMIT 21`, [parent, date, id], pool);
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
  const existing = (await db.query<{ id: string; body: string; chapter_id: string | null; parent_id: string | null }>(
    'SELECT id,body,chapter_id,parent_id FROM writer_comments WHERE book_id=$1 AND author_id=$2 AND client_id=$3',
    [book, actor, input.clientId])).rows[0];
  if (existing) {
    const chapterMatches = input.parentId && input.chapterId == null ? true : existing.chapter_id === (input.chapterId ?? null);
    if (existing.body !== body || existing.parent_id !== (input.parentId ?? null) || !chapterMatches) return fail(409, 'Bu gönderim kimliği başka bir yorum için kullanıldı.');
    return commentNode(existing.id, actor, db, scope);
  }
  let chapter = input.chapterId ?? null, recipient = scope.author;
  if (input.parentId) {
    const parent = await commentNode(input.parentId, actor, db, scope);
    if (parent.deleted) return fail(404, 'Kaldırılmış yoruma yanıt verilemez.');
    const locked = await db.query('SELECT id FROM writer_comments WHERE id=$1 AND NOT moderation_hidden FOR UPDATE', [parent.id]);
    if (!locked.rowCount) return fail(404, 'Yorum artık erişilemiyor.');
    if (chapter && chapter !== parent.chapterId) return fail(400, 'Yanıt, üst yorumun bölümüne aittir.');
    chapter = parent.chapterId; recipient = parent.author.id;
  }
  if (chapter && !scope.chapters.includes(chapter)) return fail(404, 'Bu bölüm henüz yayında değil.');
  const row = (await db.query<{ id: string }>(`INSERT INTO writer_comments(book_id,author_id,client_id,chapter_id,parent_id,body)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [book, actor, input.clientId, chapter, input.parentId ?? null, body])).rows[0];
  const kind = input.parentId ? 'comment_reply' : 'book_comment';
  await socialNotify(db, recipient, actor, kind, `${kind}:${row.id}`, null, book, row.id, chapter);
  return commentNode(row.id, actor, db, scope);
}
