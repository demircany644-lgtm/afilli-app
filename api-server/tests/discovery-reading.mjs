import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
import { SaveWriterBookBody } from '@workspace/api-zod';
import { normalizeDocument } from '../src/lib/writer-document.ts';
if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Synthetic development fixtures only');
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`, tag = randomUUID().replaceAll('-', '');
const ids = ['author', 'reader', 'other'].map(x => `af_discover_${tag}_${x}`);
const [author, reader, other] = ids, password = `Synthetic ${randomUUID()}`;
const books = Array.from({ length: 105 }, () => randomUUID()), hidden = randomUUID(), draft = randomUUID(), created = randomUUID();
const allBooks = [...books, hidden, draft, created], chapters = [randomUUID(), randomUUID()], privateChapter = randomUUID();
const document = {
  title: `Işıl ${tag}`, description: 'Released description', genres: ['Polisiye', 'Macera'], ageRating: 'all', language: 'Türkçe',
  completion: 'ongoing', cover: null, chapters: chapters.map((id, i) => ({ id, title: `Bölüm ${i + 1}`, status: 'published', html: `<p>Public ${i}</p>` })),
};
let checks = 0;
async function api(path, token = null, method = 'GET', data, expected = 200, extra = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal(r.status, expected, `${method} ${path}: ${await r.clone().text()}`); checks++;
  return r.status === 204 ? null : r.json();
}
const login = i => api('/auth/login', null, 'POST', { email: `discover-${tag}-${i}@example.com`, password });
const discovery = (sort = 'new', cursor, category) => '/discovery/books?' + new URLSearchParams({
  sort, search: tag, ...(cursor ? { cursor } : {}), ...(category ? { category } : {}),
});
try {
  const hash = await hashPassword(password);
  for (const [i, id] of ids.entries()) {
    await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `Işıl ${tag} ${i}`]);
    await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)', [id, `discover-${tag}-${i}@example.com`, hash]);
  }
  for (const [i, id] of [...books, hidden, draft].entries()) {
    const released = { ...document, title: `Işıl ${tag} ${i}` };
    const privateDoc = { ...released, title: `SECRET ${tag}`, description: 'PRIVATE METADATA', chapters: [...released.chapters,
      { id: privateChapter, title: 'SECRET CHAPTER', html: '<p>PRIVATE MANUSCRIPT</p>', status: 'draft' }] };
    await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,writer_data,published_data,publication,moderation_hidden,published_at,writer_revision)
      VALUES($1::uuid,$2,$1::text,$3,'PRIVATE LEGACY BODY',$4,$5,$6,$7,$8,1)`,
    [id, author, released.title, privateDoc, id === draft ? null : released, id === draft ? 'draft' : 'published', id === hidden,
      new Date(Date.UTC(2026, 0, 1) + i * 1000)]);
  }
  // A published null cover must remain null; a newer/private legacy-column image cannot leak.
  await pool.query('UPDATE authored_books SET cover=$2 WHERE id=$1', [books[0], 'https://example.com/SECRET-private-cover.jpg']);
  const a = await login(0), r = await login(1), o = await login(2);
  // Every released visible book, including beyond the old first-page limit.
  const found = [], first = await api(discovery()); found.push(...first.items);
  assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
  let next = first.nextCursor;
  while (next) {
    const page = await api(discovery('new', next)); found.push(...page.items);
    next = page.nextCursor;
  }
  assert.equal(found.length, books.length);
  assert.equal(new Set(found.map(b => b.id)).size, books.length);
  assert.ok(found.every(b => books.includes(b.id) && b.author.id === author && b.genres.includes('Polisiye')));
  assert.ok(found.every(b => b.description === 'Released description'));
  const categoryFound = [], categoryFirst = await api(discovery('new', undefined, 'gerilim-polisiye-gizem'));
  categoryFound.push(...categoryFirst.items);
  let categoryCursor = categoryFirst.nextCursor;
  while (categoryCursor) {
    const page = await api(discovery('new', categoryCursor, 'gerilim-polisiye-gizem'));
    categoryFound.push(...page.items);
    categoryCursor = page.nextCursor;
  }
  assert.equal(categoryFound.length, books.length);
  assert.ok(categoryFound.every(b => b.genres.some(g => ['Gerilim', 'Polisiye', 'Gizem'].includes(g))));
  const homePolice = await api(discovery('new', undefined, 'polisiye-gerilim'));
  assert.equal(homePolice.items.length, 20);
  assert.ok(homePolice.items.every(b => b.genres.some(g => ['Polisiye', 'Gerilim'].includes(g))));
  assert.equal((await api(discovery('new', undefined, 'romantik'))).items.length, 0);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[0], { ...document, genres: ['Mafya', 'Yeraltı Dünyası'] }]);
  assert.deepEqual((await api(discovery('new', undefined, 'mafya-yeralti'))).items.map(b => b.id), [books[0]]);
  assert.deepEqual((await api(discovery('new', undefined, 'mafya'))).items.map(b => b.id), [books[0]]);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[0], { ...document, genres: ['Aşk'] }]);
  assert.deepEqual((await api(discovery('new', undefined, 'ask-romani'))).items.map(b => b.id), [books[0]]);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[0], { ...document, genres: ['Psikoloji'] }]);
  assert.deepEqual((await api(discovery('new', undefined, 'psikolojik-iliskiler'))).items.map(b => b.id), [books[0]]);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[0], { ...document, genres: ['Dram'] }]);
  assert.deepEqual((await api(discovery('new', undefined, 'dram-hayat-hikayeleri'))).items.map(b => b.id), [books[0]]);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[0], document]);
  const wire = JSON.stringify(found);
  for (const secret of ['SECRET', 'PRIVATE METADATA', 'PRIVATE MANUSCRIPT', 'PRIVATE LEGACY BODY', privateChapter]) assert.ok(!wire.includes(secret));
  assert.ok(!('body' in found[0]) && !('chapters' in found[0]));
  assert.equal(found.find(b => b.id === books[0]).coverUrl, null);
  assert.equal((await api('/discovery/books?' + new URLSearchParams({ search: `isil ${tag}` }))).items.length, 20);
  assert.equal((await api('/profiles?' + new URLSearchParams({ search: `isil ${tag}` }))).items.length, 3);
  assert.equal((await api('/discovery/books?' + new URLSearchParams({ search: `%${tag}` }))).items.length, 0);
  await api(discovery('popular', first.nextCursor), null, 'GET', undefined, 400);
  await api(discovery('new', first.nextCursor, 'romantik'), null, 'GET', undefined, 400);
  await api('/discovery/books?sort=bad', null, 'GET', undefined, 400);
  await api('/discovery/books?category=unknown', null, 'GET', undefined, 400);
  await api('/discovery/books?cursor=broken', null, 'GET', undefined, 400);
  const badCursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
  badCursor.time = '0';
  await api(discovery('new', Buffer.from(JSON.stringify(badCursor)).toString('base64url')), null, 'GET', undefined, 400);
  const lookup = await api('/discovery/book-cards?' + new URLSearchParams({ ids: [books[0], hidden, draft, randomUUID()].join(',') }));
  assert.deepEqual(lookup.map(x => x.id), [books[0]]);
  await api('/discovery/book-cards?ids=bad', null, 'GET', undefined, 400);
  await api('/discovery/book-cards?' + new URLSearchParams({ ids: books.join(',') }), null, 'GET', undefined, 400);
  await pool.query('INSERT INTO book_reads(book_id,reader_id) VALUES($1,$2),($1,$3)', [books[1], reader, other]);
  await pool.query('INSERT INTO book_reads(book_id,reader_id) VALUES($1,$2),($3,$2)', [hidden, reader, draft]);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[0], { ...document, genres: ['Fantastik'] }]);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[1], { ...document, genres: ['Bilim Kurgu'] }]);
  const fantasyScience = await api(discovery('read', undefined, 'fantastik-bilim-kurgu'));
  assert.equal(fantasyScience.items[0].id, books[1]);
  assert.deepEqual(new Set(fantasyScience.items.map(b => b.id)), new Set([books[0], books[1]]));
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[0], document]);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[1], document]);
  await pool.query('INSERT INTO writer_likes(book_id,user_id) VALUES($1,$2),($1,$3),($1,$4)', [books[0], author, reader, other]);
  assert.equal((await api(discovery('read'))).items[0].id, books[1]);
  assert.equal((await api(discovery('popular'))).items[0].id, books[0]);
  assert.equal((await api(discovery('new'))).items[0].id, books.at(-1));
  await api('/reader/read-books', null, 'GET', undefined, 401);
  assert.deepEqual((await api('/reader/read-books', r.token)).map(book => book.id), [books[1]]);
  // Released content, not newer private metadata, is reader truth.
  const publicDetail = await api(`/authored-books/${books[0]}`, r.token);
  assert.equal(publicDetail.chapters.length, 2); assert.ok(!JSON.stringify(publicDetail).includes('SECRET'));
  await api(`/authored-books/${hidden}`, r.token, 'GET', undefined, 404);
  await api(`/authored-books/${draft}`, r.token, 'GET', undefined, 404);
  const path = `/authored-books/${books[0]}/reading-position`;
  await api(path, null, 'GET', undefined, 401);
  assert.deepEqual(await api(path, r.token), { chapterId: chapters[0], resumed: false, chapterMissing: false });
  await api(path, r.token, 'PUT', { chapterId: privateChapter }, 404);
  await api(path, r.token, 'PUT', { chapterId: chapters[1] }, 401, { 'X-Afilli-Actor': other });
  await api(path, r.token, 'PUT', { chapterId: chapters[1] });
  const again = await login(1);
  assert.deepEqual(await api(path, again.token), { chapterId: chapters[1], resumed: true, chapterMissing: false });
  assert.deepEqual(await api(path, o.token), { chapterId: chapters[0], resumed: false, chapterMissing: false });
  await api(path, o.token, 'PUT', { chapterId: chapters[0] });
  assert.equal((await api(path, again.token)).chapterId, chapters[1]);
  await api(`/authored-books/${hidden}/reading-position`, r.token, 'GET', undefined, 404);
  await api(`/authored-books/${draft}/reading-position`, r.token, 'PUT', { chapterId: chapters[0] }, 404);
  await api(`/authored-books/${draft}/reading-position`, a.token, 'GET', undefined, 404);
  await pool.query('UPDATE authored_books SET published_data=$2 WHERE id=$1', [books[0], { ...document, chapters: document.chapters.slice(0, 1) }]);
  assert.deepEqual(await api(path, r.token), { chapterId: chapters[0], resumed: false, chapterMissing: true });
  await api(path, r.token, 'PUT', { chapterId: chapters[1] }, 404);
  await api(path, r.token, 'PUT', { chapterId: chapters[0] });
  assert.equal((await api(path, r.token)).chapterMissing, false);
  for (const genres of [['Roman', 'Hikaye'], ['Polisiye', 'Macera', 'Eğitim'], ['Distopya', 'Mafya', 'Hayat Hikâyeleri']]) {
    const input = SaveWriterBookBody.parse({ document: { ...document, genres }, expectedRevision: 0, saveId: randomUUID(), localId: 'synthetic' });
    assert.deepEqual(normalizeDocument(input.document).genres, genres);
  }
  assert.throws(() => SaveWriterBookBody.parse({ document: { ...document, genres: ['invalid-category'] }, expectedRevision: 0, saveId: randomUUID(), localId: 'synthetic' }));
  // Cascading book deletion cannot leave another reader's private progress orphaned.
  await pool.query('DELETE FROM writer_likes WHERE book_id=$1', [books[0]]);
  await pool.query('DELETE FROM book_reads WHERE book_id=$1', [books[0]]);
  await pool.query('DELETE FROM authored_books WHERE id=$1', [books[0]]);
  assert.equal((await pool.query('SELECT 1 FROM book_reading_positions WHERE book_id=$1', [books[0]])).rowCount, 0);
} finally {
  for (const table of ['book_reading_positions', 'writer_likes', 'writer_comments', 'book_reads']) await pool.query(`DELETE FROM ${table} WHERE book_id=ANY($1::uuid[])`, [allBooks]);
  await pool.query('DELETE FROM authored_books WHERE id=ANY($1::uuid[])', [allBooks]);
  for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts']) await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [ids]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
}
console.log(`PASS ${checks} discovery/reading API checks.`);
