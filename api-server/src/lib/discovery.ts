import { pool } from '@workspace/db';
import type { DiscoveryBookCard } from '@workspace/api-zod';
import { publicBook } from './book-access';
import { fail, uuid } from './community';
import { coverUrl } from './writer-document';
import { publicCommentCount } from './book-comment-query';

type Sort = 'new' | 'read' | 'popular';
type Rank = DiscoveryBookCard & { a: number; b: number };
const normalized = (sql: string) => `translate(lower(${sql}),'ıİğüşöçâîû','iigusocaiu')`;
export function discoveryNeedle(value: unknown) {
  return String(value ?? '').trim().slice(0, 100).toLocaleLowerCase('tr-TR')
    .replace(/[ıİğüşöçâîû]/g, c => ({ 'ı': 'i', 'İ': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' })[c] ?? c);
}
export const searchExpression = normalized;
// Released snapshots only. No current manuscript/body is transferred in cards.
const cards = `SELECT b.id,coalesce(b.published_data->>'title',b.title) AS title,
  json_build_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar) AS author,
  CASE WHEN b.published_data IS NOT NULL THEN b.published_data->>'cover' ELSE b.cover END AS "coverUrl",
  coalesce(b.published_data->'genres','[]'::jsonb) AS genres,
  date_trunc('milliseconds',coalesce(b.published_at,b.created_at,'1970-01-01'::timestamptz)) AS "publishedAt",
  (SELECT count(*)::int FROM book_reads r WHERE r.book_id=b.id) AS "readCount",
  (SELECT count(*)::int FROM writer_likes l WHERE l.book_id=b.id) AS "likeCount",
  ${publicCommentCount()} AS "commentCount"
  FROM authored_books b JOIN community_users u ON u.id=b.author_id
  WHERE ${publicBook()}`;
function output({ a: _a, b: _b, ...row }: Rank) {
  return { ...row, publishedAt: new Date(row.publishedAt).toISOString(), coverUrl: coverUrl(row.coverUrl ?? null) };
}
export async function discoveryBooks(sortValue: unknown, search: unknown, cursorValue: unknown) {
  const sort = String(sortValue ?? 'new') as Sort;
  if (!['new', 'read', 'popular'].includes(sort)) return fail(400, 'Geçersiz sıralama.');
  const needle = discoveryNeedle(search);
  let cursor: { a: number; b: number; time: string; id: string; q: string; sort: Sort } | null = null;
  if (cursorValue) {
    try {
      if (typeof cursorValue !== 'string' || cursorValue.length > 2048) throw new Error();
      cursor = JSON.parse(Buffer.from(cursorValue, 'base64url').toString());
      if (!cursor || cursor.sort !== sort || cursor.q !== needle || !Number.isSafeInteger(cursor.a) || cursor.a < 0
        || !Number.isSafeInteger(cursor.b) || cursor.b < 0 || typeof cursor.time !== 'string'
        || !Number.isFinite(Date.parse(cursor.time)) || new Date(cursor.time).toISOString() !== cursor.time) throw new Error();
      uuid(cursor.id);
    } catch { return fail(400, 'Liste konumu geçersiz. Listeyi yeniden aç.'); }
  }
  const rank = sort === 'read' ? ['"readCount"', '"likeCount"'] : sort === 'popular' ? ['"likeCount"', '"readCount"'] : ['0', '0'];
  const rows = (await pool.query<Rank>(`WITH cards AS (${cards}), ranked AS (
    SELECT *,${rank[0]}::int AS a,${rank[1]}::int AS b FROM cards
    WHERE ${normalized(`title || ' ' || (author->>'nickname') || ' ' || genres::text`)} LIKE $1 ESCAPE '\\')
    SELECT * FROM ranked WHERE ($2::timestamptz IS NULL OR
      (a,b,"publishedAt",id)<($3::int,$4::int,$2::timestamptz,$5::uuid))
    ORDER BY a DESC,b DESC,"publishedAt" DESC,id DESC LIMIT 21`,
  ['%' + needle.replace(/[%_\\]/g, '\\$&') + '%', cursor?.time ?? null, cursor?.a ?? 0, cursor?.b ?? 0, cursor?.id ?? null])).rows;
  const page = rows.slice(0, 20), last = page.at(-1);
  return { items: page.map(output), nextCursor: rows.length > 20 && last
    ? Buffer.from(JSON.stringify({ a: last.a, b: last.b, time: new Date(last.publishedAt).toISOString(), id: last.id, q: needle, sort })).toString('base64url') : null };
}
export async function bookCards(idsValue: unknown) {
  if (typeof idsValue !== 'string' || idsValue.length > 1200) return fail(400, 'Kitap listesi geçersiz.');
  const ids = [...new Set(idsValue.split(',').filter(Boolean))];
  if (ids.length > 30) return fail(400, 'Bir defada en fazla 30 kitap getirilebilir.');
  for (const id of ids) uuid(id);
  if (!ids.length) return [];
  const rows = (await pool.query<Rank>(`WITH cards AS (${cards}) SELECT *,0 AS a,0 AS b FROM cards WHERE id=ANY($1::uuid[])`, [ids])).rows;
  return rows.map(output);
}
