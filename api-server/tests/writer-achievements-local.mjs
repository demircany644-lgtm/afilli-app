import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { writerBadgesSql } from '../src/lib/writer-achievements.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Development tests only');
const marker = randomUUID().replaceAll('-', '');
const authorId = `badge_author_${marker}`;
const readerPrefix = `badge_reader_${marker}_`;
const readerIds = Array.from({ length: 50_010 }, (_, i) => `${readerPrefix}${i + 1}`);
const rivalIds = Array.from({ length: 10 }, (_, i) => `badge_rival_${marker}_${i + 1}`);
const bookIds = Array.from({ length: 13 }, () => randomUUID());

async function badgeKeys() {
  const result = await pool.query(`SELECT ${writerBadgesSql('$1')} AS badges`, [authorId]);
  return result.rows[0].badges;
}

try {
  await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [authorId, 'Yazar test']);
  await pool.query(`INSERT INTO community_users(id,nickname)
    SELECT $1||i::text,'Okur test' FROM generate_series(1,50010) i`, [readerPrefix]);
  await pool.query(`INSERT INTO community_users(id,nickname)
    SELECT id,'Rakip test' FROM unnest($1::text[]) AS id`, [rivalIds]);
  await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,publication,created_at)
    SELECT id,$1,id::text,'Rozet testi','', 'published',now()
    FROM unnest($2::uuid[]) AS id`, [authorId, bookIds.slice(0, 3)]);
  await pool.query(`INSERT INTO book_reads(book_id,reader_id,day,created_at)
    SELECT $1::uuid,$2||i::text,CURRENT_DATE,now() FROM generate_series(1,25000) i
    UNION ALL
    SELECT $3::uuid,$2||i::text,CURRENT_DATE,now() FROM generate_series(25001,40000) i
    UNION ALL
    SELECT $4::uuid,$2||i::text,CURRENT_DATE,now() FROM generate_series(40001,50000) i`,
  [bookIds[0], readerPrefix, bookIds[1], bookIds[2]]);

  assert.deepEqual((await badgeKeys()).sort(), ['master', 'popular', 'successful']);
  await pool.query("UPDATE book_reads SET created_at=now()-interval '31 days' WHERE book_id=ANY($1::uuid[])", [bookIds.slice(0, 3)]);
  assert.deepEqual((await badgeKeys()).sort(), ['master', 'successful']);
  await pool.query('UPDATE book_reads SET created_at=now() WHERE book_id=$1 AND reader_id=$2', [bookIds[0], readerIds[0]]);
  assert.deepEqual((await badgeKeys()).sort(), ['master', 'popular', 'successful']);

  await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,publication,created_at)
    SELECT b.id,r.id,b.id::text,'Rakip kitap','', 'published',now()
    FROM unnest($1::uuid[]) WITH ORDINALITY b(id,ord)
    JOIN unnest($2::text[]) WITH ORDINALITY r(id,ord) USING(ord)`, [bookIds.slice(3), rivalIds]);
  await pool.query(`INSERT INTO book_reads(book_id,reader_id,day,created_at)
    SELECT b.id,readerPrefix.id,CURRENT_DATE,now()
    FROM unnest($1::uuid[]) WITH ORDINALITY b(id,ord)
    JOIN unnest($2::text[]) WITH ORDINALITY readerPrefix(id,ord) ON true
    WHERE readerPrefix.ord<=2`, [bookIds.slice(3), readerIds.slice(0, 2)]);
  assert.deepEqual((await badgeKeys()).sort(), ['master', 'successful']);

  await pool.query("UPDATE authored_books SET publication='draft' WHERE id=$1", [bookIds[2]]);
  assert.deepEqual((await badgeKeys()).sort(), ['successful']);
  await pool.query(`DELETE FROM book_reads WHERE ctid IN (
      SELECT ctid FROM book_reads WHERE book_id=ANY($1::uuid[]) LIMIT 30001
    )`, [bookIds.slice(0, 2)]);
  assert.deepEqual(await badgeKeys(), []);
  console.log('PASS writer badge thresholds, 30-day expiry, rolling top-10 ranking, and eligibility removal.');
} finally {
  await pool.query('DELETE FROM book_reads WHERE book_id=ANY($1::uuid[]) OR reader_id=ANY($2::text[])', [bookIds, readerIds]);
  await pool.query('DELETE FROM authored_books WHERE id=ANY($1::uuid[])', [bookIds]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [[authorId, ...readerIds, ...rivalIds]]);
  await pool.end();
}
