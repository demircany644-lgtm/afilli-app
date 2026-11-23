import { pool } from '@workspace/db';
import type { ReaderReport, ReaderReportInput, ReaderReportPage } from '@workspace/api-zod';
import { bookCursor, commentNode, commentScope } from './book-comments';
import { fail, type Transaction } from './community';
import { audit } from './admin';
import { writerRow } from './writer-service';
import { readerAction } from './reader-spam';

type Db = Transaction | typeof pool;
type ReportRow = ReaderReport & { cursorDate: string };
const selectReport = `SELECT r.id,r.comment_id AS "commentId",n.book_id AS "bookId",n.chapter_id AS "chapterId",
  t.paragraph_id AS "paragraphId",coalesce(c.body,'') AS body,r.reason,r.details,r.status,r.created_at AS "createdAt",
  to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorDate",
  json_build_object('id',coalesce(a.id,'deleted'),'nickname',coalesce(a.nickname,''),'avatar',a.avatar) AS author,
  json_build_object('id',p.id,'nickname',p.nickname,'avatar',p.avatar) AS reporter
  FROM reader_reports r JOIN writer_comment_nodes n ON n.id=r.comment_id
  JOIN community_users p ON p.id=r.reporter_id LEFT JOIN writer_comments c ON c.id=n.id
  LEFT JOIN community_users a ON a.id=c.author_id LEFT JOIN reader_comment_targets t ON t.comment_id=n.id`;
const publicReport = ({ cursorDate: _date, ...row }: ReportRow): ReaderReport => ({ ...row, createdAt: new Date(row.createdAt) });
async function reportRecord(id: string, db: Db = pool) {
  const row = (await db.query<ReportRow>(selectReport + ' WHERE r.id=$1', [id])).rows[0] ?? fail(404, 'Şikâyet bulunamadı.');
  return publicReport(row);
}
export async function reportComment(db: Transaction, actor: string, id: string, input: ReaderReportInput) {
  const book = (await db.query<{ book_id: string }>('SELECT book_id FROM writer_comment_nodes WHERE id=$1', [id])).rows[0];
  if (!book) return fail(404, 'Yorum bulunamadı.');
  const scope = await commentScope(book.book_id, db, true), node = await commentNode(id, actor, db, scope);
  if (node.deleted) return fail(404, 'Bu yorum artık yok.');
  if (node.author.id === actor) return fail(400, 'Kendi yorumunu şikâyet etmek yerine düzenleyebilir veya silebilirsin.');
  const old = (await db.query<{ id: string }>('SELECT id FROM reader_reports WHERE comment_id=$1 AND reporter_id=$2', [id, actor])).rows[0];
  if (old) return reportRecord(old.id, db);
  await readerAction(db, actor, 'report:' + id);
  const saved = (await db.query<{ id: string }>(`INSERT INTO reader_reports(comment_id,reporter_id,reason,details)
    VALUES($1,$2,$3,$4) ON CONFLICT(comment_id,reporter_id) DO UPDATE SET comment_id=excluded.comment_id RETURNING id`,
  [id, actor, input.reason, input.details?.trim() ?? ''])).rows[0];
  return reportRecord(saved.id, db);
}
export async function reportPage(status: string, cursor: unknown): Promise<ReaderReportPage> {
  const { date, id } = bookCursor(cursor);
  const rows = (await pool.query<ReportRow>(`${selectReport} WHERE r.status=$1
    AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::uuid))
    ORDER BY r.created_at DESC,r.id DESC LIMIT 31`, [status, date, id])).rows;
  const page = rows.slice(0, 30), last = page.at(-1);
  return { items: page.map(publicReport), nextCursor: rows.length > 30 && last ? `${last.cursorDate}|${last.id}` : null };
}
export async function resolveReport(db: Transaction, admin: string, id: string, action: 'dismiss' | 'hide') {
  const before = await reportRecord(id, db);
  await writerRow(before.bookId, db, true);
  const locked = (await db.query<{ status: ReaderReport['status'] }>('SELECT status FROM reader_reports WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!locked) return fail(404, 'Şikâyet bulunamadı.');
  const status = action === 'hide' ? 'hidden' : 'dismissed';
  if (locked.status !== 'pending') {
    if (locked.status === status) return reportRecord(id, db);
    return fail(409, 'Bu şikâyet daha önce incelendi. Listeyi yenile.');
  }
  if (action === 'hide') {
    const changed = await db.query('UPDATE writer_comments SET moderation_hidden=true WHERE id=$1', [before.commentId]);
    if (!changed.rowCount) return fail(409, 'Yorum artık yok. Şikâyeti kapatabilirsin.');
  }
  await db.query('UPDATE reader_reports SET status=$2 WHERE id=$1', [id, status]);
  await audit(db, admin, 'reader.report.' + action, 'writer_comment', before.commentId,
    'Okuyucu şikâyeti: ' + before.reason, { reportId: id, before: locked.status, after: status });
  return reportRecord(id, db);
}
