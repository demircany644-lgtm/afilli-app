import { Router, type IRouter } from 'express';
import { createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { StartConversationBody, SendConversationMessageBody, SetConversationTypingBody, ReadConversationBody } from '@workspace/api-zod';
import { route, requirePerson, parse, fail, uuid, transaction } from '../lib/community';
import { personId, pageCursor } from '../lib/social';
import { bookNotifications, readBookNotification } from '../lib/book-notifications';
import { member, threads, messageData, sequence, validateGif } from '../lib/direct-messages';
import { directEvent, openDirectEvents } from '../lib/direct-events';
import { purgeDirectPhotoQueue } from '../lib/direct-media';
import { resolveLibraryGif } from '../lib/gif-library';

const router: IRouter = Router();
router.get('/message-events', route(async (req, res) => {
  const actor = await requirePerson(req);
  await openDirectEvents(req, res, actor.id);
}));
router.get('/conversations', route(async (req, res) => {
  const actor = await requirePerson(req); res.json(await threads(actor.id));
}));
router.post('/conversations', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(StartConversationBody, req.body), peer = personId(input.peerId);
  if (peer === actor.id) return fail(400, 'Kendine mesaj gönderemezsin.');
  if (!(await pool.query('SELECT 1 FROM community_users WHERE id=$1', [peer])).rowCount) return fail(404, 'Profil bulunamadı.');
  const row = (await pool.query<{ id: string }>(`INSERT INTO conversations(user_low,user_high) VALUES(least($1::text,$2::text),greatest($1::text,$2::text))
    ON CONFLICT(user_low,user_high) DO UPDATE SET user_low=excluded.user_low RETURNING id`, [actor.id, peer])).rows[0];
  res.json((await threads(actor.id, row.id))[0]);
}));
router.get('/conversations/:id', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id); await member(id, actor.id);
  res.json((await threads(actor.id, id))[0]);
}));
router.get('/conversations/:id/messages', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  await member(id, actor.id);
  // Capture BEFORE selecting the head, so a concurrent deletion cannot fall
  // between the displayed snapshot and its change-recovery starting point.
  const changeCursor = (await pool.query<{ cursor: string }>('SELECT coalesce(max(change_sequence),0)::text AS cursor FROM direct_messages WHERE thread_id=$1', [id])).rows[0].cursor;
  let filter = '', boundary: unknown[] = [];
  if (typeof req.query.cursor === 'string' && req.query.cursor.startsWith('s:')) {
    filter = 'AND sequence<$2::bigint'; boundary = [sequence(req.query.cursor.slice(2))];
  } else if (req.query.cursor) {
    const cursor = pageCursor(req.query.cursor);
    filter = 'AND (created_at,id)<($2::timestamptz,$3::uuid)'; boundary = [cursor.date, cursor.id];
  }
  const rows = (await pool.query<{ id: string; sequence: string }>(`SELECT id,sequence::text FROM direct_messages WHERE thread_id=$1 ${filter}
    ORDER BY direct_messages.sequence DESC LIMIT 31`, [id, ...boundary])).rows;
  const page = rows.slice(0, 30), last = page.at(-1);
  res.json({ items: await messageData(page.map(item => item.id)), nextCursor: rows.length > 30 && last ? `s:${last.sequence}` : null, changeCursor });
}));
router.get('/conversations/:id/changes', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), after = sequence(req.query.after);
  await member(id, actor.id);
  const rows = (await pool.query<{ id: string; change_sequence: string }>(`SELECT id,change_sequence::text FROM direct_messages
    WHERE thread_id=$1 AND change_sequence>$2::bigint ORDER BY direct_messages.change_sequence LIMIT 101`, [id, after])).rows;
  const page = rows.slice(0, 100);
  res.json({ items: await messageData(page.map(row => row.id)), nextAfter: page.at(-1)?.change_sequence ?? after, hasMore: rows.length > 100 });
}));
router.delete('/conversations/:id/messages/:messageId', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), messageId = uuid(req.params.messageId);
  await transaction(async client => {
    const pair = await member(id, actor.id, client, true);
    const found = (await client.query<{ sender_id: string; deleted_at: Date | null; photo_id: string | null }>(
      'SELECT sender_id,deleted_at,photo_id FROM direct_messages WHERE id=$1 AND thread_id=$2 FOR UPDATE', [messageId, id])).rows[0];
    if (!found || found.sender_id !== actor.id) return fail(403, 'Yalnızca kendi mesajını silebilirsin.');
    if (found.deleted_at) return;
    await client.query(`UPDATE direct_messages SET body='',gif=NULL,deleted_at=clock_timestamp(),change_sequence=nextval('direct_message_change_seq') WHERE id=$1`, [messageId]);
    await client.query("UPDATE direct_messages SET change_sequence=nextval('direct_message_change_seq') WHERE thread_id=$1 AND reply_to_id=$2", [id, messageId]);
    if (found.photo_id) await client.query('UPDATE direct_message_uploads SET delete_requested_at=coalesce(delete_requested_at,clock_timestamp()) WHERE id=$1', [found.photo_id]);
    await directEvent(client, pair, id, 'sync');
  });
  res.json((await messageData([messageId]))[0]);
  void purgeDirectPhotoQueue().catch(() => req.log.warn('Silinen mesajın fotoğraf temizliği yeniden denenecek'));
}));
router.get('/conversations/:id/sync', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), after = sequence(req.query.after);
  await member(id, actor.id);
  const rows = (await pool.query<{ id: string; sequence: string }>(`SELECT id,sequence::text FROM direct_messages
    WHERE thread_id=$1 AND sequence>$2::bigint ORDER BY direct_messages.sequence LIMIT 101`, [id, after])).rows;
  const page = rows.slice(0, 100);
  const items = (await messageData(page.map(item => item.id))).reverse();
  res.json({ items, nextAfter: page.at(-1)?.sequence ?? after, hasMore: rows.length > 100 });
}));
router.post('/conversations/:id/messages', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(SendConversationMessageBody, req.body);
  const body = input.body.trim(), reply = input.replyToId ?? null;
  if (!body && !input.gif && !input.photoId) return fail(400, 'Boş mesaj gönderilemez.');
  if (input.gif && input.photoId) return fail(400, 'Tek gönderimde bir fotoğraf veya GIF seç.');
  const payload = [body, reply, input.gif?.provider ?? null, input.gif?.id ?? null, input.gif?.url ?? null];
  if (input.photoId) payload.push(input.photoId); // Preserve legacy text/GIF retry hashes.
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const message = await transaction(async client => {
    const pair = await member(id, actor.id, client, true);
    const previous = (await client.query<{ id: string; body: string; payload_hash: string | null }>(
      'SELECT id,body,payload_hash FROM direct_messages WHERE thread_id=$1 AND sender_id=$2 AND client_id=$3', [id, actor.id, input.clientId])).rows[0];
    if (previous) {
      if (previous.payload_hash ? previous.payload_hash !== hash : previous.body !== body || reply || input.gif) return fail(409, 'Bu gönderim kimliği başka bir mesaja ait. İlk mesaj korunuyor.');
      return previous.id;
    }
    if (reply && !(await client.query('SELECT id FROM direct_messages WHERE id=$1 AND thread_id=$2 AND deleted_at IS NULL FOR KEY SHARE', [reply, id])).rowCount)
      return fail(422, 'Yanıtlanan mesaj silinmiş. Alıntıyı kaldırarak gönderebilirsin.', 'REPLY_UNAVAILABLE');
    if (input.photoId) {
      const photo = (await client.query(`SELECT id FROM direct_message_uploads WHERE id=$1 AND thread_id=$2 AND owner_id=$3 AND client_id=$4
        AND ready AND attached_at IS NULL AND delete_requested_at IS NULL AND purged_at IS NULL FOR UPDATE`, [input.photoId, id, actor.id, input.clientId])).rows[0];
      if (!photo) return fail(422, 'Fotoğraf hazır değil veya bu gönderime ait değil.', 'PHOTO_UNAVAILABLE');
      await client.query('UPDATE direct_message_uploads SET attached_at=clock_timestamp() WHERE id=$1', [input.photoId]);
    }
    const gif = input.gif?.provider === 'afilli' ? await resolveLibraryGif(input.gif, client) : validateGif(input.gif);
    const recent = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM direct_messages WHERE sender_id=$1 AND created_at>now()-interval '1 minute'", [actor.id])).rows[0];
    if (recent.count >= 60) return fail(429, 'Çok hızlı mesaj gönderiyorsun. Biraz bekleyip tekrar dene.');
    const row = (await client.query<{ id: string }>(`INSERT INTO direct_messages(thread_id,sender_id,client_id,body,payload_hash,reply_to_id,has_reply,gif,photo_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id`, [id, actor.id, input.clientId, body, hash, reply, !!reply, gif ? JSON.stringify(gif) : null, input.photoId ?? null])).rows[0];
    const typing = pair.user_low === actor.id ? 'low_typing_until' : 'high_typing_until';
    await client.query(`UPDATE conversations SET updated_at=clock_timestamp(),${typing}=NULL WHERE id=$1`, [id]);
    await directEvent(client, pair, id, 'message');
    return row.id;
  });
  res.status(201).json((await messageData([message]))[0]);
}));
router.put('/conversations/:id/read', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(ReadConversationBody, req.body ?? {});
  const through = input?.throughSequence ? sequence(input.throughSequence) : null;
  await transaction(async client => {
    const pair = await member(id, actor.id, client, true);
    const result = await client.query(`UPDATE direct_messages SET read_at=clock_timestamp(),change_sequence=nextval('direct_message_change_seq') WHERE thread_id=$1 AND sender_id<>$2 AND read_at IS NULL AND deleted_at IS NULL
      AND ($3::bigint IS NULL OR sequence<=$3::bigint)`, [id, actor.id, through]);
    if (result.rowCount) await directEvent(client, pair, id, 'read');
    await client.query("UPDATE social_notifications SET read=true WHERE thread_id=$1 AND recipient_id=$2 AND kind='message'", [id, actor.id]);
  });
  res.status(204).end();
}));
router.put('/conversations/:id/typing', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(SetConversationTypingBody, req.body);
  await transaction(async client => {
    const pair = await member(id, actor.id, client, true);
    const column = pair.user_low === actor.id ? 'low_typing_until' : 'high_typing_until';
    await client.query(`UPDATE conversations SET ${column}=CASE WHEN $2 THEN now()+interval '6 seconds' ELSE NULL END WHERE id=$1`, [id, input.typing]);
    await directEvent(client, pair, id, 'typing');
  });
  res.status(204).end();
}));
router.get('/social-notifications', route(async (req, res) => {
  const actor = await requirePerson(req); res.json((await bookNotifications(actor.id)).items);
}));
router.patch('/social-notifications/:id', route(async (req, res) => {
  const actor = await requirePerson(req); await readBookNotification(actor.id, uuid(req.params.id)); res.status(204).end();
}));
export default router;
