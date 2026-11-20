import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { SetBookSubscriptionBody, SubscribeSavedBooksBody, SetWriterCommentReactionBody } from '@workspace/api-zod';
import { route, requirePerson, parse, uuid, viewer, transaction, fail } from '../lib/community';
import { commentNode, commentScope, commentPage, commentPath } from '../lib/book-comments';
import { publicBook } from '../lib/book-access';
import { bookNotifications, readBookNotification } from '../lib/book-notifications';

const router: IRouter = Router();
router.get('/authored-books/:id/comment-threads', route(async (req, res) => {
  res.json(await commentPage(await commentScope(uuid(req.params.id)), viewer(req), null, req.query.cursor));
}));
router.get('/writer-comments/:id/path', route(async (req, res) => {
  res.json(await commentPath(uuid(req.params.id), viewer(req)));
}));
router.get('/writer-comments/:id/replies', route(async (req, res) => {
  const id = uuid(req.params.id);
  const node = await commentNode(id, viewer(req));
  const book = (await pool.query<{ book_id: string }>('SELECT book_id FROM writer_comment_nodes WHERE id=$1', [node.id])).rows[0];
  res.json(await commentPage(await commentScope(book.book_id), viewer(req), id, req.query.cursor));
}));
router.put('/writer-comments/:id/reaction', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(SetWriterCommentReactionBody, req.body);
  res.json(await transaction(async db => {
    const book = (await db.query<{ book_id: string }>('SELECT book_id FROM writer_comment_nodes WHERE id=$1', [id])).rows[0];
    if (!book) return fail(404, 'Yorum bulunamadı.');
    const scope = await commentScope(book.book_id, db, true), node = await commentNode(id, actor.id, db, scope);
    if (node.deleted) return fail(404, 'Kaldırılmış yoruma tepki verilemez.');
    const locked = await db.query('SELECT id FROM writer_comments WHERE id=$1 AND NOT moderation_hidden FOR UPDATE', [id]);
    if (!locked.rowCount) return fail(404, 'Yorum artık erişilemiyor.');
    if (input.reaction === null) await db.query('DELETE FROM writer_comment_reactions WHERE comment_id=$1 AND user_id=$2', [id, actor.id]);
    else await db.query(`INSERT INTO writer_comment_reactions(comment_id,user_id,reaction) VALUES($1,$2,$3)
      ON CONFLICT(comment_id,user_id) DO UPDATE SET reaction=excluded.reaction`, [id, actor.id, input.reaction]);
    return commentNode(id, actor.id, db, scope);
  }));
}));
router.post('/book-subscriptions', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(SubscribeSavedBooksBody, req.body);
  // Lock visible book rows as well: publication/deletion cannot race the merge.
  await transaction(async db => {
    await db.query(`INSERT INTO book_subscriptions(book_id,user_id) SELECT b.id,$1 FROM authored_books b
      WHERE b.id=ANY($2::uuid[]) AND ${publicBook()} FOR SHARE OF b ON CONFLICT DO NOTHING`, [actor.id, input.bookIds]);
  });
  res.status(204).end();
}));
router.put('/authored-books/:id/saved', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(SetBookSubscriptionBody, req.body);
  await transaction(async db => {
    if (input.saved) {
      await commentScope(id, db, true);
      await db.query('INSERT INTO book_subscriptions(book_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, actor.id]);
    } else await db.query('DELETE FROM book_subscriptions WHERE book_id=$1 AND user_id=$2', [id, actor.id]);
  });
  res.status(204).end();
}));
router.get('/book-notifications', route(async (req, res) => {
  res.json(await bookNotifications((await requirePerson(req)).id, req.query.cursor));
}));
router.patch('/book-notifications/:id', route(async (req, res) => {
  await readBookNotification((await requirePerson(req)).id, uuid(req.params.id));
  res.status(204).end();
}));
export default router;
