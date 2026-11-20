import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { hashPassword } from '../src/lib/auth-crypto.ts';
if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Synthetic development sessions only');
const tag = randomUUID().replaceAll('-', ''), base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const users = ['a', 'b', 'c'].map(x => `af_dm_${tag}_${x}`), password = `Synthetic ${randomUUID()}`;
const streams = [];
let checks = 0;
async function api(path, token = null, method = 'GET', data, expected = 200, headers = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Afilli-Client': 'native',
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal(res.status, expected, `${method} ${path}: ${await res.clone().text()}`); checks++;
  return expected === 204 ? null : res.json();
}
async function stream(token) {
  const control = new AbortController(), events = [];
  const res = await fetch(base + '/message-events', { signal: control.signal, headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const task = (async () => {
    const reader = res.body.getReader(), decoder = new TextDecoder(); let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        text += decoder.decode(value, { stream: true });
        let end;
        while ((end = text.indexOf('\n\n')) >= 0) {
          const frame = text.slice(0, end); text = text.slice(end + 2);
          for (const line of frame.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch (e) { if (!control.signal.aborted) throw e; }
  })();
  const result = { events, close: async () => { control.abort(); await task; } };
  streams.push(result);
  await until(() => events.some(e => e.kind === 'ready'));
  return result;
}
async function until(fn) {
  const end = Date.now() + 7000;
  while (!fn()) { if (Date.now() > end) throw new Error('Server event did not arrive through the preview proxy'); await new Promise(r => setTimeout(r, 25)); }
}
try {
  const hash = await hashPassword(password);
  for (const [i, id] of users.entries()) {
    await pool.query('INSERT INTO community_users(id,nickname) VALUES($1,$2)', [id, `MesajDenetim${i}-${tag}`]);
    await pool.query('INSERT INTO afilli_auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)', [id, `dm-${i}-${tag}@example.com`, hash]);
  }
  const sessions = [];
  for (let i = 0; i < 3; i++) sessions.push(await api('/auth/login', null, 'POST', { email: `dm-${i}-${tag}@example.com`, password }));
  const [a, b, c] = sessions.map(s => s.token);
  const thread = (await api('/conversations', a, 'POST', { peerId: users[1] })).id;
  const other = (await api('/conversations', a, 'POST', { peerId: users[2] })).id;
  const [sa, sb, sc] = await Promise.all([stream(a), stream(b), stream(c)]);
  await api('/message-events', null, 'GET', undefined, 401);
  await api('/message-events', a, 'GET', undefined, 401, { 'X-Afilli-Actor': users[1] });
  const input = { clientId: randomUUID(), body: 'Kalıcı özel ilk mesaj' };
  const [first, duplicate] = await Promise.all([api(`/conversations/${thread}/messages`, a, 'POST', input, 201), api(`/conversations/${thread}/messages`, a, 'POST', input, 201)]);
  assert.equal(first.id, duplicate.id); assert.equal(first.clientId, input.clientId); assert.match(first.sequence, /^[1-9]\d*$/);
  await Promise.all([until(() => sa.events.some(e => e.threadId === thread && e.kind === 'message')),
    until(() => sb.events.some(e => e.threadId === thread && e.kind === 'message'))]);
  assert.equal(sc.events.filter(e => e.threadId === thread).length, 0);
  assert.ok(!JSON.stringify(sb.events).includes(input.body)); // hints contain no private content
  assert.equal((await api('/book-notifications', b)).unreadCount, 0);
  assert.equal((await api('/conversations', b)).find(t => t.id === thread).unreadCount, 1);
  await api(`/conversations/${thread}/messages`, a, 'POST', { ...input, body: 'Changed payload' }, 409);
  await api(`/conversations/${thread}/sync?after=0`, c, 'GET', undefined, 404);
  await api(`/conversations/${thread}/messages`, c, 'POST', { clientId: randomUUID(), body: 'Unauthorized' }, 404);
  const quoted = await api(`/conversations/${thread}/messages`, b, 'POST', { clientId: randomUUID(), body: 'Alıntılı yanıt', replyToId: first.id }, 201);
  assert.equal(quoted.reply.id, first.id); assert.equal(quoted.reply.body, input.body); assert.equal(quoted.reply.sender.id, users[0]);
  await api(`/conversations/${other}/messages`, a, 'POST', { clientId: randomUUID(), body: 'Cross-thread quote', replyToId: first.id }, 422);
  await api(`/conversations/${thread}/messages`, a, 'POST', { clientId: randomUUID(), body: 'Missing quote', replyToId: randomUUID() }, 422);
  await api(`/conversations/${thread}/typing`, b, 'PUT', { typing: true }, 204);
  await until(() => sa.events.some(e => e.kind === 'typing' && e.threadId === thread));
  // Same sender/clientId in another thread is a different legitimate message.
  await api(`/conversations/${other}/messages`, a, 'POST', input, 201);
  await sb.close();
  await pool.query(`INSERT INTO direct_messages(thread_id,sender_id,client_id,body,created_at)
    SELECT $1,$2,gen_random_uuid(),'Kaçırılan mesaj '||n,now()-interval '1 hour' FROM generate_series(1,155) n`, [thread, users[0]]);
  const liveAgain = await stream(b); assert.ok(liveAgain.events.some(e => e.kind === 'ready'));
  let after = first.sequence, recovered = [];
  while (true) {
    const page = await api(`/conversations/${thread}/sync?after=${after}`, b);
    recovered.push(...page.items); after = page.nextAfter;
    if (!page.hasMore) break;
  }
  assert.equal(recovered.length, 156); assert.equal(new Set(recovered.map(m => m.id)).size, 156);
  for (let i = 1; i < recovered.length; i++) assert.ok(BigInt(recovered[i].sequence) > BigInt(recovered[i - 1].sequence));
  await api(`/conversations/${thread}/sync?after=9223372036854775808`, b, 'GET', undefined, 400);
  await api(`/conversations/${thread}/sync?after=-1`, b, 'GET', undefined, 400);
  let cursor = null, all = [];
  do {
    const page = await api(`/conversations/${thread}/messages${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`, b);
    all.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(all.length, 157); assert.equal(new Set(all.map(m => m.id)).size, 157);
  await api(`/conversations/${thread}/read`, b, 'PUT', { throughSequence: first.sequence }, 204);
  assert.equal((await api('/conversations', b)).find(t => t.id === thread).unreadCount, 155);
  await until(() => sa.events.some(e => e.kind === 'read' && e.threadId === thread));
  await api(`/conversations/${thread}/read`, c, 'PUT', {}, 404);
  await api(`/conversations/${thread}/read`, b, 'PUT', { throughSequence: after }, 204);
  assert.equal((await api('/conversations', b)).find(t => t.id === thread).unreadCount, 0);
  // A deleted quote keeps only an unavailable marker, not a copy of deleted text.
  await pool.query('DELETE FROM direct_messages WHERE id=$1', [first.id]);
  const qrow = await pool.query('SELECT reply_to_id,has_reply FROM direct_messages WHERE id=$1', [quoted.id]);
  assert.equal(qrow.rows[0].reply_to_id, null); assert.equal(qrow.rows[0].has_reply, true);
  const retriedQuote = await api(`/conversations/${thread}/messages`, b, 'POST', { clientId: quoted.clientId, body: quoted.body, replyToId: first.id }, 201);
  assert.deepEqual(retriedQuote.reply, { id: null, available: false, sender: null, body: null, gif: null, photo: null });
  await api(`/conversations/${thread}/messages`, b, 'POST', { clientId: randomUUID(), body: '' }, 400);
  const badGif = { provider: 'klipy', id: 'synthetic', title: 'No remote request', url: 'https://attacker.example/track.gif',
    width: 100, height: 100, sourceUrl: 'https://klipy.com/gifs/synthetic', attribution: 'Powered by KLIPY', license: null };
  await api(`/conversations/${thread}/messages`, b, 'POST', { clientId: randomUUID(), body: '', gif: badGif }, 400);
  // Serialization only; no provider API/media is fetched from this server test.
  const gif = { ...badGif, id: 'hello-hi-662', title: 'Hello',
    url: 'https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/y6iepZM7.gif?preserve=delivery',
    sourceUrl: 'https://klipy.com/gifs/hello-hi-662' };
  const gifInput = { clientId: randomUUID(), body: '', gif, replyToId: quoted.id };
  const gifSent = await api(`/conversations/${thread}/messages`, b, 'POST', gifInput, 201);
  assert.deepEqual(gifSent.gif, gif); assert.equal(gifSent.reply.id, quoted.id);
  assert.equal((await api(`/conversations/${thread}/messages`, b, 'POST', gifInput, 201)).id, gifSent.id);
  assert.equal((await api(`/conversations/${thread}/messages`, a)).items[0].gif.url, gif.url);
  await api('/auth/logout', b, 'POST', undefined, 204);
  await api(`/conversations/${thread}/messages`, b, 'GET', undefined, 401);
  console.log(`PASS ${checks} private-message API checks, concurrent sends, actual SSE through proxy, reconnect recovery, quote deletion and authorization.`);
} finally {
  await Promise.allSettled(streams.map(s => s.close()));
  await pool.query('DELETE FROM conversations WHERE user_low=ANY($1) OR user_high=ANY($1)', [users]);
  await pool.query('DELETE FROM afilli_auth_sessions WHERE user_id=ANY($1)', [users]);
  await pool.query('DELETE FROM afilli_auth_accounts WHERE user_id=ANY($1)', [users]);
  await pool.query('DELETE FROM community_users WHERE id=ANY($1)', [users]);
  await pool.end();
}
