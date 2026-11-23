import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Synthetic development fixtures only');
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
async function cleanup(fixture) {
  for (const id of fixture.users) assert.match(id, /^af_test_[a-f0-9]{32}$/);
  await pool.query('DELETE FROM social_notifications WHERE recipient_id=ANY($1::text[]) OR actor_id=ANY($1::text[])', [fixture.users]);
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])', [fixture.users]);
  await pool.query('DELETE FROM authored_books WHERE id=$1 AND author_id=ANY($2::text[])', [fixture.bookId, fixture.users]);
  await pool.query('DELETE FROM writer_book_deletions WHERE owner_id=ANY($1::text[])', [fixture.users]);
  for (const table of ['afilli_auth_codes','afilli_auth_sessions','afilli_auth_accounts'])
    await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [fixture.users]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [fixture.users]);
}
const fileIndex = process.argv.indexOf('--cleanup');
if (fileIndex >= 0) {
  try {
    const file = process.argv[fileIndex + 1];
    assert.match(file ?? '', /^generated-artifacts\/reader-social-[a-f0-9-]+\.json$/);
    const url = new URL('../../../' + file, import.meta.url), fixture = JSON.parse(await readFile(url, 'utf8'));
    await cleanup(fixture); await unlink(url); console.log('PASS social reader fixture removed');
  } finally { await pool.end(); }
} else {
  const users = Array.from({ length: 5 }, () => 'af_test_' + randomUUID().replaceAll('-', ''));
  const [author, reader, other, admin, spammer] = users, bookId = randomUUID(), chapterId = randomUUID(), secondId = randomUUID(), draftId = randomUUID();
  const tag = randomUUID(), password = `Synthetic-${randomUUID()}`, emails = users.map((_, i) => `reader-social-${i}-${tag}@example.com`);
  const fixture = { users, bookId, author, reader, admin, email: emails[1], adminEmail: emails[3], password, chapterId, secondId };
  let keep = false, checks = 0;
  async function api(path, token = null, method = 'GET', data, expected = 200, extra = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
    assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`); checks++;
    return expected === 204 ? null : response.json();
  }
  try {
    const hash = await hashPassword(password);
    for (const [i, id] of users.entries()) {
      await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `Okur${i}-${tag.slice(0, 7)}`]);
      await pool.query(`INSERT INTO afilli_auth_accounts(user_id,email,password_hash,email_verified,role)
        VALUES($1,$2,$3,true,$4)`, [id, emails[i], hash, id === admin ? 'admin' : 'user']);
    }
    const tokens = [];
    for (let i = 0; i < users.length; i++) tokens.push((await api('/auth/login', null, 'POST', { email: emails[i], password })).token);
    const [a, r, o, m, s] = tokens;
    let document = { title: `Sosyal okuma ${tag.slice(0, 7)}`, description: 'Geçici geliştirme kontrolü', cover: 'preset:forest',
      genres: ['Roman'], ageRating: 'all', completion: 'ongoing', language: 'Türkçe', chapters: [
        { id: chapterId, title: 'Birinci bölüm', html: '<h2>Başlık</h2><p>İlk paragraf.</p><p>Tekrar.</p><p>Tekrar.</p><p>Son paragraf.</p>', status: 'published' },
        { id: secondId, title: 'İkinci bölüm', html: '<p>Başka bölüm.</p>', status: 'published' },
        { id: draftId, title: 'Gizli taslak', html: '<p>Yayınlanmamış içerik.</p>', status: 'draft' },
      ] };
    let revision = 0;
    const publish = async () => {
      const saved = await api(`/writer-books/${bookId}`, a, 'PUT', { document, expectedRevision: revision, saveId: randomUUID(), localId: bookId });
      const released = await api(`/writer-books/${bookId}/publication`, a, 'POST', { action: 'publish', expectedRevision: saved.revision });
      revision = released.revision;
    };
    await publish();
    const chapter = (id = chapterId, token = r) => api(`/authored-books/${bookId}/chapters/${id}/interactions`, token);
    const like = (token, paragraphId, liked = true, expected = 200, id = chapterId) =>
      api(`/authored-books/${bookId}/chapters/${id}/interactions`, token, 'PUT', { paragraphId, liked }, expected);
    const add = (token, body, chapter = chapterId, paragraphId = null, parentId = null, clientId = randomUUID(), expected = 200) =>
      api(`/authored-books/${bookId}/comments`, token, 'POST', { body, chapterId: chapter, paragraphId, parentId, clientId }, expected);
    const list = (scope, id = chapterId, paragraphId, cursor) => api(`/authored-books/${bookId}/comment-threads?` +
      new URLSearchParams({ scope, ...(id ? { chapterId: id } : {}), ...(paragraphId ? { paragraphId } : {}), ...(cursor ? { cursor } : {}) }), r);
    let meta = await chapter();
    assert.equal(meta.contentHash, createHash('sha256').update(document.chapters[0].html).digest('hex'));
    assert.equal(meta.paragraphs.length, 5);
    const p = meta.paragraphs.find(p => p.quote === 'İlk paragraf.'), dup = meta.paragraphs.find(p => p.quote === 'Tekrar.');
    assert.ok(p?.id && dup?.id);
    assert.equal((await chapter()).paragraphs.find(x => x.path === p.path).id, p.id);
    const otherParagraph = (await chapter(secondId)).paragraphs[0];
    await api(`/authored-books/${bookId}/chapters/${draftId}/interactions`, r, 'GET', undefined, 404);
    await like(null, null, true, 401); await like(r, otherParagraph.id, true, 404);
    assert.equal((await like(r, null)).likeCount, 1);
    assert.equal((await like(r, null)).likeCount, 1);
    assert.equal((await like(r, null, false)).likeCount, 0);
    assert.equal((await like(r, p.id)).paragraphs.find(x => x.id === p.id).likeCount, 1);
    assert.equal((await like(r, p.id)).paragraphs.find(x => x.id === p.id).likeCount, 1);
    assert.equal((await chapter(secondId)).likeCount, 0);
    assert.equal((await chapter(chapterId, null)).paragraphs.find(x => x.id === p.id).liked, false);
    const ca = await add(r, 'Birinci bölüme yorum'), cb = await add(r, 'İkinci bölüme yorum', secondId);
    const general = await add(r, 'Kitap geneline yorum', null);
    const rootClient = randomUUID(), root = await add(r, 'Paragraf konuşması', chapterId, p.id, null, rootClient);
    assert.equal((await add(r, 'Paragraf konuşması', chapterId, p.id, null, rootClient)).id, root.id);
    const reply = await api(`/authored-books/${bookId}/comments`, a, 'POST', { clientId: randomUUID(), body: 'Yazarın yanıtı', parentId: root.id });
    const nested = await add(r, 'İç içe yanıt', chapterId, p.id, reply.id);
    const duplicateComment = await add(r, 'Tekrarlanan paragrafa yorum', chapterId, dup.id);
    assert.equal(reply.paragraphId, p.id); assert.equal(reply.chapterId, chapterId);
    assert.deepEqual((await list('chapter')).items.map(x => x.id), [ca.id]);
    assert.deepEqual((await list('chapter', secondId)).items.map(x => x.id), [cb.id]);
    assert.deepEqual((await list('paragraph', chapterId, p.id)).items.map(x => x.id), [root.id]);
    assert.deepEqual((await list('book', null)).items.map(x => x.id), [general.id]);
    assert.equal((await chapter()).commentCount, 5); assert.equal((await chapter()).chapterCommentCount, 1);
    await api(`/authored-books/${bookId}/comment-threads?` + new URLSearchParams({
      scope: 'paragraph', chapterId: secondId, paragraphId: p.id,
    }), r, 'GET', undefined, 404);
    await add(r, 'Wrong paragraph', secondId, p.id, null, randomUUID(), 400);
    await add(r, 'Wrong parent', chapterId, dup.id, root.id, randomUUID(), 400);
    await api(`/writer-comments/${root.id}`, a, 'PATCH', { body: 'Not mine' }, 403);
    await api(`/writer-comments/${root.id}`, a, 'DELETE', undefined, 403);
    await api(`/writer-comments/${root.id}/reaction`, o, 'PUT', { reaction: 'like' });
    const reacted = await api(`/writer-comments/${root.id}/reaction`, o, 'PUT', { reaction: 'like' });
    assert.equal(reacted.reactions.find(x => x.reaction === 'like').count, 1);
    assert.equal((await api(`/writer-comments/${nested.id}/path`, r))[0].paragraphId, p.id);
    const authorInbox = await api('/book-notifications', a), readerInbox = await api('/book-notifications', r);
    assert.ok(authorInbox.items.some(x => x.commentId === root.id && x.chapterId === chapterId));
    assert.ok(readerInbox.items.some(x => x.commentId === reply.id && x.kind === 'comment_reply'));
    if (process.argv.includes('--prepare-fixture')) {
      Object.assign(fixture, { paragraphId: p.id, duplicateParagraphId: dup.id, rootId: root.id, replyId: reply.id, nestedId: nested.id, chapterCommentId: ca.id });
      const file = `generated-artifacts/reader-social-${randomUUID()}.json`;
      await writeFile(new URL('../../../' + file, import.meta.url), JSON.stringify(fixture));
      keep = true; console.log('BROWSER_FIXTURE=' + file);
    } else {
      await api('/admin/reader-reports', r, 'GET', undefined, 403);
      await api(`/writer-comments/${root.id}/reports`, r, 'POST', { reason: 'spam' }, 400);
      const report = await api(`/writer-comments/${reply.id}/reports`, r, 'POST', { reason: 'abuse', details: 'Kontrol amaçlı bildirim' });
      assert.equal((await api(`/writer-comments/${reply.id}/reports`, r, 'POST', { reason: 'spam' })).id, report.id);
      assert.ok((await api('/admin/reader-reports', m)).items.some(x => x.id === report.id));
      await api(`/admin/reader-reports/${report.id}`, r, 'PATCH', { action: 'hide' }, 403);
      assert.equal((await api(`/admin/reader-reports/${report.id}`, m, 'PATCH', { action: 'hide' })).status, 'hidden');
      await api(`/admin/reader-reports/${report.id}`, m, 'PATCH', { action: 'hide' });
      await api(`/writer-comments/${nested.id}/path`, r, 'GET', undefined, 404);
      assert.equal((await pool.query('SELECT id FROM writer_comments WHERE id=ANY($1::uuid[])', [[reply.id, nested.id]])).rowCount, 2);
      const dismissed = await api(`/writer-comments/${ca.id}/reports`, o, 'POST', { reason: 'other' });
      assert.equal((await api(`/admin/reader-reports/${dismissed.id}`, m, 'PATCH', { action: 'dismiss' })).status, 'dismissed');
      assert.ok((await list('chapter')).items.some(x => x.id === ca.id));
      // Unique text keeps its identity after an insertion; duplicates are conservatively archived.
      document = { ...document, chapters: document.chapters.map(c => c.id === chapterId ? { ...c, html: '<p>Yeni eklenen paragraf.</p>' + c.html } : c) };
      await publish(); meta = await chapter();
      assert.equal(meta.paragraphs.find(x => x.quote === p.quote).id, p.id);
      assert.ok(meta.archived.some(x => x.id === dup.id));
      assert.ok(meta.paragraphs.filter(x => x.quote === 'Tekrar.').every(x => x.id !== dup.id && x.commentCount === 0));
      document = { ...document, chapters: document.chapters.map(c => c.id === chapterId ? { ...c, html: c.html.replace('İlk paragraf.', 'Değişen paragraf.') } : c) };
      await publish(); meta = await chapter();
      assert.ok(meta.archived.some(x => x.id === p.id && x.commentCount === 1));
      await add(r, 'No new roots on stale text', chapterId, p.id, null, randomUUID(), 409);
      await like(r, p.id, true, 409);
      await like(r, p.id, false);
      const archivedReply = await add(a, 'Arşivdeki konuşmaya yanıt', chapterId, p.id, root.id);
      await api(`/writer-comments/${root.id}`, r, 'PATCH', { body: 'Arşiv yorumu düzenlendi' });
      await api(`/writer-comments/${root.id}`, r, 'DELETE');
      assert.ok((await list('paragraph', chapterId, p.id)).items.some(x => x.id === root.id && x.deleted));
      assert.equal((await api(`/writer-comments/${archivedReply.id}/path`, a)).at(-1).body, 'Arşivdeki konuşmaya yanıt');
      // Persisted anti-spam survives deletion and idempotent retries don't count twice.
      await pool.query(`INSERT INTO reader_comment_events(user_id,body_hash) SELECT $1,'seed-'||g FROM generate_series(1,30) g`, [spammer]);
      await add(s, 'Too many', chapterId, null, null, randomUUID(), 429);
      await pool.query('DELETE FROM reader_comment_events WHERE user_id=$1', [spammer]);
      let last, lastClient;
      for (let i = 0; i < 3; i++) { lastClient = randomUUID(); last = await add(s, 'Aynı spam metni', chapterId, null, null, lastClient); }
      await add(s, 'Aynı spam metni', chapterId, null, null, randomUUID(), 429);
      assert.equal((await add(s, 'Aynı spam metni', chapterId, null, null, lastClient)).id, last.id);
      await api(`/writer-comments/${last.id}`, s, 'DELETE');
      await add(s, 'Aynı spam metni', chapterId, null, null, randomUUID(), 429);
      console.log(`PASS ${checks} chapter/paragraph/reaction/report/ownership/notification/archive/spam API checks`);
    }
  } finally { if (!keep) await cleanup(fixture); await pool.end(); }
}
