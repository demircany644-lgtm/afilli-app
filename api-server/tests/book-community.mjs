import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Synthetic development fixtures only');
const tag = randomUUID().replaceAll('-', ''), base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const users = ['author', 'reader', 'other', 'follower'].map(x => `af_comments_${tag}_${x}`);
const [author, reader, other, follower] = users, book = randomUUID(), hidden = randomUUID(), draft = randomUUID();
const chapter = randomUUID(), next = randomUUID(), secret = randomUUID(), password = `Synthetic ${randomUUID()}`;
const document = { title: `Yorum denetimi ${tag}`, description: 'Synthetic discussion',
  cover: 'preset:paper', genres: ['Roman'], ageRating: 'all', completion: 'ongoing', language: 'Türkçe',
  chapters: [{ id: chapter, title: 'İlk bölüm', html: '<p>Yayımlanmış ilk bölüm.</p>', status: 'published' }] };
let checks = 0;
async function api(path, token = null, method = 'GET', data, expected = 200, extra = {}) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`); checks++;
  return expected === 204 ? null : response.json();
}
const comment = (token, body, parentId = null, chapterId = chapter, clientId = randomUUID(), expected = 200, targetBook = book) =>
  api(`/authored-books/${targetBook}/comments`, token, 'POST', { body, parentId, chapterId, clientId }, expected);
const inbox = token => api('/book-notifications', token);
try {
  const hash = await hashPassword(password);
  for (const [i, id] of users.entries()) {
    await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `YorumDenetim${i}-${tag}`]);
    await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)', [id, `comment-${i}-${tag}@example.com`, hash]);
  }
  for (const id of [book, hidden, draft]) await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,
    writer_data,published_data,publication,published_at,writer_revision,moderation_hidden)
    VALUES($1::uuid,$2,$1::text,$3,'',$4,$5,$6,now(),1,$7)`,
    [id, author, document.title, document, id === draft ? null : document, id === draft ? 'draft' : 'published', id === hidden]);
  const sessions = [];
  for (let i = 0; i < users.length; i++) sessions.push(await api('/auth/login', null, 'POST', { email: `comment-${i}-${tag}@example.com`, password }));
  const [a, r, o, f] = sessions.map(s => s.token);
  await api(`/authored-books/${book}/comments`, null, 'POST', { clientId: randomUUID(), body: 'No' }, 401);
  await comment(r, 'Private', null, chapter, randomUUID(), 404, hidden);
  await comment(a, 'Private', null, chapter, randomUUID(), 404, draft);
  await comment(r, 'Private chapter', null, secret, randomUUID(), 404);
  await comment(r, '   ', null, chapter, randomUUID(), 400);
  const clientId = randomUUID(), root = await comment(r, 'Kök yorum', null, chapter, clientId);
  assert.equal(root.bookId, book);
  assert.equal(root.parentId, null); assert.equal(root.deleted, false);
  assert.equal((await comment(r, 'Kök yorum', null, chapter, clientId)).id, root.id);
  await comment(r, 'Farklı metin', null, chapter, clientId, 409);
  let notifications = await inbox(a);
  assert.equal(notifications.unreadCount, 1); assert.equal(notifications.items.length, 1);
  assert.equal(notifications.items[0].kind, 'book_comment'); assert.equal(notifications.items[0].commentId, root.id);
  await api(`/book-notifications/${notifications.items[0].id}`, o, 'PATCH', undefined, 404);
  await api(`/book-notifications/${notifications.items[0].id}`, a, 'PATCH', undefined, 204);
  await comment(r, 'Kök yorum', null, chapter, clientId);
  assert.equal((await inbox(a)).unreadCount, 0); // retry must not unread/reset an existing event
  const replyClient = randomUUID(), reply = await comment(o, 'İlk yanıt', root.id, chapter, replyClient);
  const nested = await comment(a, 'İç içe yanıt', reply.id, null);
  assert.equal(nested.chapterId, chapter);
  assert.equal((await inbox(r)).items[0].kind, 'comment_reply');
  assert.equal((await inbox(o)).items[0].commentId, nested.id);
  assert.equal((await inbox(a)).items.length, 1); // replies don't also spam the author
  const self = await comment(r, 'Kendi yorumuma yanıt', root.id);
  assert.equal((await inbox(r)).items.length, 1); // no self-notification
  assert.deepEqual((await api(`/writer-comments/${nested.id}/path`, r)).map(c => c.id), [root.id, reply.id, nested.id]);
  assert.equal((await api(`/writer-comments/${root.id}/replies`, r)).items.length, 2);
  await comment(o, 'Wrong chapter', root.id, secret, randomUUID(), 400);
  const elsewhere = (await pool.query(`INSERT INTO writer_comments(book_id,author_id,client_id,body)
    VALUES($1,$2,$3,'Hidden book parent') RETURNING id`, [hidden, reader, randomUUID()])).rows[0].id;
  await comment(o, 'Cross-book', elsewhere, null, randomUUID(), 404);
  const react = (token, reaction, expected = 200, id = root.id) => api(`/writer-comments/${id}/reaction`, token, 'PUT', { reaction }, expected);
  await react(null, 'like', 401);
  let reacted = await react(o, 'like');
  assert.deepEqual(reacted.reactions, [{ reaction: 'like', count: 1, selected: true }, { reaction: 'love', count: 0, selected: false }]);
  await react(o, 'like'); assert.equal((await react(o, 'love')).reactions.find(x => x.reaction === 'love').count, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM writer_comment_reactions WHERE comment_id=$1 AND user_id=$2', [root.id, other])).rows[0].n, 1);
  await react(a, 'like');
  reacted = await react(o, null); assert.equal(reacted.reactions.find(x => x.reaction === 'love').count, 0);
  assert.equal(reacted.reactions.find(x => x.reaction === 'like').count, 1);
  await react(o, 'not-supported', 400);
  await api(`/writer-comments/${root.id}/reaction`, r, 'PUT', { reaction: 'love' }, 401, { 'X-Afilli-Actor': other });
  await api(`/authored-books/${book}/comment-threads`, r, 'GET', undefined, 401, { 'X-Afilli-Actor': other });
  await api(`/writer-comments/${root.id}/path`, r, 'GET', undefined, 401, { 'X-Afilli-Actor': other });
  assert.equal((await inbox(a)).items.length, 1); // reactions create no notifications

  // A hidden ancestor suppresses every descendant and its notification/read badge.
  await pool.query('UPDATE writer_comments SET moderation_hidden=true WHERE id=$1', [root.id]);
  assert.equal((await api(`/authored-books/${book}/comment-threads`, r)).items.length, 0);
  await api(`/writer-comments/${nested.id}/path`, r, 'GET', undefined, 404);
  await comment(o, 'Hidden parent', reply.id, chapter, randomUUID(), 404);
  await react(o, 'like', 404, nested.id);
  await api(`/writer-comments/${nested.id}`, a, 'PATCH', { body: 'Hidden ancestor edit' }, 404);
  await api(`/writer-comments/${reply.id}`, o, 'DELETE', undefined, 404);
  assert.equal((await inbox(r)).unreadCount, 0); assert.equal((await inbox(a)).items.length, 0);
  assert.equal((await api(`/authored-books/${book}`, r)).commentCount, 0);
  assert.equal((await api('/discovery/book-cards?' + new URLSearchParams({ ids: book }), r))[0].commentCount, 0);
  await pool.query('UPDATE writer_comments SET moderation_hidden=false WHERE id=$1', [root.id]);

  // Author-only editing preserves the thread, chapter, reactions and chronology.
  await api(`/writer-comments/${root.id}`, null, 'PATCH', { body: 'No' }, 401);
  await api(`/writer-comments/${root.id}`, null, 'DELETE', undefined, 401);
  for (const token of [a, o]) {
    await api(`/writer-comments/${root.id}`, token, 'PATCH', { body: 'Not mine' }, 403);
    await api(`/writer-comments/${root.id}`, token, 'DELETE', undefined, 403);
  }
  for (const body of ['', '   ', 'x'.repeat(3001)]) await api(`/writer-comments/${root.id}`, r, 'PATCH', { body }, 400);
  await api(`/writer-comments/${elsewhere}`, r, 'PATCH', { body: 'Hidden book edit' }, 404);
  await api(`/writer-comments/${root.id}`, r, 'PATCH', { body: 'Spoofed' }, 401, { 'X-Afilli-Actor': other });
  const edited = await api(`/writer-comments/${root.id}`, r, 'PATCH', { body: '  Düzenlenen yorum  ', authorId: other, parentId: nested.id });
  assert.equal(edited.body, 'Düzenlenen yorum');
  assert.equal(edited.author.id, reader); assert.equal(edited.createdAt, root.createdAt);
  assert.equal(edited.chapterId, chapter); assert.equal(edited.parentId, null); assert.equal(edited.replyCount, 2);
  assert.equal(edited.reactions.find(x => x.reaction === 'like').count, 1);
  assert.equal((await api(`/writer-comments/${nested.id}/path`, r))[0].body, 'Düzenlenen yorum');

  // A leaf disappears entirely; deleting a parent preserves anonymous structure and others' text.
  const leaf = await comment(r, 'Çocuksuz yorum');
  assert.equal((await api(`/writer-comments/${leaf.id}`, r, 'DELETE')).replyCount, 0);
  assert.ok(!(await api(`/authored-books/${book}/comment-threads`, r)).items.some(c => c.id === leaf.id));
  await api(`/writer-comments/${leaf.id}/path`, r, 'GET', undefined, 404);
  const removed = await api(`/writer-comments/${root.id}`, r, 'DELETE');
  assert.equal(removed.deleted, true); assert.equal(removed.body, ''); assert.equal(removed.replyCount, 2);
  assert.deepEqual(removed.author, { id: 'deleted', nickname: '', avatar: null });
  assert.ok(removed.reactions.every(reaction => reaction.count === 0 && !reaction.selected));
  assert.equal((await pool.query('SELECT id FROM writer_comments WHERE id=$1', [root.id])).rowCount, 0);
  assert.equal((await pool.query('SELECT id FROM writer_comment_nodes WHERE id=$1', [root.id])).rowCount, 1);
  assert.equal((await pool.query('SELECT id FROM writer_comments WHERE id=ANY($1::uuid[])', [[reply.id, nested.id, self.id]])).rowCount, 3);
  const ghost = (await api(`/authored-books/${book}/comment-threads`, r)).items[0];
  assert.equal(ghost.id, root.id); assert.equal(ghost.deleted, true); assert.equal(ghost.replyCount, 2);
  assert.ok(!JSON.stringify(ghost).includes('Kök yorum')); assert.equal(ghost.author.id, 'deleted');
  assert.equal((await api(`/writer-comments/${root.id}/replies`, r)).items.length, 2);
  await comment(o, 'Deleted parent', root.id, chapter, randomUUID(), 404);
  await react(o, 'like', 404);
  assert.equal((await comment(o, 'İlk yanıt', root.id, chapter, replyClient)).id, reply.id); // retry survives parent deletion
  assert.equal((await api(`/writer-comments/${nested.id}/path`, r))[0].deleted, true);

  // Paging never truncates a discussion to the historical last 100.
  for (let i = 0; i < 45; i++) await pool.query(`INSERT INTO writer_comments(book_id,author_id,client_id,chapter_id,body)
    VALUES($1,$2,$3,$4,$5)`, [book, reader, randomUUID(), chapter, `Page root ${i}`]);
  // Preserve PostgreSQL microseconds in cursors, including rows in one JS millisecond.
  await pool.query(`UPDATE writer_comment_nodes n SET created_at='2026-01-01T00:00:00.123456Z'::timestamptz+
    substring(c.body from 11)::integer*interval '1 microsecond' FROM writer_comments c
    WHERE c.id=n.id AND c.book_id=$1 AND c.body LIKE 'Page root %'`, [book]);
  const seen = []; let cursor = null;
  do {
    const page = await api(`/authored-books/${book}/comment-threads` + (cursor ? '?' + new URLSearchParams({ cursor }) : ''), r);
    seen.push(...page.items.map(x => x.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 46); assert.equal(new Set(seen).size, 46);
  await api(`/authored-books/${book}/comment-threads?cursor=bad`, r, 'GET', undefined, 400);
  await pool.query(`INSERT INTO social_notifications(recipient_id,actor_id,kind,event_key,book_id,comment_id,chapter_id,created_at)
    SELECT $1,$2,'book_comment','synthetic:'||c.id,c.book_id,c.id,c.chapter_id,n.created_at FROM writer_comments c
    JOIN writer_comment_nodes n ON n.id=c.id WHERE c.book_id=$3 AND c.body LIKE 'Page root %'`, [author, reader, book]);
  const notificationIds = []; cursor = null;
  do {
    const page = await api('/book-notifications' + (cursor ? '?' + new URLSearchParams({ cursor }) : ''), a);
    notificationIds.push(...page.items.map(x => x.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(notificationIds.length, 45); assert.equal(new Set(notificationIds).size, 45);
  await pool.query('UPDATE social_notifications SET read=true WHERE id=ANY($1::uuid[])', [notificationIds.slice(0, 30)]);
  assert.equal((await inbox(a)).unreadCount, 15); // older-page unread still lights the shared badge

  // Following, book reactions, bulletin activity and private messages do not
  // enter the book inbox; DM unread remains separately authoritative.
  await api(`/profiles/${author}/follow`, f, 'PUT', { following: true });
  await api(`/authored-books/${book}/like`, r, 'PUT', { liked: true });
  const thread = await api('/conversations', r, 'POST', { peerId: author });
  await api(`/conversations/${thread.id}/messages`, r, 'POST', { clientId: randomUUID(), body: 'Private test message' }, 201);
  assert.equal((await api('/conversations', a)).find(t => t.id === thread.id).unreadCount, 1);
  await pool.query(`INSERT INTO social_notifications(recipient_id,actor_id,kind,event_key,book_id)
    VALUES($1,$2,'follow',$3,$4),($1,$2,'message',$5,$4),($1,$2,'publication',$6,$4)`,
  [author, other, 'old-follow-'+tag, book, 'old-message-'+tag, 'old-publication-'+tag]);
  assert.ok((await api('/social-notifications', a)).every(n => ['chapter','book_comment','comment_reply'].includes(n.kind)));
  assert.deepEqual(await api('/bulletin-notifications', a), []);

  // Subscription merge is additive and scoped. No follower-only notifications.
  await api('/book-subscriptions', r, 'POST', { bookIds: [book, hidden, draft, randomUUID()] }, 204);
  assert.deepEqual((await pool.query('SELECT book_id FROM book_subscriptions WHERE user_id=$1', [reader])).rows.map(x => x.book_id), [book]);
  await api(`/authored-books/${book}/saved`, r, 'PUT', { saved: true }, 204);
  await api(`/authored-books/${book}/saved`, a, 'PUT', { saved: true }, 204);
  let doc = { ...document, chapters: [...document.chapters, { id: next, title: 'Yeni bölüm', html: '<p>Henüz taslak bölüm.</p>', status: 'draft' }] };
  const save = async () => {
    const before = await api(`/writer-books/${book}`, a);
    return api(`/writer-books/${book}`, a, 'PUT', { document: doc, expectedRevision: before.revision, saveId: randomUUID(), localId: book });
  };
  const publish = async (action = 'publishChapter', chapterId = next) => {
    const before = await api(`/writer-books/${book}`, a);
    return api(`/writer-books/${book}/publication`, a, 'POST', { action, chapterId, expectedRevision: before.revision });
  };
  const chapterEvents = async token => (await inbox(token)).items.filter(n => n.kind === 'chapter');
  await save(); assert.equal((await chapterEvents(r)).length, 0);
  await publish();
  let events = await chapterEvents(r);
  assert.equal(events.length, 1); assert.equal(events[0].chapterId, next);
  assert.equal((await chapterEvents(a)).length, 0); assert.equal((await chapterEvents(f)).length, 0);
  await api(`/book-notifications/${events[0].id}`, r, 'PATCH', undefined, 204);
  doc = { ...doc, chapters: doc.chapters.map(c => c.id === next ? { ...c, status: 'published', html: '<p>Yalnızca mevcut bölüm metni düzenlendi.</p>' } : c) };
  await save(); // editing a published chapter's draft still isn't a new chapter
  await publish(); // same chapter edit/retry, no duplicate and remains read
  await publish('draftChapter'); await publish(); // same chapter re-release isn't new
  events = await chapterEvents(r); assert.equal(events.length, 1); assert.equal(events[0].read, true);
  await api(`/authored-books/${book}/saved`, r, 'PUT', { saved: false }, 204);
  await api('/book-subscriptions', o, 'POST', { bookIds: [book] }, 204);
  const third = randomUUID();
  doc = { ...doc, chapters: [...doc.chapters.map(c => ({ ...c, status: 'published' })), { id: third, title: 'Sonraki bölüm', html: '<p>Yeni bölüm üç.</p>', status: 'draft' }] };
  await save(); await publish('publishChapter', third);
  assert.equal((await chapterEvents(r)).length, 1); assert.equal((await chapterEvents(o)).length, 1);
  assert.equal((await chapterEvents(f)).length, 0);
  await pool.query('UPDATE authored_books SET moderation_hidden=true WHERE id=$1', [book]);
  assert.equal((await inbox(o)).unreadCount, 0);
  await api(`/writer-comments/${reply.id}/replies`, o, 'GET', undefined, 404);
  await api(`/authored-books/${book}/saved`, r, 'PUT', { saved: false }, 204); // unavailable book may be removed
  await api(`/authored-books/${book}/saved`, r, 'PUT', { saved: true }, 404);
  await api('/book-notifications', null, 'GET', undefined, 401);
  await api('/book-subscriptions', null, 'POST', { bookIds: [book] }, 401);
} finally {
  await pool.query('DELETE FROM social_notifications WHERE recipient_id=ANY($1::text[]) OR actor_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM conversations WHERE user_low=ANY($1::text[]) OR user_high=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM profile_follows WHERE follower_id=ANY($1::text[]) OR followed_id=ANY($1::text[])', [users]);
  for (const table of ['writer_likes','book_reads']) await pool.query(`DELETE FROM ${table} WHERE book_id=ANY($1::uuid[])`, [[book, hidden, draft]]);
  await pool.query('DELETE FROM authored_books WHERE id=ANY($1::uuid[])', [[book, hidden, draft]]);
  for (const table of ['afilli_auth_codes','afilli_auth_sessions','afilli_auth_accounts']) await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [users]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [users]);
  await pool.end();
}
console.log(`PASS ${checks} book discussion/subscription/notification API checks; fixtures removed.`);
