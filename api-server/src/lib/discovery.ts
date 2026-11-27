import { pool } from '@workspace/db';
import type { DiscoveryBookCard } from '@workspace/api-zod';
import { publicBook } from './book-access';
import { fail, uuid } from './community';
import { coverUrl } from './writer-document';
import { publicCommentCount } from './book-comment-query';
import { writerBadgesSql } from './writer-achievements';
import { expireBookPromotions } from './book-promotions';

type Sort = 'new' | 'read' | 'popular';
type Category = 'romantik' | 'gerilim-polisiye-gizem' | 'fantastik' | 'mafya-yeralti' | 'bilim-kurgu-distopya' | 'dram-hayat-hikayeleri'
  | 'ask-romani' | 'fantastik-bilim-kurgu' | 'polisiye-gerilim' | 'mafya' | 'psikolojik-iliskiler';
type Rank = DiscoveryBookCard & { a: number; b: number };
const CATEGORY_GENRES: Record<Category, readonly string[]> = {
  romantik: ['Romantik', 'Aşk'],
  'gerilim-polisiye-gizem': ['Gerilim', 'Polisiye', 'Gizem'],
  fantastik: ['Fantastik'],
  'mafya-yeralti': ['Mafya', 'Yeraltı Dünyası'],
  'bilim-kurgu-distopya': ['Bilim Kurgu', 'Distopya'],
  'dram-hayat-hikayeleri': ['Dram', 'Hayat Hikâyeleri', 'Anı', 'Biyografi'],
  'ask-romani': ['Aşk', 'Romantik'],
  'fantastik-bilim-kurgu': ['Fantastik', 'Bilim Kurgu'],
  'polisiye-gerilim': ['Polisiye', 'Gerilim'],
  mafya: ['Mafya'],
  'psikolojik-iliskiler': ['Psikoloji'],
};
const normalized = (sql: string) => `translate(lower(${sql}),'ıİğüşöçâîû','iigusocaiu')`;
export function discoveryNeedle(value: unknown) {
  return String(value ?? '').trim().slice(0, 100).toLocaleLowerCase('tr-TR')
    .replace(/[ıİğüşöçâîû]/g, c => ({ 'ı': 'i', 'İ': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' })[c] ?? c);
}
export const searchExpression = normalized;
// Released snapshots only. No current manuscript/body is transferred in cards.
const cards = `SELECT b.id,coalesce(b.published_data->>'title',b.title) AS title,
  coalesce(b.published_data->>'description','') AS description,
  json_build_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar,'writerBadges',${writerBadgesSql('u.id')}) AS author,
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
export async function discoveryBooks(sortValue: unknown, search: unknown, cursorValue: unknown, categoryValue?: unknown) {
  const sort = String(sortValue ?? 'new') as Sort;
  if (!['new', 'read', 'popular'].includes(sort)) return fail(400, 'Geçersiz sıralama.');
  let category: Category | null = null;
  if (categoryValue !== undefined && categoryValue !== null) {
    if (typeof categoryValue !== 'string' || !Object.hasOwn(CATEGORY_GENRES, categoryValue)) return fail(400, 'Geçersiz kitap kategorisi.');
    category = categoryValue as Category;
  }
  const needle = discoveryNeedle(search);
  let cursor: { a: number; b: number; time: string; id: string; q: string; sort: Sort; category?: Category | null } | null = null;
  if (cursorValue) {
    try {
      if (typeof cursorValue !== 'string' || cursorValue.length > 2048) throw new Error();
      cursor = JSON.parse(Buffer.from(cursorValue, 'base64url').toString());
      if (!cursor || cursor.sort !== sort || cursor.q !== needle || !Number.isSafeInteger(cursor.a) || cursor.a < 0
        || !Number.isSafeInteger(cursor.b) || cursor.b < 0 || typeof cursor.time !== 'string'
        || !Number.isFinite(Date.parse(cursor.time)) || new Date(cursor.time).toISOString() !== cursor.time
        || (cursor.category ?? null) !== category) throw new Error();
      uuid(cursor.id);
    } catch { return fail(400, 'Liste konumu geçersiz. Listeyi yeniden aç.'); }
  }
  const rank = sort === 'read' ? ['"readCount"', '"likeCount"'] : sort === 'popular' ? ['"likeCount"', '"readCount"'] : ['0', '0'];
  const rows = (await pool.query<Rank>(`WITH cards AS (${cards}), ranked AS (
    SELECT *,${rank[0]}::int AS a,${rank[1]}::int AS b FROM cards
    WHERE ${normalized(`title || ' ' || (author->>'nickname') || ' ' || genres::text`)} LIKE $1 ESCAPE '\\'
      AND ($6::text[] IS NULL OR EXISTS(
        SELECT 1 FROM jsonb_array_elements_text(coalesce(genres,'[]'::jsonb)) AS genre_item(genre)
        WHERE genre_item.genre=ANY($6::text[]))))
    SELECT * FROM ranked WHERE ($2::timestamptz IS NULL OR
      (a,b,"publishedAt",id)<($3::int,$4::int,$2::timestamptz,$5::uuid))
    ORDER BY a DESC,b DESC,"publishedAt" DESC,id DESC LIMIT 21`,
  ['%' + needle.replace(/[%_\\]/g, '\\$&') + '%', cursor?.time ?? null, cursor?.a ?? 0, cursor?.b ?? 0, cursor?.id ?? null,
    category ? [...CATEGORY_GENRES[category]] : null])).rows;
  const page = rows.slice(0, 20), last = page.at(-1);
  return { items: page.map(output), nextCursor: rows.length > 20 && last
    ? Buffer.from(JSON.stringify({ a: last.a, b: last.b, time: new Date(last.publishedAt).toISOString(), id: last.id, q: needle, sort, category })).toString('base64url') : null };
}
export async function promotedBooks() {
  await expireBookPromotions();
  const rows = (await pool.query<Rank>(`WITH cards AS (${cards}), active AS (
      SELECT book_id,max(starts_at) AS starts_at
      FROM book_promotion_requests
      WHERE status='active' AND expires_at>clock_timestamp() AND book_id IS NOT NULL
      GROUP BY book_id
    )
    SELECT c.*,0::int AS a,0::int AS b FROM active p JOIN cards c ON c.id=p.book_id
    ORDER BY p.starts_at DESC,c.id DESC`)).rows;
  return rows.map(output);
}
export async function readerReadBooks(readerId: string) {
  const rows = (await pool.query<Rank>(`WITH cards AS (${cards}), recent AS (
    SELECT book_id,max(created_at) AS last_read FROM book_reads WHERE reader_id=$1 GROUP BY book_id
  )
  SELECT c.*,0::int AS a,0::int AS b FROM cards c JOIN recent r ON r.book_id=c.id
  ORDER BY r.last_read DESC,c."publishedAt" DESC,c.id DESC`, [readerId])).rows;
  return rows.map(output);
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
