import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pool } from '@workspace/db';
import { accounts } from './helpers/accounts.mjs';
import { hashPassword } from '../src/lib/auth-crypto.ts';

if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Development fixtures only');
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const actors = [];
let retained = null;
async function cleanup(userId) {
  assert.match(userId, /^af_test_[a-f0-9]{32}$/);
  await pool.query('DELETE FROM authored_books WHERE author_id=$1', [userId]);
  await pool.query('DELETE FROM writer_book_deletions WHERE owner_id=$1', [userId]);
  for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts'])
    await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
  await pool.query('DELETE FROM community_users WHERE id=$1', [userId]);
}
const cleanupIndex = process.argv.indexOf('--cleanup-fixture');
if (cleanupIndex !== -1) {
  const file = process.argv[cleanupIndex + 1];
  assert.match(file ?? '', /^generated-artifacts\/writer-management-[a-f0-9-]+\.json$/);
  const fixture = JSON.parse(await readFile(new URL('../../../' + file, import.meta.url), 'utf8'));
  try { await cleanup(fixture.userId); await unlink(new URL('../../../' + file, import.meta.url)); console.log('PASS synthetic browser fixture removed'); }
  finally { await pool.end(); }
} else {
  async function actor() {
    const email = `writer-management-${randomUUID()}@example.com`;
    const { id } = await accounts.users.createUser({ emailAddress: [email], firstName: 'Yazarlık kontrolü' });
    const entry = { id, email }; actors.push(entry);
    const session = await accounts.sessions.createSession({ userId: id });
    entry.token = (await accounts.sessions.getToken(session.id)).jwt;
    return entry;
  }
  let checks = 0;
  async function api(who, path, method = 'GET', body, expected = 200, extra = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
      ...(who ? { Authorization: `Bearer ${who.token}`, 'X-Afilli-Actor': who.id } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value = response.status === 204 ? null : await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${value?.error ?? response.status}`);
    checks++;
    return value;
  }
  try {
    const a = await actor(), b = await actor();
    const id = randomUUID(), path = `/writer-books/${id}`;
    const document = { title: 'Yazarlık 201 bölüm kontrolü', description: 'Sadece geliştirme testi', genres: ['Roman'], ageRating: 'all',
      language: 'Türkçe', completion: 'ongoing', cover: null,
      chapters: Array.from({ length: 201 }, (_, index) => ({ id: randomUUID(), title: `Bölüm ${index + 1}`, html: `<p>Korunan metin ${index + 1}</p>`, status: 'draft' })) };
    const save = (who, doc, revision, expected = 200) => api(who, path, 'PUT', { document: doc, expectedRevision: revision, saveId: randomUUID(), localId: id }, expected);
    const patch = (who, revision, delta, expected = 200) => api(who, path, 'PATCH', { expectedRevision: revision, saveId: randomUUID(),
      upserts: [], deletedChapterIds: [], ...delta }, expected);
    await api(null, '/writer-books', 'GET', undefined, 401);
    let book = await save(a, document, 0);
    assert.equal(book.document.chapters.length, 201);
    assert.deepEqual((await api(a, path)).document, document);
    assert.equal((await api(a, '/writer-books')).find(item => item.id === id).chapterCount, 201);
    await api(b, path, 'GET', undefined, 404);
    await save(b, document, book.revision, 404);
    await patch(b, book.revision, { upserts: [document.chapters[0]] }, 404);
    await api(b, path, 'DELETE', { expectedRevision: book.revision }, 404);
    await api(b, path, 'GET', undefined, 401, { 'X-Afilli-Actor': a.id });
    assert.deepEqual((await api(a, path)).document, document);
    console.log('PASS 201-chapter full save, reopen, own library and denied cross-account reads/writes/deletion');

    const changed = document.chapters.map(ch => ({ ...ch, html: ch.html + '<p>Yeni metin</p>' })).reverse();
    let receipt = await patch(a, book.revision, { upserts: changed, chapterOrder: changed.map(ch => ch.id) });
    book = await api(a, path);
    assert.equal(book.revision, receipt.revision);
    assert.deepEqual(book.document.chapters, changed);
    const extra = { id: randomUUID(), title: 'Bölüm 202', html: '<p>Son bölüm de saklanır.</p>', status: 'draft' };
    const order = [...changed.map(ch => ch.id), extra.id];
    receipt = await patch(a, book.revision, { upserts: [extra], chapterOrder: order });
    book = await api(a, path);
    assert.equal(book.document.chapters.length, 202);
    assert.deepEqual(book.document.chapters.map(ch => ch.id), order);
    const snapshot = book.document;
    await patch(a, book.revision, { chapterOrder: order.slice(1) }, 400);
    await patch(a, book.revision, { chapterOrder: [...order.slice(1), order[1]] }, 400);
    await patch(a, book.revision - 1, { upserts: [extra] }, 409);
    await patch(a, book.revision, { upserts: [{ ...extra, html: '<p>' + 'x'.repeat(50001) + '</p>' }] }, 400);
    await save(a, { ...document, chapters: [{ ...extra, html: '<p>' + 'x'.repeat(50001) + '</p>' }] }, book.revision, 400);
    assert.deepEqual((await api(a, path)).document, snapshot);
    receipt = await patch(a, book.revision, { deletedChapterIds: changed.map(ch => ch.id), chapterOrder: [extra.id] });
    book = await api(a, path);
    assert.deepEqual(book.document.chapters, [extra]);
    console.log('PASS 201-upsert/reorder, chapter 202, 201 deletions, revision conflicts, invalid order and retained character protection');
    await api(a, path, 'DELETE', { expectedRevision: book.revision }, 204);
    await api(a, path, 'GET', undefined, 404);
    await save(a, document, 0, 410);
    console.log(`PASS confirmed owner deletion and no resurrection; ${checks} API assertions passed`);
    if (process.argv.includes('--keep-fixture')) {
      const password = `Synthetic-${randomUUID()}`;
      await pool.query('UPDATE afilli_auth_accounts SET password_hash=$2 WHERE user_id=$1', [a.id, await hashPassword(password)]);
      await save(a, document, 0, 410); // The deleted book must remain deleted.
      const seedId = randomUUID();
      await api(a, `/writer-books/${seedId}`, 'PUT', { document, expectedRevision: 0, saveId: randomUUID(), localId: seedId });
      const file = `generated-artifacts/writer-management-${randomUUID()}.json`;
      await writeFile(new URL('../../../' + file, import.meta.url), JSON.stringify({ userId: a.id, email: a.email, password, bookId: seedId }));
      retained = a.id;
      console.log('BROWSER_FIXTURE=' + file);
    }
  } finally {
    try { for (const who of actors) if (who.id !== retained) await cleanup(who.id); }
    finally { await pool.end(); }
  }
}
