import { pool, type PoolClient } from '@workspace/db';
import type {
  AdminBookPromotionSettingsInput, AdminBookPromotionRequestPage, BookPromotionRequest,
  BookPromotionSettings, MyBookPromotion, BookPromotionRequestInput,
} from '@workspace/api-zod';
import { fail, transaction, uuid } from './community';
import { adminActor, adminWrite, audit, adminPage } from './admin';
import { isPublished, ownWriter, requirePublished } from './writer-service';
import { coverUrl, legacyDocument } from './writer-document';
import { publicBook } from './book-access';

type Db = PoolClient | typeof pool;
const durationOptions = [3, 7, 15, 30] as const;
type Duration = typeof durationOptions[number];
type SettingsRow = { enabled: boolean; allowedDurations: number[]; updatedAt: Date };
type RequestRow = {
  id: string; bookId: string | null; authorId: string | null; bookTitle: string; coverUrl: string | null;
  authorNickname: string; authorAvatar: string | null; durationDays: Duration; status: BookPromotionRequest['status'];
  decision: BookPromotionRequest['decision']; decisionNote: string | null; requestedAt: Date; decidedAt: Date | null;
  startsAt: Date | null; expiresAt: Date | null;
};

export async function assertBookPromotionSchema(db: Db = pool) {
  const ready = (await db.query(`SELECT to_regclass('book_promotion_settings') IS NOT NULL
    AND to_regclass('book_promotion_requests') IS NOT NULL AS ok`)).rows[0]?.ok;
  if (!ready) return fail(503, 'Kitap tanıtım şeması bu ortamda henüz uygulanmadı.');
}

function normalizeSettings(row: SettingsRow): BookPromotionSettings {
  return {
    enabled: row.enabled,
    allowedDurations: row.allowedDurations.filter((v): v is Duration => durationOptions.includes(v as Duration)),
    updatedAt: new Date(row.updatedAt),
  };
}
export async function getBookPromotionSettings(db: Db = pool) {
  await assertBookPromotionSchema(db);
  const row = (await db.query<SettingsRow>(`SELECT enabled,"allowed_durations" AS "allowedDurations",updated_at AS "updatedAt"
    FROM book_promotion_settings WHERE id=true`)).rows[0];
  if (!row) return fail(503, 'Kitap tanıtım ayarları bulunamadı.');
  return normalizeSettings(row);
}

function requestView(row: RequestRow): BookPromotionRequest {
  return {
    ...row,
    coverUrl: coverUrl(row.coverUrl),
    requestedAt: new Date(row.requestedAt),
    decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
    startsAt: row.startsAt ? new Date(row.startsAt) : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
  };
}
const requestSelect = `SELECT id,book_id AS "bookId",author_id AS "authorId",book_title AS "bookTitle",
  cover_snapshot AS "coverUrl",author_nickname AS "authorNickname",author_avatar AS "authorAvatar",
  duration_days AS "durationDays",status,decision,decision_note AS "decisionNote",
  requested_at AS "requestedAt",decided_at AS "decidedAt",starts_at AS "startsAt",expires_at AS "expiresAt"`;

export async function expireBookPromotions(db: Db = pool) {
  await assertBookPromotionSchema(db);
  await db.query(`UPDATE book_promotion_requests SET status='expired'
    WHERE status='active' AND expires_at<=clock_timestamp()`);
}

export async function myBookPromotion(bookId: string, ownerId: string): Promise<MyBookPromotion> {
  await assertBookPromotionSchema();
  const book = await ownWriter(uuid(bookId), ownerId);
  if (!isPublished(book)) return fail(404, 'Yalnızca yayımlanmış kitabını önerebilirsin.');
  await requirePublished(bookId);
  await expireBookPromotions();
  const [settings, latest] = await Promise.all([
    getBookPromotionSettings(),
    pool.query<RequestRow>(`${requestSelect} FROM book_promotion_requests
      WHERE author_id=$1 AND book_id=$2 ORDER BY requested_at DESC,id DESC LIMIT 1`, [ownerId, bookId]),
  ]);
  return { ...settings, latestRequest: latest.rows[0] ? requestView(latest.rows[0]) : null };
}

export async function createBookPromotionRequest(bookId: string, owner: { id: string; nickname: string; avatar: string | null },
  input: BookPromotionRequestInput): Promise<BookPromotionRequest> {
  await assertBookPromotionSchema();
  const id = uuid(bookId), clientRequestId = uuid(input.clientRequestId);
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`book-promotion:${id}`]);
    const prior = (await db.query<RequestRow>(`${requestSelect} FROM book_promotion_requests
      WHERE author_id=$1 AND client_request_id=$2`, [owner.id, clientRequestId])).rows[0];
    if (prior) {
      if (prior.bookId !== id || prior.durationDays !== input.durationDays) return fail(409, 'Bu istek kimliği başka bir taleple kullanılmış.');
      return requestView(prior);
    }

    const book = await ownWriter(id, owner.id, db, true);
    if (!isPublished(book)) return fail(404, 'Yalnızca yayımlanmış kitabını önerebilirsin.');
    await requirePublished(id, db);
    const settings = await getBookPromotionSettings(db);
    if (!settings.enabled) return fail(409, 'Kitap tanıtım talepleri şu anda kapalı.');
    if (!settings.allowedDurations.includes(input.durationDays)) return fail(400, 'Bu tanıtım süresi şu anda seçilemiyor.');

    await db.query(`UPDATE book_promotion_requests SET status='expired'
      WHERE book_id=$1 AND status='active' AND expires_at<=clock_timestamp()`, [id]);
    const open = await db.query(`SELECT 1 FROM book_promotion_requests
      WHERE book_id=$1 AND status IN ('pending','active') LIMIT 1`, [id]);
    if (open.rowCount) return fail(409, 'Bu kitap için bekleyen veya aktif bir tanıtım zaten var.');

    const document = book.published_data ?? legacyDocument(book);
    const result = await db.query<RequestRow>(`WITH inserted AS (
      INSERT INTO book_promotion_requests(book_id,author_id,client_request_id,book_title,cover_snapshot,
        author_nickname,author_avatar,duration_days)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    ) ${requestSelect} FROM inserted`, [id, owner.id, clientRequestId, document.title || book.title,
      document.cover || book.cover, owner.nickname, owner.avatar, input.durationDays]);
    return requestView(result.rows[0]);
  });
}

