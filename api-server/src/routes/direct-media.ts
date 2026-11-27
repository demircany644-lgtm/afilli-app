import { Router, type IRouter } from 'express';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool } from '@workspace/db';
import { RequestDirectPhotoUploadBody } from '@workspace/api-zod';
import { route, requirePerson, parse, fail, uuid, transaction } from '../lib/community';
import { member } from '../lib/direct-messages';
import { directPhotoObject, directPhotoUploadUrl } from '../lib/bulletin-storage';
import { expireDirectMedia, purgeDirectPhotoQueue } from '../lib/direct-media';
import { checkAndRecordProhibitedImage, prohibitedImageFailure } from '../lib/prohibited-images';

const router: IRouter = Router();
router.post('/conversations/:id/photo-uploads', route(async (req, res) => {
  const actor = await requirePerson(req), thread = uuid(req.params.id), input = parse(RequestDirectPhotoUploadBody, req.body);
  const upload = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['direct-photo-upload:' + actor.id]);
    await member(thread, actor.id, client, true);
    const previous = (await client.query<{ id: string; ready: boolean; size: number; delete_requested_at: Date | null }>(
      'SELECT * FROM direct_message_uploads WHERE thread_id=$1 AND owner_id=$2 AND client_id=$3 FOR UPDATE', [thread, actor.id, input.clientId])).rows[0];
    if (previous) {
      if (previous.delete_requested_at) return fail(410, 'Fotoğrafın süresi dolmuş. Yeniden seçerek gönder.');
      if (previous.size !== input.size) return fail(409, 'Bu gönderimin fotoğrafı değiştirilemez.');
      return previous;
    }
    const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM direct_message_uploads WHERE owner_id=$1 AND created_at>now()-interval '24 hours'", [actor.id]);
    if (rows[0].n >= 200) return fail(429, 'Günlük fotoğraf sınırına ulaştın. Daha sonra tekrar dene.');
    const id = randomUUID();
    await client.query('INSERT INTO direct_message_uploads(id,thread_id,owner_id,client_id,size) VALUES($1,$2,$3,$4,$5)', [id, thread, actor.id, input.clientId, input.size]);
    return { id, ready: false };
  });
  const expiresAt = Date.now() + 900_000;
  if (!upload.ready && !(await pool.query(`UPDATE direct_message_uploads SET source_put_until=greatest(source_put_until,$2)
    WHERE id=$1 AND delete_requested_at IS NULL RETURNING id`, [upload.id, new Date(expiresAt + 60_000)])).rowCount) return fail(410, 'Fotoğraf silinmiş; yeniden seç.');
  res.json({ id: upload.id, ready: upload.ready, uploadUrl: upload.ready ? null : await directPhotoUploadUrl(upload.id, expiresAt) });
}));
router.post('/direct-photo-uploads/:id/complete', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  const result = await transaction(async client => {
    const row = (await client.query<{ thread_id: string | null; owner_id: string | null; size: number; ready: boolean; width: number; height: number; delete_requested_at: Date | null }>(
      'SELECT * FROM direct_message_uploads WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || row.owner_id !== actor.id || !row.thread_id) return fail(404, 'Fotoğraf bulunamadı.');
    await member(row.thread_id, actor.id, client);
    if (row.delete_requested_at) return fail(410, 'Fotoğraf silinmiş.');
    if (row.ready) return { id, width: row.width, height: row.height };
    const source = directPhotoObject(`${id}/source`);
    const [meta] = await source.getMetadata();
    if (Number(meta.size) !== row.size || row.size > 2097152) return fail(400, 'Fotoğraf boyutu geçersiz.');
    // Bound the actual download too: a signed source PUT could race the metadata
    // check and replace it with a much larger object.
    const [bytes] = await source.download({ start: 0, end: 2097152 });
    if (bytes.length !== row.size || bytes.length > 2097152) return fail(400, 'Fotoğraf boyutu geçersiz.');
    const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 76 });
    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    const hit = await checkAndRecordProhibitedImage(actor.id, 'private_message', data);
    if (hit) prohibitedImageFailure(hit.id);
    await directPhotoObject(`${id}/image`).save(data, { resumable: false, contentType: 'image/jpeg', metadata: { cacheControl: 'private, no-store' } });
    await client.query('UPDATE direct_message_uploads SET ready=true,width=$2,height=$3 WHERE id=$1', [id, info.width, info.height]);
    return { id, width: info.width, height: info.height };
  });
  res.json(result);
}));
router.get('/direct-media/:id', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  const permitted = await pool.query(`SELECT 1 FROM direct_message_uploads p
    JOIN direct_messages m ON m.photo_id=p.id JOIN conversations c ON c.id=m.thread_id
    WHERE p.id=$1 AND p.ready AND p.delete_requested_at IS NULL AND p.purged_at IS NULL
    AND m.deleted_at IS NULL AND m.media_expired_at IS NULL AND m.created_at>now()-interval '7 days'
    AND (c.user_low=$2 OR c.user_high=$2)`, [id, actor.id]);
  if (!permitted.rowCount) return fail(404, 'Fotoğraf bulunamadı veya süresi doldu.');
  res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Pragma', 'no-cache');
  const stream = directPhotoObject(`${id}/image`).createReadStream();
  stream.once('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
  res.once('close', () => stream.destroy());
  stream.pipe(res);
}));
router.post('/message-media/cleanup', route(async (req, res) => {
  const actor = await requirePerson(req);
  const moreExpired = await expireDirectMedia(actor.id);
  const result = await purgeDirectPhotoQueue();
  res.json({ ...result, hasMore: moreExpired || result.hasMore });
}));
export default router;
