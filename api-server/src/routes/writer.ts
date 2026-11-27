import { Router, type IRouter } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { SaveWriterBookBody, PatchWriterBookBody, PatchWriterBookResponse, DeleteWriterBookBody, ChangeWriterPublicationBody, CopyWriterBookBody, SaveAuthoredBookBody,
  SetAuthoredBookLikeBody, AddAuthoredBookCommentBody } from '@workspace/api-zod';
import { route, requirePerson, parse, uuid, fail, viewer, transaction } from '../lib/community';
import { authoredBook, authoredCards, copyWriterBook, librarySummaries, ownWriter, patchWriter, publishWriter, requirePublished, saveWriter, writerRow } from '../lib/writer-service';
import { legacyDocument, writerBook } from '../lib/writer-document';
import { addComment, commentNode, commentScope } from '../lib/book-comments';
import { commentTree } from '../lib/book-comment-query';
import { socialNotify } from '../lib/social';

const router: IRouter = Router();
router.get('/writer-books', route(async (req, res) => res.json(await librarySummaries((await requirePerson(req)).id))));
router.get('/writer-books/:id', route(async (req, res) => res.json(writerBook(await ownWriter(uuid(req.params.id), (await requirePerson(req)).id)))));
router.put('/writer-books/:id', route(async (req, res) => {
  const owner = await requirePerson(req), id = uuid(req.params.id), input = parse(SaveWriterBookBody, req.body);
  res.json(await transaction(db => saveWriter(db, id, owner.id, input)));
}));
router.post('/writer-books/:id/copy', route(async (req, res) => {
  const owner = await requirePerson(req), id = uuid(req.params.id), input = parse(CopyWriterBookBody, req.body);
  res.json(await transaction(db => copyWriterBook(db, id, owner.id, input.clientRequestId)));
}));
router.patch('/writer-books/:id', route(async (req, res) => {
  const owner = await requirePerson(req), id = uuid(req.params.id), input = parse(PatchWriterBookBody, req.body);
  res.json(PatchWriterBookResponse.parse(await transaction(db => patchWriter(db, id, owner.id, input))));
}));
router.post('/writer-books/:id/publication', route(async (req, res) => {
  const owner = await requirePerson(req), id = uuid(req.params.id), input = parse(ChangeWriterPublicationBody, req.body);
  res.json(await transaction(db => publishWriter(db, id, owner.id, input)));
}));
router.delete('/writer-books/:id', route(async (req, res) => {
  const owner = await requirePerson(req), id = uuid(req.params.id), input = parse(DeleteWriterBookBody, req.body);
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`writer-book:${id}`]);
    const existing = (await db.query<{ author_id: string; writer_revision: number }>('SELECT author_id,writer_revision FROM authored_books WHERE id=$1 FOR UPDATE', [id])).rows[0];
    const deleted = (await db.query<{ owner_id: string }>('SELECT owner_id FROM writer_book_deletions WHERE book_id=$1', [id])).rows[0];
    if ((existing && existing.author_id !== owner.id) || (deleted && deleted.owner_id !== owner.id)) return fail(404, 'Kitap bulunamadı.');
    if (existing && existing.writer_revision !== input.expectedRevision) return fail(409, 'Kitap başka bir cihazda değişti. Yeniden yükleyip silme işlemini doğrula.');
    await db.query('INSERT INTO writer_book_deletions(book_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, owner.id]);
    // Preserve bulletin text, comments and reactions even for book-only posts.
    await db.query(`UPDATE bulletins SET book_id=NULL,
      body=CASE WHEN length(trim(body))=0 AND cardinality(photo_ids)=0 THEN 'Yazar paylaştığı kitabı kaldırdı.' ELSE body END
      WHERE book_id=$1`, [id]);
    await db.query('DELETE FROM authored_books WHERE id=$1', [id]);
  });
  res.status(204).end();
}));
router.get('/authored-books', route(async (req, res) => {
  res.json(await authoredCards((await requirePerson(req)).id));
}));
// Backward compatibility for older clients. This saves privately and CANNOT publish.
router.post('/authored-books', route(async (req, res) => {
  const owner = await requirePerson(req), input = parse(SaveAuthoredBookBody, req.body);
  if (!input.title.trim() || input.title.length > 100 || input.localId.length > 200) return fail(400, 'Kitap adı yaz. En fazla 100 karakter kullan.');
  const id = await transaction(async db => {
    const prior = await db.query<{ id: string }>('SELECT id FROM authored_books WHERE author_id=$1 AND local_id=$2', [owner.id, input.localId]);
    const bookId = prior.rows[0]?.id ?? randomUUID();
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`writer-book:${bookId}`]);
    if (!prior.rowCount) await db.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,created_at) VALUES($1,$2,$3,'','',now()) ON CONFLICT DO NOTHING`,
      [bookId, owner.id, input.localId]);
    const row = await ownWriter(bookId, owner.id, db, true);
    if (row.writer_data) return fail(409, 'Bu kitabı bölümlü Kitap Yaz editöründen düzenle. Mevcut sürümün korunuyor.');
    const document = legacyDocument({ ...row, title: input.title, body: input.body });
    await saveWriter(db, bookId, owner.id, { document, expectedRevision: row.writer_revision, saveId: randomUUID(), localId: input.localId });
    return bookId;
  });
  res.json(await authoredBook(id, owner.id));
}));
router.get('/authored-books/:id', route(async (req, res) => {
  const id = uuid(req.params.id), who = viewer(req);
  const book = await authoredBook(id, who);
  if (who && !book.canEdit) {
    const reader = await requirePerson(req);
    await pool.query(`INSERT INTO book_reads(book_id,reader_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, reader.id]);
    res.json(await authoredBook(id, who)); return;
  }
  res.json(book);
}));
router.get('/published-books', route(async (req, res) => {
  // Feed cards never expose unpublished changes, even to the author.
  res.json(await authoredCards(null));
}));
router.put('/authored-books/:id/like', route(async (req, res) => {
  const owner = await requirePerson(req), id = uuid(req.params.id), input = parse(SetAuthoredBookLikeBody, req.body);
  await transaction(async db => {
    const book = await writerRow(id, db, true); await requirePublished(id, db);
    if (input.liked) {
      const inserted = await db.query('INSERT INTO writer_likes(book_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING book_id', [id, owner.id]);
      if (inserted.rowCount) await socialNotify(db, book.author_id, owner.id, 'book_like', `book_like:${id}:${owner.id}`, null, id);
    }
    else await db.query('DELETE FROM writer_likes WHERE book_id=$1 AND user_id=$2', [id, owner.id]);
  });
  res.json(await authoredBook(id, owner.id));
}));
router.get('/authored-books/:id/comments', route(async (req, res) => {
  const scope = await commentScope(uuid(req.params.id));
  const rows = await pool.query<{ id: string }>(`WITH RECURSIVE ${commentTree()}
    SELECT n.id FROM visible_comment_nodes n JOIN writer_comments c ON c.id=n.id
    ORDER BY n.created_at DESC,n.id DESC LIMIT 100`, [scope.id, scope.chapters]);
  res.json(await Promise.all(rows.rows.map(row => commentNode(row.id, viewer(req), pool, scope))));
}));
router.post('/authored-books/:id/comments', route(async (req, res) => {
  const person = await requirePerson(req), id = uuid(req.params.id), input = parse(AddAuthoredBookCommentBody, req.body);
  res.json(await transaction(db => addComment(db, id, person.id, input)));
}));
export default router;