export async function updateBookPromotionSettings(req: Parameters<typeof adminWrite>[0], input: AdminBookPromotionSettingsInput) {
  const unique = [...new Set(input.allowedDurations)];
  if (unique.length !== input.allowedDurations.length || unique.some(v => !durationOptions.includes(v as Duration))) {
    return fail(400, 'Süreleri 3, 7, 15 veya 30 gün olarak, tekrar olmadan seç.');
  }
  return adminWrite(req, false, async (db, actor) => {
    await assertBookPromotionSchema(db);
    const result = await db.query<SettingsRow>(`UPDATE book_promotion_settings
      SET enabled=$1,allowed_durations=$2,updated_at=clock_timestamp(),updated_by=$3
      WHERE id=true RETURNING enabled,allowed_durations AS "allowedDurations",updated_at AS "updatedAt"`,
    [input.enabled, unique, actor.id]);
    if (!result.rows[0]) return fail(503, 'Kitap tanıtım ayarları bulunamadı.');
    await audit(db, actor.id, 'book_promotion.settings.update', 'book_promotion_settings', 'true',
      'Ücretsiz kitap tanıtım seçenekleri güncellendi.', { enabled: input.enabled, allowedDurations: unique });
    return normalizeSettings(result.rows[0]);
  });
}

export async function adminBookPromotionRequests(req: Parameters<typeof adminActor>[0], statusValue: unknown, query: Record<string, unknown>): Promise<AdminBookPromotionRequestPage> {
  await adminActor(req);
  await assertBookPromotionSchema();
  const { offset } = adminPage(query);
  const status = String(statusValue ?? 'pending');
  if (!['all', 'pending', 'active', 'rejected', 'expired'].includes(status)) return fail(400, 'Geçersiz talep durumu.');
  await expireBookPromotions();
  const where = status === 'all' ? '' : 'WHERE status=$1';
  const values = status === 'all' ? [] : [status];
  const result = await pool.query<RequestRow>(`${requestSelect} FROM book_promotion_requests ${where}
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,requested_at DESC,id DESC
    LIMIT 25 OFFSET $${values.length + 1}`, [...values, offset]);
  const total = Number((await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM book_promotion_requests ${where}`, values)).rows[0]?.n ?? 0);
  return {
    items: result.rows.map(requestView),
    total,
    nextOffset: offset + 25 < total ? offset + 25 : null,
  };
}

export async function decideBookPromotion(req: Parameters<typeof adminWrite>[0], idValue: unknown,
  input: { decision: 'approve_free' | 'reject'; reason?: string }) {
  const id = uuid(idValue);
  return adminWrite(req, false, async (db, actor) => {
    await assertBookPromotionSchema(db);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`book-promotion-request:${id}`]);
    const row = (await db.query<RequestRow>(`${requestSelect} FROM book_promotion_requests WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!row) return fail(404, 'Tanıtım talebi bulunamadı.');
    if (row.status !== 'pending') return fail(409, 'Bu tanıtım talebi artık beklemede değil.');
    const reason = (input.reason ?? '').trim().slice(0, 300) || (input.decision === 'approve_free' ? 'Ücretsiz tanıtım onaylandı.' : 'Tanıtım talebi reddedildi.');
    if (input.decision === 'approve_free') {
      if (!row.bookId) return fail(409, 'Kitap artık mevcut değil; talep onaylanamadı.');
      const book = (await db.query<{ visible: boolean }>(`SELECT ${publicBook()} AS visible
        FROM authored_books b WHERE b.id=$1`, [row.bookId])).rows[0];
      if (!book?.visible) return fail(409, 'Kitap artık yayımlanmıyor veya görünür değil.');
      const conflict = await db.query(`SELECT 1 FROM book_promotion_requests
        WHERE book_id=$1 AND status='active' AND expires_at>clock_timestamp() LIMIT 1`, [row.bookId]);
      if (conflict.rowCount) return fail(409, 'Bu kitapta zaten aktif bir tanıtım var.');
      await db.query(`UPDATE book_promotion_requests SET status='active',decision='free',decision_note=$2,
        decided_at=clock_timestamp(),decided_by=$3,starts_at=clock_timestamp(),
        expires_at=clock_timestamp()+($4::int*interval '1 day') WHERE id=$1`,
      [id, reason, actor.id, row.durationDays]);
    } else {
      await db.query(`UPDATE book_promotion_requests SET status='rejected',decision='reject',decision_note=$2,
        decided_at=clock_timestamp(),decided_by=$3 WHERE id=$1`, [id, reason, actor.id]);
    }
    await audit(db, actor.id, `book_promotion.${input.decision}`, 'book_promotion_request', id, reason,
      { authorId: row.authorId, bookId: row.bookId, durationDays: row.durationDays });
    const updated = (await db.query<RequestRow>(`${requestSelect} FROM book_promotion_requests WHERE id=$1`, [id])).rows[0];
    return requestView(updated);
  });
}
