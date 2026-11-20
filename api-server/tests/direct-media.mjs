import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
import { directPhotoObject } from '../src/lib/bulletin-storage.ts';

if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw Error('Synthetic development data only');
const tag = randomUUID().replaceAll('-', ''), base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const users = ['a', 'b', 'c'].map(x => `af_media_${tag}_${x}`);
const password = `Synthetic ${randomUUID()}`, uploads = [], purged = [];
let checks = 0;
async function api(path, token, method = 'GET', data, status = 200) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal(res.status, status, `${method} ${path}: unexpected ${res.status}`); checks++;
  return status === 204 ? null : res.json();
}
async function photoResponse(id, token, status) {
  const res = await fetch(base + '/direct-media/' + id, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal(res.status, status); checks++;
  if (status !== 200) return;
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.match(res.headers.get('content-type'), /image\/jpeg/);
  const data = await res.arrayBuffer();
  const meta = await sharp(Buffer.from(data)).metadata();
  assert.ok(meta.width <= 1600 && meta.height <= 1600); assert.equal(meta.exif, undefined);
}
try {
  const hash = await hashPassword(password);
  for (const [i, id] of users.entries()) {
    await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `MediaDenetim${i}-${tag}`]);
    await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)', [id, `media-${i}-${tag}@example.com`, hash]);
  }
  const sessions = [];
  for (let i = 0; i < 3; i++) sessions.push(await api('/auth/login', null, 'POST', { email: `media-${i}-${tag}@example.com`, password }));
  const [a, b, c] = sessions.map(s => s.token);
  const thread = (await api('/conversations', a, 'POST', { peerId: users[1] })).id;
  const send = (body, extras = {}, who = a) => api(`/conversations/${thread}/messages`, who, 'POST', { clientId: randomUUID(), body, ...extras }, 201);
  const head = () => api(`/conversations/${thread}/messages`, b);
  const allChanges = async after => {
    const items = [];
    for (let page = 0; page < 10; page++) {
      const next = await api(`/conversations/${thread}/changes?after=${after}`, b);
      items.push(...next.items);
      if (!next.hasMore) return items;
      assert.ok(BigInt(next.nextAfter) > BigInt(after)); after = next.nextAfter;
    }
    throw Error('Mutation paging did not finish');
  };
  const message = await send('Delete only this exact private message');
  const quoted = await send('Reply must remain', { replyToId: message.id }, b);
  const cursor = (await head()).changeCursor;
  await api(`/conversations/${thread}/messages/${message.id}`, b, 'DELETE', undefined, 403);
  await api(`/conversations/${thread}/messages/${message.id}`, c, 'DELETE', undefined, 404);
  await api(`/conversations/${thread}/messages/${message.id}`, null, 'DELETE', undefined, 401);
  const deleted = await api(`/conversations/${thread}/messages/${message.id}`, a, 'DELETE');
  assert.equal(deleted.body, ''); assert.ok(deleted.deletedAt); assert.equal(deleted.gif, null); assert.equal(deleted.photo, null);
  assert.ok((await api(`/conversations/${thread}/messages/${message.id}`, a, 'DELETE')).deletedAt);
  const changes = await api(`/conversations/${thread}/changes?after=${cursor}`, b);
  assert.ok(changes.items.find(m => m.id === message.id).deletedAt);
  assert.equal(changes.items.find(m => m.id === quoted.id).reply.available, false);
  assert.ok(!JSON.stringify(changes).includes(message.body));
  const retry = await send(message.body, { clientId: message.clientId });
  assert.equal(retry.id, message.id); assert.equal(retry.body, ''); assert.ok(retry.deletedAt);
  const replyError = await api(`/conversations/${thread}/messages`, a, 'POST', { clientId: randomUUID(), body: 'Safe retry', replyToId: message.id }, 422);
  assert.equal(replyError.code, 'REPLY_UNAVAILABLE');
  await api(`/conversations/${thread}/changes?after=0`, c, 'GET', undefined, 404);

  const original = await sharp({ create: { width: 2200, height: 1200, channels: 3, background: '#487897' } }).jpeg().withMetadata().toBuffer();
  async function uploadedPhoto() {
    const clientId = randomUUID(), input = { clientId, size: original.length };
    const upload = await api(`/conversations/${thread}/photo-uploads`, a, 'POST', input); uploads.push(upload.id);
    const duplicate = await api(`/conversations/${thread}/photo-uploads`, a, 'POST', input);
    assert.equal(duplicate.id, upload.id);
    const put = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: original });
    assert.equal(put.status, 200, 'Private direct photo upload failed'); checks++;
    await api(`/direct-photo-uploads/${upload.id}/complete`, b, 'POST', undefined, 404);
    await api(`/direct-photo-uploads/${upload.id}/complete`, a, 'POST');
    await photoResponse(upload.id, a, 404); // unattached uploads are never readable
    return { id: upload.id, clientId };
  }
  await api(`/conversations/${thread}/photo-uploads`, c, 'POST', { clientId: randomUUID(), size: original.length }, 404);
  const photo = await uploadedPhoto();
  const sentPhoto = await send('Retain this photo caption', { clientId: photo.clientId, photoId: photo.id });
  assert.equal(sentPhoto.photo.id, photo.id); assert.ok(sentPhoto.mediaExpiresAt);
  await photoResponse(photo.id, a, 200); await photoResponse(photo.id, b, 200);
  await photoResponse(photo.id, c, 404); await photoResponse(photo.id, null, 401);
  const inaccessible = await api(`/conversations/${thread}/messages`, b, 'POST', { clientId: randomUUID(), body: '', photoId: photo.id }, 422);
  assert.ok(inaccessible.error);
  const quotedPhoto = await send('Retain quoted photo caption', { replyToId: sentPhoto.id }, b);
  const beforeExpiry = (await head()).changeCursor;
  await pool.query("UPDATE direct_messages SET created_at=now()-interval '7 days' WHERE id=$1", [sentPhoto.id]);
  await photoResponse(photo.id, a, 404); // denied before cleanup, at the server deadline
  let expired = (await head()).items.find(m => m.id === sentPhoto.id);
  assert.equal(expired.photo, null); assert.equal(expired.body, sentPhoto.body); assert.ok(expired.mediaExpired);
  await api('/message-media/cleanup', a, 'POST');
  assert.equal((await directPhotoObject(photo.id + '/image').exists())[0], false);
  assert.equal((await directPhotoObject(photo.id + '/source').exists())[0], false);
  const expiredChanges = (await api(`/conversations/${thread}/changes?after=${beforeExpiry}`, b)).items;
  assert.ok(expiredChanges.find(m => m.id === sentPhoto.id).mediaExpired);
  const quoteAfterExpiry = expiredChanges.find(m => m.id === quotedPhoto.id).reply;
  assert.equal(quoteAfterExpiry.photo, null); assert.equal(quoteAfterExpiry.body, sentPhoto.body); assert.ok(quoteAfterExpiry.mediaExpired);
  const expiredRetry = await send(sentPhoto.body, { clientId: photo.clientId, photoId: photo.id });
  assert.equal(expiredRetry.id, sentPhoto.id); assert.equal(expiredRetry.photo, null);

  // A still-valid signed source URL can recreate bytes; the final post-expiry
  // cleanup pass must remove them, including after the first deletion succeeded.
  await directPhotoObject(photo.id + '/source').save(original);
  await pool.query("UPDATE direct_message_uploads SET source_put_until=now()-interval '1 second',purged_at=now()-interval '2 seconds' WHERE id=$1", [photo.id]);
  await api('/message-media/cleanup', b, 'POST');
  assert.equal((await directPhotoObject(photo.id + '/source').exists())[0], false);

  const secondPhoto = await uploadedPhoto(), photoOnly = await send('', { clientId: secondPhoto.clientId, photoId: secondPhoto.id });
  await photoResponse(secondPhoto.id, b, 200);
  await api(`/conversations/${thread}/messages/${photoOnly.id}`, a, 'DELETE');
  await photoResponse(secondPhoto.id, b, 404);
  await api('/message-media/cleanup', a, 'POST');
  for (let attempt = 0; attempt < 20 && (await directPhotoObject(secondPhoto.id + '/image').exists())[0]; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await directPhotoObject(secondPhoto.id + '/image').exists())[0], false);

  const gif = { provider: 'klipy', id: 'hello-hi-662', title: 'Hello hi', width: 270, height: 151,
    url: 'https://static.klipy.com/ii/5d/9c/5d9c7caad7f44581e0e29f1ee3a8c6c3/42/95/hello-hi.gif',
    sourceUrl: 'https://klipy.com/gifs/hello-hi-662', attribution: 'Powered by KLIPY', license: null };
  const oldGif = await send('Keep the GIF caption', { gif }), youngGif = await send('', { gif });
  const textOnly = await send('Seven-day text is NOT ephemeral');
  await pool.query("UPDATE direct_messages SET created_at=now()-interval '8 days' WHERE id=ANY($1::uuid[])", [[oldGif.id, textOnly.id]]);
  await pool.query("UPDATE direct_messages SET created_at=now()-interval '7 days'+interval '1 minute' WHERE id=$1", [youngGif.id]);
  expired = (await head()).items.find(m => m.id === oldGif.id);
  assert.equal(expired.gif, null); assert.equal(expired.body, oldGif.body); assert.ok(expired.mediaExpired);
  await api('/message-media/cleanup', b, 'POST');
  const after = (await head()).items;
  assert.equal(after.find(m => m.id === textOnly.id).body, textOnly.body); assert.equal(after.find(m => m.id === textOnly.id).mediaExpired, false);
  assert.equal(after.find(m => m.id === youngGif.id).gif.url, gif.url);
  assert.equal(after.find(m => m.id === oldGif.id).gif, null);

  // Old read receipts/deletions are mutation-recovered outside the latest page.
  const old = await send('Old, loaded message');
  await pool.query(`INSERT INTO direct_messages(thread_id,sender_id,client_id,body) SELECT $1,$2,gen_random_uuid(),'Paging filler' FROM generate_series(1,140)`, [thread, users[0]]);
  const latest = await head();
  assert.ok(!latest.items.some(m => m.id === old.id));
  await api(`/conversations/${thread}/read`, b, 'PUT', { throughSequence: latest.items[0].sequence }, 204);
  const firstChangePage = await api(`/conversations/${thread}/changes?after=${latest.changeCursor}`, a);
  assert.equal(firstChangePage.hasMore, true);
  const readChange = (await allChanges(latest.changeCursor)).find(m => m.id === old.id);
  assert.ok(readChange.readAt);
  await api(`/conversations/${thread}/messages/${old.id}`, a, 'DELETE');
  const oldDeleted = (await allChanges(latest.changeCursor)).find(m => m.id === old.id);
  assert.ok(oldDeleted.deletedAt); assert.equal(oldDeleted.body, '');
  console.log(`PASS ${checks} private-media API checks: own-only deletion, shared tombstones, deleted replies, private compressed uploads, expiry/physical purge, preserved text, durable retries and old-message changes`);
} finally {
  for (const id of uploads) {
    // Delete only this run's known objects. Failed cleanup leaves the intent row.
    try {
      await directPhotoObject(id + '/source').delete({ ignoreNotFound: true });
      await directPhotoObject(id + '/image').delete({ ignoreNotFound: true });
      purged.push(id);
    } catch { console.error('Synthetic photo cleanup remains queued'); }
  }
  await pool.query('DELETE FROM conversations WHERE user_low=ANY($1::text[]) OR user_high=ANY($1::text[])', [users]);
  if (purged.length) await pool.query('DELETE FROM direct_message_uploads WHERE id=ANY($1::uuid[])', [purged]);
  await pool.query('DELETE FROM afilli_auth_sessions WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM afilli_auth_accounts WHERE user_id=ANY($1::text[])', [users]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [users]);
  await pool.end();
}
