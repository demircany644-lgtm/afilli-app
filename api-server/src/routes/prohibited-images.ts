import { Router, type IRouter } from 'express';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool } from '@workspace/db';
import {
  SendProhibitedImageContactMessageBody, RequestProhibitedImageUploadBody,
  DecideProhibitedImageAttemptBody,
} from '@workspace/api-zod';
import { adminActor, adminWrite, audit, reasonText } from '../lib/admin';
import { fail, parse, requirePerson, route, transaction, uuid } from '../lib/community';
import { moderationImageAccessUrl, moderationObject, moderationUploadUrl } from '../lib/bulletin-storage';
import { imagePerceptualHashes } from '../lib/prohibited-images';

const router: IRouter = Router();
const MAX_REFERENCES = 6;
const MIN_REFERENCES = 5;

function imageType(value: string) {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

router.get('/admin/prohibited-images', route(async (req, res) => {
  await adminActor(req, pool, true);
  const rows = await pool.query<{ id: string; ready: boolean; createdAt: Date }>(
    `SELECT id,ready,created_at AS "createdAt" FROM prohibited_image_references ORDER BY created_at,id`,
  );
  const items = await Promise.all(rows.rows.map(async row => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    imageUrl: row.ready ? await moderationImageAccessUrl(`references/${row.id}.jpg`) : null,
  })));
  res.json({ items, readyCount: items.filter(item => item.ready).length, minimum: MIN_REFERENCES, maximum: MAX_REFERENCES });
}));

router.post('/admin/prohibited-image-uploads', route(async (req, res) => {
  const input = parse(RequestProhibitedImageUploadBody, req.body);
  if (!imageType(input.contentType) || input.size < 1 || input.size > 10 * 1024 * 1024) {
    return fail(400, 'JPEG, PNG veya WebP fotoğrafı seç; dosya en fazla 10 MB olabilir.');
  }
  const upload = await adminWrite(req, true, async (db, actor) => {
    const count = Number((await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM prohibited_image_references',
    )).rows[0]?.count ?? 0);
    if (count >= MAX_REFERENCES) return fail(409, 'En fazla 6 yasaklı referans görseli bulunabilir.');
    const id = randomUUID();
    await db.query(`INSERT INTO prohibited_image_references(id,created_by,content_type,size)
      VALUES($1,$2,$3,$4)`, [id, actor.id, input.contentType, input.size]);
    return { id };
  });
  res.json({ ...upload, uploadUrl: await moderationUploadUrl(upload.id) });
}));

router.post('/admin/prohibited-image-uploads/:id/complete', route(async (req, res) => {
  const actor = await adminActor(req, pool, true), id = uuid(req.params.id);
  const row = (await pool.query<{ created_by: string | null; content_type: string; size: number; ready: boolean }>(
    'SELECT created_by,content_type,size,ready FROM prohibited_image_references WHERE id=$1', [id],
  )).rows[0];
  if (!row || row.created_by !== actor.id) return fail(404, 'Yükleme bulunamadı.');
  if (row.ready) return res.json({ id, ready: true });
  const source = moderationObject(`sources/${id}`);
  let bytes: Buffer;
  try {
    const [metadata] = await source.getMetadata();
    if (Number(metadata.size) !== row.size || row.size > 10 * 1024 * 1024) return fail(400, 'Fotoğraf boyutu geçersiz.');
    [bytes] = await source.download();
    if (bytes.length !== row.size) return fail(400, 'Fotoğraf boyutu değişti.');
    const info = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, animated: false }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(info.format ?? '') || (info.pages ?? 1) > 1) {
      return fail(400, 'JPEG, PNG veya WebP fotoğrafı seç.');
    }
  } catch (error) {
    if (error instanceof Error && 'status' in error) throw error;
    return fail(400, 'Fotoğraf yüklemesi tamamlanmadı veya görsel geçersiz.');
  }
  const hashes = await imagePerceptualHashes(bytes);
  const image = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, animated: false })
    .rotate().resize({ width: 1200, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  const objectPath = `references/${id}.jpg`;
  await moderationObject(objectPath).save(image, {
    resumable: false, contentType: 'image/jpeg', metadata: { cacheControl: 'private,no-store' },
  });
  try {
    await transaction(async db => {
      const changed = await db.query(`UPDATE prohibited_image_references SET hashes=$2,ready=true
        WHERE id=$1 AND created_by=$3 AND NOT ready`, [id, hashes, actor.id]);
      if (!changed.rowCount) {
        const existing = await db.query('SELECT 1 FROM prohibited_image_references WHERE id=$1 AND ready', [id]);
        if (!existing.rowCount) return fail(409, 'Bu görsel yüklemesi artık geçerli değil.');
      }
    });
  } catch (error) {
    await moderationObject(objectPath).delete({ ignoreNotFound: true }).catch(() => {});
    throw error;
  }
  await source.delete({ ignoreNotFound: true }).catch(() => {});
  return res.json({ id, ready: true });
}));

