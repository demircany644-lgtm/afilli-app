import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { SetReadingPositionBody, GetReadingPositionResponse, SetReadingPositionResponse } from '@workspace/api-zod';
import { route, uuid, requirePerson, parse, fail, transaction } from '../lib/community';
import { bookCards, discoveryBooks } from '../lib/discovery';
import { writerRow, requirePublished } from '../lib/writer-service';
import { legacyDocument } from '../lib/writer-document';

const router: IRouter = Router();
router.get('/discovery/books', route(async (req, res) => res.json(await discoveryBooks(req.query.sort, req.query.search, req.query.cursor))));
router.get('/discovery/book-cards', route(async (req, res) => res.json(await bookCards(req.query.ids))));
router.get('/authored-books/:id/reading-position', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  const row = await writerRow(id, pool); await requirePublished(id);
  const chapters = (row.published_data ?? legacyDocument(row)).chapters.filter(c => c.status === 'published');
  const saved = (await pool.query<{ chapter_id: string }>('SELECT chapter_id FROM book_reading_positions WHERE reader_id=$1 AND book_id=$2', [actor.id, id])).rows[0]?.chapter_id;
  const present = !!saved && chapters.some(c => c.id === saved);
  res.json(GetReadingPositionResponse.parse({
    chapterId: present ? saved : chapters[0]?.id ?? null, resumed: present, chapterMissing: !!saved && !present,
  }));
}));
router.put('/authored-books/:id/reading-position', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(SetReadingPositionBody, req.body);
  await transaction(async db => {
    const row = await writerRow(id, db, true); await requirePublished(id, db);
    const chapters = (row.published_data ?? legacyDocument(row)).chapters.filter(c => c.status === 'published');
    if (!chapters.some(c => c.id === input.chapterId)) return fail(404, 'Bu bölüm artık okunabilir değil. Bölüm listesini yeniden aç.');
    if (row.author_id !== actor.id) await db.query('INSERT INTO book_reads(book_id,reader_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, actor.id]);
    await db.query(`INSERT INTO book_reading_positions(reader_id,book_id,chapter_id) VALUES($1,$2,$3)
      ON CONFLICT(reader_id,book_id) DO UPDATE SET chapter_id=excluded.chapter_id,updated_at=now()`, [actor.id, id, input.chapterId]);
  });
  res.json(SetReadingPositionResponse.parse({ chapterId: input.chapterId, resumed: true, chapterMissing: false }));
}));
export default router;
