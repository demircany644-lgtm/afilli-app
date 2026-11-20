import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
if (process.env.NODE_ENV === 'production') throw new Error('Synthetic development fixture only');
const [action, suffix] = process.argv.slice(2);
if (!/^[a-f0-9]{12}$/.test(suffix ?? '')) throw new Error('Supply a 12-character synthetic fixture id');
const users = ['writer', 'reader', 'other'].map(n => `af_readui_${suffix}_${n}`);
try {
  if (action === 'create' || action === 'create-comments') {
    const password = 'Synthetic reading UI 2026!', hash = await hashPassword(password);
    for (const [i, id] of users.entries()) {
      await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `OkumaDenetim${i}-${suffix}`]);
      await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)', [id, `readui-${i}-${suffix}@example.com`, hash]);
    }
    const id = randomUUID(), chapters = [1, 2, 3].map(n => ({
      id: randomUUID(), title: `Deneme Bölüm ${n}`, html: `<p>Bu geçici denetim kitabının ${n}. bölümüdür. Okuma konumu bu bölüm seçildiğinde korunmalıdır.</p>`, status: 'published',
    }));
    const doc = { title: `Geçici Okuma Denetimi ${suffix}`, description: 'Test sonrası kaldırılacak geçici denetim kaydı.',
      cover: null, genres: ['Polisiye'], ageRating: 'all', completion: 'completed', language: 'Türkçe', chapters };
    await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,writer_data,published_data,publication,published_at,writer_revision)
      VALUES($1::uuid,$2,$1::text,$3,'',$4,$4,'published',now(),1)`, [id, users[0], doc.title, doc]);
    let focusComment = null;
    if (action === 'create-comments') {
      let parent = null;
      for (const [i, body] of ['İlk bölümün atmosferini çok sevdim. Devamını merak ediyorum.',
        'Okuduğun ve düşünceni paylaştığın için teşekkür ederim.',
        'Ben de karakterin bir sonraki kararını merak ediyorum.'].entries()) {
        const node = (await pool.query(`INSERT INTO writer_comments(book_id,author_id,client_id,chapter_id,parent_id,body)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [id, users[[1, 0, 2][i]], randomUUID(), chapters[0].id, parent, body])).rows[0];
        if (i === 0) await pool.query(`INSERT INTO writer_comment_reactions(comment_id,user_id,reaction) VALUES($1,$2,'like'),($1,$3,'love')`,
          [node.id, users[0], users[2]]);
        parent = node.id;
      }
      focusComment = parent;
    }
    console.log(JSON.stringify({ bookId: id, focusComment, title: doc.title, chapters: chapters.map(c => ({ id: c.id, title: c.title })),
      reader: `readui-1-${suffix}@example.com`, other: `readui-2-${suffix}@example.com`, password }));
  } else if (action === 'cleanup') {
    const { rows } = await pool.query('SELECT id FROM authored_books WHERE author_id=ANY($1::text[])', [users]);
    const ids = rows.map(r => r.id);
    for (const table of ['book_reading_positions', 'writer_likes', 'writer_comments', 'book_reads']) await pool.query(`DELETE FROM ${table} WHERE book_id=ANY($1::uuid[])`, [ids]);
    await pool.query('DELETE FROM authored_books WHERE author_id=ANY($1::text[])', [users]);
    for (const table of ['afilli_auth_codes', 'afilli_auth_sessions', 'afilli_auth_accounts']) await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [users]);
    await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [users]);
    console.log('Synthetic reading fixtures removed.');
  } else throw new Error('Use create or cleanup');
} finally { await pool.end(); }
