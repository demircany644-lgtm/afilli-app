import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
import { deleteAccount, cleanDeletedAccountMedia } from '../src/lib/admin-account-delete.ts';
import { transaction } from '../src/lib/community.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Development fixtures only');
const key = randomUUID(), ids = ['root', 'admin', 'target', 'keep'].map(x => `af_delete_${key}_${x}`);
const [root, admin, target, keep] = ids, password = `Synthetic ${randomUUID()}`;
const book = randomUUID(), otherBook = randomUUID(), post = randomUUID(), otherPost = randomUUID();
const comment = randomUUID(), reply = randomUUID(), thread = randomUUID();
const media = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const moderationAttempt = media[3];
let checks = 0;
async function api(path, token, expected, method = 'GET', data) {
  const r = await fetch(`http://localhost:80/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await r.text(), result = text ? JSON.parse(text) : null;
  assert.equal(r.status, expected, `${method} ${path}: ${text}`);
  checks++; return result;
}
try {
  const hash = await hashPassword(password), tokens = [];
  for (const [i, id] of ids.entries()) {
    await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, ['SilmeYetkili', 'SilmeYonetici', 'SilmeHedef', 'SilmeKorunan'][i]]);
    await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role) VALUES($1,$2,$3,$4)',
      [id, `delete-${key}-${i}@example.com`, hash, ['superadmin', 'admin', 'user', 'user'][i]]);
    tokens.push((await api('/auth/login', null, 200, 'POST', { email: `delete-${key}-${i}@example.com`, password })).token);
  }
  for (const [id, owner] of [[book, target], [otherBook, keep]]) {
    await pool.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,publication) VALUES($1::uuid,$2,$1::text,'Silme testi','Synthetic','published')`, [id, owner]);
  }
  for (const [id, owner] of [[post, target], [otherPost, keep]]) {
    await pool.query(`INSERT INTO bulletins(id,author_id,client_id,body,book_id) VALUES($1,$2,$1,'Synthetic', $3)`, [id, owner, book]);
  }
  await pool.query('INSERT INTO bulletin_comments(id,post_id,author_id,body) VALUES($1,$2,$3,$4)', [comment, otherPost, target, 'Synthetic']);
  await pool.query('INSERT INTO bulletin_comments(id,post_id,author_id,body,parent_id,depth) VALUES($1,$2,$3,$4,$5,2)', [reply, otherPost, keep, 'Keep reply', comment]);
  await pool.query("INSERT INTO bulletin_reactions(target_type,target_id,user_id,emoji) VALUES('comment',$1,$2,'👍')", [comment, keep]);
  await pool.query('INSERT INTO writer_comments(book_id,author_id,client_id,body) VALUES($1,$2,$3,$4)', [otherBook, target, randomUUID(), 'Synthetic']);
  await pool.query('INSERT INTO writer_likes(book_id,user_id) VALUES($1,$2)', [otherBook, target]);
  await pool.query('INSERT INTO bulletin_likes(post_id,user_id) VALUES($1,$2)', [otherPost, target]);
  await pool.query('INSERT INTO book_reads(book_id,reader_id) VALUES($1,$2)', [otherBook, target]);
  await pool.query('INSERT INTO profile_follows(follower_id,followed_id) VALUES($1,$2),($2,$1)', [target, keep]);
  await pool.query('INSERT INTO conversations(id,user_low,user_high) VALUES($1,$2,$3)', [thread, ...[target, keep].sort()]);
  await pool.query('INSERT INTO direct_messages(thread_id,sender_id,client_id,body) VALUES($1,$2,$3,$4)', [thread, keep, randomUUID(), 'Keep conversation removed']);
  await pool.query("INSERT INTO writer_uploads(id,owner_id,content_type,size) VALUES($1,$2,'image/png',1)", [media[0], target]);
  await pool.query('INSERT INTO writer_media_refs(media_id,book_id,version) VALUES($1,$2,$3)', [media[0], book, 'draft']);
  await pool.query('INSERT INTO writer_media_reservations(media_id,reservation_id) VALUES($1,$2)', [media[0], randomUUID()]);
  await pool.query("INSERT INTO profile_uploads(id,owner_id,purpose,content_type,size) VALUES($1,$2,'avatar','image/png',1)", [media[1], target]);
  await pool.query("INSERT INTO bulletin_uploads(id,owner_id,post_id,object_path,content_type,size) VALUES($1,$2,$3,'synthetic','image/png',1)", [media[2], target, post]);
  await pool.query(`INSERT INTO prohibited_image_attempts(id,user_id,area,evidence_path,distance,threshold)
    VALUES($1::uuid,$2,'bulletin','attempts/'||$1::text||'.jpg',0,6)`, [moderationAttempt, target]);
  await pool.query("INSERT INTO writer_voice_requests(id,owner_id,status,seconds) VALUES($1,$2,'completed',1)", [randomUUID(), target]);
  await pool.query('INSERT INTO writer_voice_usage(user_id,seconds) VALUES($1,1)', [target]);
  await pool.query('INSERT INTO writer_book_deletions(book_id,owner_id) VALUES($1,$2)', [randomUUID(), target]);
  const body = { confirmation: 'SilmeHedef', reason: 'Synthetic deletion test' };
  await api(`/admin/accounts/${target}/deletion`, null, 401);
  await api(`/admin/accounts/${target}/deletion`, tokens[1], 403);
  await api(`/admin/accounts/${target}`, tokens[3], 403, 'DELETE', body);
  await api(`/admin/accounts/${target}`, tokens[1], 403, 'DELETE', body);
  await api(`/admin/accounts/${root}`, tokens[0], 409, 'DELETE', { ...body, confirmation: 'SilmeYetkili' });
  await api(`/admin/accounts/${target}`, tokens[0], 409, 'DELETE', { ...body, confirmation: 'Wrong account' });
  await api(`/admin/accounts/${target}`, tokens[0], 400, 'DELETE', { ...body, reason: ' ' });
  const scope = await api(`/admin/accounts/${target}/deletion`, tokens[0], 200);
  assert.deepEqual(scope, { nickname: 'SilmeHedef', books: 1, bulletins: 1, comments: 2, conversations: 1, media: 4 });
  // Force a failure AFTER all deletes: everything including queue and audit must roll back.
  await assert.rejects(transaction(async db => {
    await deleteAccount(db, root, target, body.confirmation, body.reason);
    throw new Error('synthetic rollback');
  }), /synthetic rollback/);
  assert.equal((await pool.query('SELECT id FROM community_users WHERE id=$1', [target])).rowCount, 1);
  assert.equal((await pool.query('SELECT id FROM authored_books WHERE id=$1', [book])).rowCount, 1);
  assert.equal((await pool.query('SELECT id FROM prohibited_image_attempts WHERE id=$1', [moderationAttempt])).rowCount, 1);
  assert.equal((await pool.query('SELECT media_id FROM account_media_deletions WHERE media_id=ANY($1::uuid[])', [media])).rowCount, 0);
  await api(`/admin/accounts/${target}`, tokens[0], 204, 'DELETE', body);
  await api(`/admin/accounts/${target}`, tokens[0], 404, 'DELETE', body);
  assert.equal((await api('/auth/session', tokens[2], 200)).user, null);
  await api('/auth/login', null, 401, 'POST', { email: `delete-${key}-2@example.com`, password });
  for (const [table, column] of [['community_users', 'id'], ['afilli_auth_accounts', 'user_id'], ['afilli_auth_sessions', 'user_id'],
    ['writer_comments', 'author_id'], ['writer_likes', 'user_id'], ['book_reads', 'reader_id'], ['writer_voice_usage', 'user_id'],
    ['writer_uploads', 'owner_id'], ['profile_uploads', 'owner_id'], ['bulletin_uploads', 'owner_id']]) {
    assert.equal((await pool.query(`SELECT * FROM ${table} WHERE ${column}=$1`, [target])).rowCount, 0, table);
  }
  assert.equal((await pool.query('SELECT * FROM authored_books WHERE id=$1', [book])).rowCount, 0);
  assert.equal((await pool.query('SELECT * FROM prohibited_image_attempts WHERE id=$1', [moderationAttempt])).rowCount, 0);
  assert.equal((await pool.query('SELECT * FROM conversations WHERE id=$1', [thread])).rowCount, 0);
  assert.equal((await pool.query('SELECT * FROM authored_books WHERE id=$1', [otherBook])).rowCount, 1);
  assert.equal((await pool.query('SELECT book_id FROM bulletins WHERE id=$1', [otherPost])).rows[0].book_id, null);
  assert.equal((await pool.query('SELECT parent_id FROM bulletin_comments WHERE id=$1', [reply])).rows[0].parent_id, null);
  assert.equal((await pool.query('SELECT * FROM bulletin_reactions WHERE target_id=$1', [comment])).rowCount, 0);
  assert.equal((await pool.query("SELECT * FROM admin_audit WHERE target_id=$1 AND action='account.delete'", [target])).rowCount, 1);
  assert.equal((await pool.query('SELECT * FROM account_media_deletions WHERE media_id=ANY($1::uuid[]) AND eligible_at>now()', [media])).rowCount, 4);
  // Make only our synthetic jobs eligible; fake remover never touches real objects.
  await pool.query("UPDATE account_media_deletions SET eligible_at=now()-interval '1 second' WHERE media_id=ANY($1::uuid[])", [media]);
  const seen = [];
  await cleanDeletedAccountMedia(async (_kind, id) => {
    if (!media.includes(id)) throw new Error('Not our fixture');
    seen.push(id);
    if (id === media[0]) throw new Error('Synthetic storage outage');
  });
  assert.equal(seen.length, 4);
  assert.equal((await pool.query('SELECT * FROM account_media_deletions WHERE media_id=ANY($1::uuid[])', [media])).rowCount, 1);
  await cleanDeletedAccountMedia(async (_kind, id) => {
    if (!media.includes(id)) throw new Error('Not our fixture');
  });
  assert.equal((await pool.query('SELECT * FROM account_media_deletions WHERE media_id=ANY($1::uuid[])', [media])).rowCount, 0);
  console.log(`PASS ${checks} API checks plus scope, dependent deletion, rollback, session invalidation, unrelated content preservation, durable media retry.`);
} finally {
  await pool.query('DELETE FROM account_media_deletions WHERE media_id=ANY($1::uuid[])', [media]);
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM bulletin_reactions WHERE user_id=ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM conversations WHERE user_low=ANY($1::text[]) OR user_high=ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM profile_follows WHERE follower_id=ANY($1::text[]) OR followed_id=ANY($1::text[])', [ids]);
  for (const [table, col] of [['writer_comments', 'author_id'], ['writer_likes', 'user_id'], ['book_reads', 'reader_id'], ['bulletin_likes', 'user_id'],
    ['writer_uploads', 'owner_id'], ['profile_uploads', 'owner_id'], ['bulletin_uploads', 'owner_id'], ['writer_voice_requests', 'owner_id'],
    ['writer_voice_usage', 'user_id'], ['writer_book_deletions', 'owner_id'], ['bulletins', 'author_id'], ['authored_books', 'author_id'],
    ['afilli_auth_codes', 'user_id'], ['afilli_auth_sessions', 'user_id'], ['afilli_auth_accounts', 'user_id']]) {
    await pool.query(`DELETE FROM ${table} WHERE ${col}=ANY($1::text[])`, [ids]);
  }
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
}
