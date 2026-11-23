import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pool } from '@workspace/db';
import { accounts } from './helpers/accounts.mjs';
import { hashPassword } from '../src/lib/auth-crypto.ts';

if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Development fixtures only');
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
async function cleanup(ids, book) {
  for (const id of ids) assert.match(id, /^af_test_[a-f0-9]{32}$/);
  await pool.query('DELETE FROM social_notifications WHERE recipient_id=ANY($1::text[]) OR actor_id=ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM authored_books WHERE id=$1 AND author_id=ANY($2::text[])', [book, ids]);
  for (const table of ['writer_book_deletions', 'afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts'])
    await pool.query(`DELETE FROM ${table} WHERE ${table === 'writer_book_deletions' ? 'owner_id' : 'user_id'}=ANY($1::text[])`, [ids]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [ids]);
}
try {
  if (process.argv.includes('--cleanup')) {
    const file = process.argv[process.argv.indexOf('--cleanup') + 1];
    assert.match(file ?? '', /^generated-artifacts\/comment-owner-[a-f0-9-]+\.json$/);
    const fixture = JSON.parse(await readFile(new URL('../../../' + file, import.meta.url), 'utf8'));
    await cleanup([fixture.userId, fixture.otherUserId], fixture.bookId);
    await unlink(new URL('../../../' + file, import.meta.url));
    console.log('PASS comment UI fixtures removed');
  } else {
    const users = [], password = `Synthetic-${randomUUID()}`, bookId = randomUUID(), chapterId = randomUUID();
    try {
      for (const name of ['Yorum sahibi', 'Yanıt sahibi']) {
        const email = `comment-owner-${randomUUID()}@example.com`;
        const user = await accounts.users.createUser({ emailAddress: [email], firstName: name });
        users.push({ ...user, email });
        await pool.query('UPDATE afilli_auth_accounts SET password_hash=$2 WHERE user_id=$1', [user.id, await hashPassword(password)]);
        const session = await accounts.sessions.createSession({ userId: user.id });
        users.at(-1).token = (await accounts.sessions.getToken(session.id)).jwt;
      }
      const [author, other] = users;
      const call = async (actor, path, method, body) => {
        const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
          Authorization: `Bearer ${actor.token}`, 'X-Afilli-Actor': actor.id }, body: JSON.stringify(body) });
        const value = await response.json();
        assert.equal(response.status, 200, value.error ?? String(response.status)); return value;
      };
      const document = { title: 'Yorum işlemleri kontrolü', description: 'Geçici geliştirme kontrolü', genres: ['Roman'], ageRating: 'all',
        completion: 'ongoing', language: 'Türkçe', cover: 'preset:forest',
        chapters: [{ id: chapterId, title: 'Kısa bölüm', html: '<p>Yorumları ve yanıtları koruma kontrolü.</p>', status: 'published' }] };
      const saved = await call(author, `/writer-books/${bookId}`, 'PUT', { document, expectedRevision: 0, saveId: randomUUID(), localId: bookId });
      await call(author, `/writer-books/${bookId}/publication`, 'POST', { action: 'publish', expectedRevision: saved.revision });
      const add = (actor, body, parentId = null) => call(actor, `/authored-books/${bookId}/comments`, 'POST', { body, parentId, chapterId, clientId: randomUUID() });
      const parent = await add(author, 'Silinecek üst yorum');
      const reply = await add(other, 'Korunacak yanıt', parent.id);
      const nested = await add(author, 'Korunacak iç yanıt', reply.id);
      const leaf = await add(author, 'Düzenlenecek yorum');
      const file = `generated-artifacts/comment-owner-${randomUUID()}.json`;
      await writeFile(new URL('../../../' + file, import.meta.url), JSON.stringify({
        userId: author.id, otherUserId: other.id, email: author.email, password, bookId,
        parentId: parent.id, replyId: reply.id, nestedId: nested.id, leafId: leaf.id,
      }));
      console.log('BROWSER_FIXTURE=' + file);
    } catch (error) { await cleanup(users.map(user => user.id), bookId); throw error; }
  }
} finally { await pool.end(); }