router.delete('/admin/prohibited-images/:id', route(async (req, res) => {
  const id = uuid(req.params.id);
  await adminWrite(req, true, async (db, actor) => {
    const row = (await db.query<{ ready: boolean }>(
      'SELECT ready FROM prohibited_image_references WHERE id=$1 FOR UPDATE', [id],
    )).rows[0];
    if (!row) return fail(404, 'Referans fotoğrafı bulunamadı.');
    if (row.ready) {
      const count = Number((await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM prohibited_image_references WHERE ready',
      )).rows[0]?.count ?? 0);
      if (count <= MIN_REFERENCES) return fail(409, 'Denetim için en az 5 görsel gerekir. Önce yedinci değil, mevcut 6 sınırına kadar yeni referans ekle; sonra eskisini kaldır.');
    }
    await Promise.all([
      moderationObject(`sources/${id}`).delete({ ignoreNotFound: true }),
      moderationObject(`references/${id}.jpg`).delete({ ignoreNotFound: true }),
    ]);
    await db.query('DELETE FROM prohibited_image_references WHERE id=$1', [id]);
    await audit(db, actor.id, 'prohibited_image.reference.remove', 'prohibited_image_reference', id, 'Yasaklı görsel referansı kaldırıldı.', { ready: row.ready });
  });
  res.status(204).end();
}));

router.get('/admin/prohibited-image-attempts', route(async (req, res) => {
  await adminActor(req, pool, true);
  const raw = req.query.offset ?? '0';
  if (!/^\d{1,7}$/.test(String(raw)) || Number(raw) > 1_000_000) return fail(400, 'Geçersiz sayfa.');
  const offset = Number(raw);
  const result = await pool.query<{
    id: string; userId: string | null; nickname: string; avatar: string | null; referenceId: string | null;
    area: 'profile' | 'bulletin' | 'book' | 'private_message'; distance: number; threshold: number;
    autoBlockApplied: boolean; status: 'pending' | 'confirmed' | 'released'; createdAt: Date; decidedAt: Date | null;
    decisionReason: string | null; evidencePath: string; messages: { id: string; body: string; createdAt: string }[];
  }>(
    `SELECT x.id,x.user_id AS "userId",coalesce(u.nickname,'Silinmiş hesap') AS nickname,u.avatar,
      x.reference_id AS "referenceId",x.area,x.distance,x.threshold,x.auto_block_applied AS "autoBlockApplied",
      x.status,x.created_at AS "createdAt",x.decided_at AS "decidedAt",x.decision_reason AS "decisionReason",
      x.evidence_path AS "evidencePath",
      coalesce((SELECT json_agg(json_build_object('id',m.id,'body',m.body,'createdAt',m.created_at)
        ORDER BY m.created_at,m.id) FROM prohibited_image_contact_messages m WHERE m.attempt_id=x.id),'[]'::json) AS messages
    FROM prohibited_image_attempts x LEFT JOIN community_users u ON u.id=x.user_id
    ORDER BY CASE WHEN x.status='pending' THEN 0 WHEN x.status='confirmed' THEN 1 ELSE 2 END,x.created_at DESC,x.id DESC
    LIMIT 25 OFFSET $1`, [offset],
  );
  const total = Number((await pool.query('SELECT count(*)::int AS count FROM prohibited_image_attempts')).rows[0]?.count ?? 0);
  const items = await Promise.all(result.rows.map(async row => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
    evidenceUrl: await moderationImageAccessUrl(row.evidencePath),
    referenceUrl: row.referenceId ? await moderationImageAccessUrl(`references/${row.referenceId}.jpg`).catch(() => null) : null,
  })));
  res.json({ items, total, nextOffset: offset + 25 < total ? offset + 25 : null });
}));

