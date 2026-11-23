import { Router, type IRouter } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { RequestLibraryGifUploadBody, GetGifLibraryQueryParams, GetGifLibraryResponse, CompleteLibraryGifUploadResponse } from '@workspace/api-zod';
import { route, parse, fail, requirePerson, uuid } from '../lib/community';
import { adminWrite, adminActor, audit } from '../lib/admin';
import { libraryGifObject, libraryGifUploadUrl, libraryGif, validateGifBytes, MAX_GIF_BYTES, type GifRecord } from '../lib/gif-library';

const router: IRouter = Router();
router.get('/gif-library', route(async (req, res) => {
  await requirePerson(req);
  const { offset = 0 } = parse(GetGifLibraryQueryParams, req.query);
  const rows = (await pool.query<GifRecord>('SELECT id,title,width,height FROM gif_library WHERE ready ORDER BY created_at DESC,id DESC LIMIT 13 OFFSET $1', [offset])).rows;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(GetGifLibraryResponse.parse({ items: rows.slice(0, 12).map(libraryGif), nextOffset: rows.length > 12 ? offset + 12 : null }));
}));
router.post('/admin/gif-uploads', route(async (req, res) => {
  await adminActor(req, pool, true);
  const input = parse(RequestLibraryGifUploadBody, req.body), title = input.title.trim();
  if (!title) return fail(400, 'GIF adı boş olamaz.');
  const row = await adminWrite(req, true, async (db, actor) => {
    const old = (await db.query<{ id: string; ready: boolean; size: number; title: string }>('SELECT id,ready,size,title FROM gif_library WHERE owner_id=$1 AND client_id=$2 FOR UPDATE', [actor.id, input.clientId])).rows[0];
    if (old) {
      if (old.size !== input.size || old.title !== title) return fail(409, 'Bu yükleme kimliği başka bir GIF için kullanılmış.');
      return old;
    }
    if ((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM gif_library WHERE owner_id=$1 AND created_at>now()-interval '24 hours'", [actor.id])).rows[0].n >= 100) return fail(429, 'Günlük 100 GIF yükleme sınırına ulaşıldı.');
    const id = randomUUID();
    await db.query('INSERT INTO gif_library(id,owner_id,client_id,title,size,object_path) VALUES($1,$2,$3,$4,$5,$6)', [id, actor.id, input.clientId, title, input.size, `gif-library/${id}`]);
    return { id, ready: false };
  });
  res.json({ id: row.id, ready: row.ready, uploadUrl: row.ready ? null : await libraryGifUploadUrl(row.id) });
}));
router.post('/admin/gif-uploads/:id/complete', route(async (req, res) => {
  await adminActor(req, pool, true);
  const id = uuid(req.params.id);
  const result = await adminWrite(req, true, async (db, actor) => {
    const row = (await db.query<GifRecord & { owner_id: string; ready: boolean; size: number }>('SELECT * FROM gif_library WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || row.owner_id !== actor.id) return fail(404, 'GIF yüklemesi bulunamadı.');
    if (row.ready) return libraryGif(row);
    const source = libraryGifObject(id, 'source');
    let bytes: Buffer;
    try {
      const [meta] = await source.getMetadata();
      if (Number(meta.size) !== row.size || row.size > MAX_GIF_BYTES) return fail(400, 'GIF boyutu yükleme kaydıyla eşleşmiyor.');
      // A still-valid PUT can replace staging data. Bound the download itself.
      [bytes] = await source.download({ start: 0, end: MAX_GIF_BYTES });
    } catch (error) {
      if (typeof error === 'object' && error && 'status' in error) throw error;
      return fail(400, 'GIF dosyası henüz yüklenemedi. Yeniden dene.');
    }
    if (bytes.length !== row.size) return fail(400, 'GIF dosya boyutu geçersiz.');
    const dimensions = await validateGifBytes(bytes);
    // Never serve mutable staging files; later PUTs cannot replace this asset.
    await libraryGifObject(id, 'asset').save(bytes, { resumable: false, contentType: 'image/gif', metadata: { cacheControl: 'private, no-store' } });
    await db.query('UPDATE gif_library SET ready=true,width=$2,height=$3 WHERE id=$1', [id, dimensions.width, dimensions.height]);
    await audit(db, actor.id, 'gif.publish', 'gif', id, 'Ortak GIF koleksiyonuna eklendi.', { title: row.title, size: bytes.length });
    return libraryGif({ ...row, ...dimensions });
  });
  res.json(CompleteLibraryGifUploadResponse.parse(result));
}));
router.get('/gif-library/:id/media', route(async (req, res) => {
  await requirePerson(req);
  const id = uuid(req.params.id);
  if (!(await pool.query('SELECT 1 FROM gif_library WHERE id=$1 AND ready', [id])).rowCount) return fail(404, 'GIF bulunamadı.');
  res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = libraryGifObject(id, 'asset').createReadStream();
  stream.once('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
  res.once('close', () => stream.destroy()); stream.pipe(res);
}));
export default router;
