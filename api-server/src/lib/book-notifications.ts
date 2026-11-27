import { pool } from '@workspace/db';
import type { BookNotificationPage, SocialNotification } from '@workspace/api-zod';
import { fail } from './community';
import { publicBook } from './book-access';
import { bookCursor } from './book-comments';

// This predicate is shared by history, total unread count and read ownership.
// Legacy social/bulletin rows must never enter the canonical inbox.
function eligible(appealOnly = false) {
  return `SELECT n.id,n.actor_id AS "actorId",NULL::uuid AS "threadId",n.book_id AS "bookId",
    n.comment_id AS "commentId",n.chapter_id AS "chapterId",n.application_id AS "applicationId",
    n.kind,n.read,n.created_at AS "createdAt",
    to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorDate",
    CASE WHEN n.kind IN ('premium_status','store_order','account_appeal') THEN coalesce(n.notification_body,'Afilli hesabının durumu güncellendi.')
    ELSE u.nickname||CASE n.kind
      WHEN 'chapter' THEN ', “'||coalesce(b.published_data->>'title',b.title)||'” kitabına yeni bölüm ekledi.'
      WHEN 'book_like' THEN ', “'||coalesce(b.published_data->>'title',b.title)||'” kitabını beğendi.'
      WHEN 'book_comment' THEN ', “'||coalesce(b.published_data->>'title',b.title)||'” kitabına yorum yaptı: “'||
        left(coalesce(preview.body,''),120)||CASE WHEN length(coalesce(preview.body,''))>120 THEN '…' ELSE '' END||'”'
      ELSE ', “'||coalesce(b.published_data->>'title',b.title)||'” kitabındaki yorumuna yanıt verdi: “'||
        left(coalesce(preview.body,''),120)||CASE WHEN length(coalesce(preview.body,''))>120 THEN '…' ELSE '' END||'”'
      END END AS body
    FROM social_notifications n
    LEFT JOIN authored_books b ON b.id=n.book_id
    LEFT JOIN community_users u ON u.id=n.actor_id
    LEFT JOIN premium_applications pa ON pa.id=n.application_id
    LEFT JOIN LATERAL (
      SELECT regexp_replace(trim(c.body),'[[:space:]]+',' ','g') AS body
      FROM writer_comments c WHERE c.id=n.comment_id
    ) preview ON true
    WHERE n.recipient_id=$1 AND (n.actor_id<>n.recipient_id OR n.kind IN ('premium_status','store_order','account_appeal'))
      AND (${appealOnly ? "n.kind='account_appeal'" : 'true'}) AND (
      (n.kind='premium_status' AND pa.id IS NOT NULL AND pa.user_id=n.recipient_id)
      OR (n.kind='store_order' AND n.notification_body IS NOT NULL)
      OR (n.kind='account_appeal' AND n.notification_body IS NOT NULL)
      OR (b.id IS NOT NULL AND ${publicBook()} AND (
      (n.kind='chapter' AND n.chapter_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM jsonb_array_elements(coalesce(b.published_data->'chapters','[]'::jsonb)) ch WHERE ch->>'id'=n.chapter_id::text))
      OR (n.kind='book_like' AND n.recipient_id=b.author_id AND n.comment_id IS NULL AND n.chapter_id IS NULL)
      OR (n.kind IN ('book_comment','comment_reply') AND EXISTS(SELECT 1 FROM writer_comments c WHERE c.id=n.comment_id AND c.book_id=b.id)
        AND (n.chapter_id IS NULL OR (b.published_data IS NULL AND b.writer_data IS NULL) OR EXISTS(
          SELECT 1 FROM jsonb_array_elements(coalesce(b.published_data->'chapters','[]'::jsonb)) ch WHERE ch->>'id'=n.chapter_id::text))
        AND NOT EXISTS(WITH RECURSIVE ancestors AS(
          SELECT id,parent_id,moderation_hidden FROM writer_comment_nodes WHERE id=n.comment_id UNION ALL
          SELECT p.id,p.parent_id,p.moderation_hidden FROM writer_comment_nodes p JOIN ancestors a ON p.id=a.parent_id
        ) SELECT 1 FROM ancestors WHERE moderation_hidden))
      ))
    )`;
}
export async function bookNotifications(owner: string, cursor?: unknown, appealOnly = false): Promise<BookNotificationPage> {
  const { date, id } = bookCursor(cursor);
  const result = await pool.query<{ items: (SocialNotification & { cursorDate: string })[]; unreadCount: number }>(`WITH eligible AS (${eligible(appealOnly)}),
    page AS(SELECT * FROM eligible WHERE ($2::timestamptz IS NULL OR ("createdAt",id)<($2::timestamptz,$3::uuid))
      ORDER BY "createdAt" DESC,id DESC LIMIT 31)
    SELECT (SELECT count(*)::int FROM eligible WHERE NOT read) AS "unreadCount",
      coalesce((SELECT json_agg(page ORDER BY "createdAt" DESC,id DESC) FROM page),'[]'::json) AS items`, [owner, date, id]);
  const row = result.rows[0], page = row.items.slice(0, 30), last = page.at(-1);
  const items = page.map(({ cursorDate: _cursorDate, ...n }) => ({ ...n, createdAt: new Date(n.createdAt).toISOString() }));
  return { items, unreadCount: row.unreadCount, nextCursor: row.items.length > 30 && last ? `${last.cursorDate}|${last.id}` : null };
}
export async function readBookNotification(owner: string, id: string, appealOnly = false) {
  const result = await pool.query(`WITH eligible AS (${eligible(appealOnly)})
    UPDATE social_notifications SET read=true WHERE id=$2 AND id IN (SELECT id FROM eligible)`, [owner, id]);
  if (!result.rowCount) return fail(404, 'Bildirim bulunamadı.');
}