router.patch('/admin/prohibited-image-attempts/:id/decision', route(async (req, res) => {
  const id = uuid(req.params.id), input = parse(DecideProhibitedImageAttemptBody, req.body);
  const reason = reasonText(input.reason);
  const result = await adminWrite(req, true, async (db, actor) => {
    const row = (await db.query<{
      user_id: string | null; status: 'pending' | 'confirmed' | 'released'; created_at: Date; auto_block_applied: boolean;
    }>(
      'SELECT user_id,status,created_at,auto_block_applied FROM prohibited_image_attempts WHERE id=$1 FOR UPDATE', [id],
    )).rows[0];
    if (!row) return fail(404, 'İnceleme kaydı bulunamadı.');
    if (row.status === 'released' && input.decision === 'release') return { id, status: row.status };
    if (input.decision === 'keep') {
      await db.query(`UPDATE prohibited_image_attempts SET status='confirmed',decided_at=clock_timestamp(),
        decided_by=$2,decision_reason=$3 WHERE id=$1`, [id, actor.id, reason]);
      await audit(db, actor.id, 'prohibited_image.keep_block', 'prohibited_image_attempt', id, reason, { userId: row.user_id });
      return { id, status: 'confirmed' as const };
    }
    await db.query(`UPDATE prohibited_image_attempts SET status='released',decided_at=clock_timestamp(),
      decided_by=$2,decision_reason=$3 WHERE id=$1`, [id, actor.id, reason]);
    const active = row.user_id ? await db.query(
      `SELECT 1 FROM prohibited_image_attempts WHERE user_id=$1 AND status IN ('pending','confirmed') AND id<>$2 LIMIT 1`,
      [row.user_id, id],
    ) : { rowCount: 0 };
    let accountReleased = false;
    if (row.user_id && !active.rowCount && row.auto_block_applied) {
      const laterAdminBlock = await db.query(`SELECT 1 FROM admin_audit WHERE target_type='account' AND target_id=$1
        AND action='account.update' AND changes #>> '{after,disabled}'='true' AND created_at>$2 LIMIT 1`,
      [row.user_id, row.created_at]);
      if (!laterAdminBlock.rowCount) {
        await db.query('UPDATE afilli_auth_accounts SET disabled=false WHERE user_id=$1', [row.user_id]);
        await db.query(`UPDATE afilli_auth_sessions SET access_mode='normal'
          WHERE user_id=$1 AND revoked_at IS NULL AND access_mode='contact'`, [row.user_id]);
        accountReleased = true;
      }
    }
    await audit(db, actor.id, 'prohibited_image.release_block', 'prohibited_image_attempt', id, reason, {
      userId: row.user_id, accountReleased,
    });
    return { id, status: 'released' as const, accountReleased };
  });
  res.json(result);
}));

router.get('/prohibited-image-contact/me', route(async (req, res) => {
  const person = await requirePerson(req);
  const row = (await pool.query<{
    id: string; status: 'pending' | 'confirmed'; area: string; createdAt: Date; decisionReason: string | null;
  }>(`SELECT id,status,area,created_at AS "createdAt",decision_reason AS "decisionReason"
    FROM prohibited_image_attempts WHERE user_id=$1 AND status IN ('pending','confirmed')
    ORDER BY created_at DESC,id DESC LIMIT 1`, [person.id])).rows[0];
  if (!row) return fail(404, 'Etkin bir fotoğraf inceleme kaydı bulunamadı.');
  const messages = await pool.query<{ id: string; body: string; createdAt: Date }>(
    `SELECT id,body,created_at AS "createdAt" FROM prohibited_image_contact_messages
      WHERE attempt_id=$1 ORDER BY created_at,id`, [row.id],
  );
  res.json({
    ...row, createdAt: new Date(row.createdAt).toISOString(),
    messages: messages.rows.map(message => ({ ...message, createdAt: new Date(message.createdAt).toISOString() })),
  });
}));

router.post('/prohibited-image-contact/messages', route(async (req, res) => {
  const person = await requirePerson(req), input = parse(SendProhibitedImageContactMessageBody, req.body);
  const body = input.body.trim();
  if (!body || body.length > 2000) return fail(400, 'Mesaj 1–2000 karakter olmalı.');
  const id = await transaction(async db => {
    const attempt = (await db.query<{ id: string }>(`SELECT id FROM prohibited_image_attempts
      WHERE user_id=$1 AND status IN ('pending','confirmed') ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
    [person.id])).rows[0];
    if (!attempt) return fail(404, 'Etkin bir fotoğraf inceleme kaydı bulunamadı.');
    const recent = Number((await db.query<{ count: number }>(`SELECT count(*)::int AS count
      FROM prohibited_image_contact_messages WHERE user_id=$1 AND created_at>now()-interval '24 hours'`,
    [person.id])).rows[0]?.count ?? 0);
    if (recent >= 10) return fail(429, 'Günlük iletişim sınırına ulaştın. Daha sonra yeniden dene.');
    const messageId = randomUUID();
    await db.query(`INSERT INTO prohibited_image_contact_messages(id,attempt_id,user_id,body)
      VALUES($1,$2,$3,$4)`, [messageId, attempt.id, person.id, body]);
    return messageId;
  });
  res.status(201).json({ id });
}));

export default router;
