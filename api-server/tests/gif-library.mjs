import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
import { libraryGifObject, validateGifBytes } from '../src/lib/gif-library.ts';

if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw Error('Synthetic development checks only');
const tag = randomUUID().replaceAll('-', ''), base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const users = ['superadmin', 'user', 'admin', 'superadmin'].map((role, i) => ({ id: `af_gif_${tag}_${i}`, role, email: `gif-${tag}-${i}@example.com` }));
const password = `Synthetic ${randomUUID()}`, uploaded = [];
// Two distinct frames, original GIF bytes; no flattened preview fixtures.
const animated = Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
let checks = 0;
async function api(path, token, method = 'GET', data, status = 200) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal(res.status, status, `${method} ${path}: unexpected ${res.status}`); checks++;
  return status === 204 ? null : res.json();
}
async function media(id, token, status = 200) {
  const res = await fetch(`${base}/gif-library/${id}/media`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal(res.status, status); checks++;
  if (status !== 200) return;
  assert.equal(res.headers.get('content-type'), 'image/gif');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(bytes, animated);
  assert.equal((await sharp(bytes, { animated: true }).metadata()).pages, 2);
}
try {
  await validateGifBytes(animated); checks++;
  await assert.rejects(() => validateGifBytes(Buffer.from('GIF89a truncated'))); checks++;
  await assert.rejects(() => validateGifBytes(Buffer.alloc(5242881))); checks++;
  const hash = await hashPassword(password);
  const tokens = [];
  for (const u of users) {
    await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [u.id, `GifDeneme-${u.role}-${tag}`]);
    await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash,role) VALUES($1,$2,$3,$4)', [u.id, u.email, hash, u.role]);
    tokens.push((await api('/auth/login', null, 'POST', { email: u.email, password })).token);
  }
  const [root, reader, admin, otherRoot] = tokens;
  const input = { clientId: randomUUID(), title: 'Animated synthetic GIF', size: animated.length };
  await api('/admin/gif-uploads', null, 'POST', input, 401);
  await api('/admin/gif-uploads', reader, 'POST', input, 403);
  await api('/admin/gif-uploads', admin, 'POST', input, 403);
  await api('/admin/gif-uploads', root, 'POST', { ...input, size: 5242881 }, 400);
  await api('/admin/gif-uploads', root, 'POST', { ...input, title: ' ' }, 400);
  await api('/gif-library', null, 'GET', undefined, 401);
  await api('/gif-library?offset=-1', reader, 'GET', undefined, 400);
  const upload = await api('/admin/gif-uploads', root, 'POST', input); uploaded.push(upload.id);
  assert.equal((await api('/admin/gif-uploads', root, 'POST', input)).id, upload.id);
  await api('/admin/gif-uploads', root, 'POST', { ...input, title: 'Changed retry' }, 409);
  await media(upload.id, reader, 404);
  await api(`/admin/gif-uploads/${upload.id}/complete`, admin, 'POST', undefined, 403);
  await api(`/admin/gif-uploads/${upload.id}/complete`, otherRoot, 'POST', undefined, 404);
  await api(`/admin/gif-uploads/${upload.id}/complete`, root, 'POST', undefined, 400); // lost/missing PUT is retryable
  const put = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/gif' }, body: animated });
  assert.equal(put.status, 200); checks++;
  const gif = await api(`/admin/gif-uploads/${upload.id}/complete`, root, 'POST');
  assert.equal(gif.provider, 'afilli'); assert.equal(gif.url, `afilli://gif-library/${upload.id}`);
  const completedAgain = await api('/admin/gif-uploads', root, 'POST', input);
  assert.equal(completedAgain.id, upload.id); assert.equal(completedAgain.ready, true); assert.equal(completedAgain.uploadUrl, null);
  assert.deepEqual(await api(`/admin/gif-uploads/${upload.id}/complete`, root, 'POST'), gif);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM gif_library WHERE owner_id=$1 AND client_id=$2', [users[0].id, input.clientId])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM admin_audit WHERE target_id=$1 AND action='gif.publish'", [gif.id])).rows[0].n, 1);
  assert.ok((await api('/gif-library', reader)).items.some(x => x.id === gif.id));
  await media(gif.id, reader); await media(gif.id, admin); await media(gif.id, null, 401);
  // A later PUT cannot poison a published asset.
  await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/gif' }, body: Buffer.from('not a GIF') });
  await api(`/admin/gif-uploads/${upload.id}/complete`, root, 'POST');
  await media(gif.id, reader);
  const badBytes = Buffer.from('not-an-image'), bad = await api('/admin/gif-uploads', root, 'POST', { clientId: randomUUID(), title: 'Invalid', size: badBytes.length });
  uploaded.push(bad.id);
  await fetch(bad.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/gif' }, body: badBytes });
  await api(`/admin/gif-uploads/${bad.id}/complete`, root, 'POST', undefined, 400);
  await media(bad.id, reader, 404);

  const thread = (await api('/conversations', root, 'POST', { peerId: users[1].id })).id;
  const send = (body, extras = {}, who = root, status = 201) => api(`/conversations/${thread}/messages`, who, 'POST', { clientId: randomUUID(), body, ...extras }, status);
  await send('', { gif: { ...gif, id: bad.id } }, root, 422);
  await send('', { gif: { ...gif, id: randomUUID() } }, root, 422);
  const sent = await send('Keep this caption', { gif: { ...gif, url: 'https://evil.invalid/track', width: 1000, title: 'spoof' } });
  assert.deepEqual(sent.gif, gif); // Canonical server fields, never untrusted URLs/dimensions.
  assert.equal((await send(sent.body, { clientId: sent.clientId, gif: { ...gif, url: 'https://evil.invalid/track', width: 1000, title: 'spoof' } })).id, sent.id);
  const reply = await send('Keep this reply', { replyToId: sent.id }, reader);
  const text = await send('Written messages never expire');
  await pool.query("UPDATE direct_messages SET created_at=now()-interval '8 days' WHERE id=ANY($1::uuid[])", [[sent.id, text.id]]);
  const beforeCleanup = await api(`/conversations/${thread}/messages`, reader);
  const expired = beforeCleanup.items.find(m => m.id === sent.id);
  assert.equal(expired.gif, null); assert.ok(expired.mediaExpired); assert.equal(expired.body, sent.body);
  assert.equal(beforeCleanup.items.find(m => m.id === reply.id).reply.gif, null);
  assert.equal(beforeCleanup.items.find(m => m.id === text.id).body, text.body);
  await api('/message-media/cleanup', reader, 'POST');
  assert.ok((await api('/gif-library', reader)).items.some(g => g.id === gif.id));
  await media(gif.id, reader); // Shared original survives private-message expiry.
  const deletable = await send('', { gif });
  await api(`/conversations/${thread}/messages/${deletable.id}`, reader, 'DELETE', undefined, 403);
  const tombstone = await api(`/conversations/${thread}/messages/${deletable.id}`, root, 'DELETE');
  assert.ok(tombstone.deletedAt); assert.equal(tombstone.gif, null);
  await media(gif.id, reader);
  // Current role is rechecked even for already-created uploads.
  await pool.query("UPDATE afilli_auth_accounts SET role='user' WHERE user_id=$1", [users[0].id]);
  await api('/admin/gif-uploads', root, 'POST', { ...input, clientId: randomUUID() }, 403);
  await api(`/admin/gif-uploads/${upload.id}/complete`, root, 'POST', undefined, 403);
  process.stdout.write(`${checks} GIF collection checks passed; two animated frames preserved; only synthetic data used.\n`);
} finally {
  for (const id of uploaded) for (const kind of ['source', 'asset']) await libraryGifObject(id, kind).delete({ ignoreNotFound: true });
  await pool.query('DELETE FROM gif_library WHERE owner_id=ANY($1::text[])', [users.map(u => u.id)]);
  await pool.query('DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])', [users.map(u => u.id)]);
  await pool.query('DELETE FROM conversations WHERE user_low=ANY($1::text[]) OR user_high=ANY($1::text[])', [users.map(u => u.id)]);
  await pool.query('DELETE FROM afilli_auth_sessions WHERE user_id=ANY($1::text[])', [users.map(u => u.id)]);
  await pool.query('DELETE FROM afilli_auth_accounts WHERE user_id=ANY($1::text[])', [users.map(u => u.id)]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1::text[])', [users.map(u => u.id)]);
  await pool.end();
}
