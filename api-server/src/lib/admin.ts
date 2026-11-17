import type { Request } from 'express';
import { pool, type PoolClient } from '@workspace/db';
import type { AdminAccount, AdminContent, AdminContentKind, AdminRole, OfficialInstagramInput, SocialSettings } from '@workspace/api-zod';
import { fail, requirePerson, transaction } from './community';
import { officialInstagramUrl } from './social';

export async function adminActor(req: Request, db: PoolClient | typeof pool = pool, upper = false) {
  const person = await requirePerson(req);
  const result = await db.query<{ role: AdminRole }>(
    'SELECT role FROM afilli_auth_accounts WHERE user_id=$1 AND NOT disabled', [person.id]);
  const role = result.rows[0]?.role;
  if (!role || !['admin', 'superadmin'].includes(role) || (upper && role !== 'superadmin')) {
    return fail(403, upper ? 'Bu işlem yalnızca üst yöneticiye açık.' : 'Bu sayfa yöneticilere özel.');
  }
  return { id: person.id, role };
}

// All governance writes share the same transaction lock. Recheck the actor's
// current role after obtaining it, so concurrent demotion cannot leave a
// previously authorized mutation running with outdated privileges.
export async function adminWrite<T>(req: Request, upper: boolean,
  fn: (db: PoolClient, actor: { id: string; role: AdminRole }) => Promise<T>) {
  return transaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('afilli-admin-governance'))");
    const actor = await adminActor(req, db, upper);
    return fn(db, actor);
  });
}

export function adminPage(query: Record<string, unknown>) {
  const raw = query.offset ?? '0';
  if (!/^\d{1,7}$/.test(String(raw))) return fail(400, 'Geçersiz sayfa.');
  const offset = Number(raw);
  if (offset > 1_000_000) return fail(400, 'Geçersiz sayfa.');
  if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100)) {
    return fail(400, 'Arama en fazla 100 karakter olabilir.');
  }
  return { offset, search: `%${String(query.q ?? '').trim()}%` };
}
export function reasonText(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 300) return fail(400, 'İşlem gerekçesi 3–300 karakter olmalı.');
  return reason;
}
export const accountColumns = `a.user_id AS id,u.nickname,a.email,a.role,a.disabled,
  a.email_verified AS "emailVerified",a.created_at AS "createdAt"`;
export async function adminAccount(db: PoolClient, id: string): Promise<AdminAccount> {
  const result = await db.query<AdminAccount & { createdAt: Date }>(
    `SELECT ${accountColumns} FROM afilli_auth_accounts a JOIN community_users u ON u.id=a.user_id WHERE a.user_id=$1`, [id]);
  const row = result.rows[0] ?? fail(404, 'Hesap bulunamadı.');
  return { ...row, createdAt: new Date(row.createdAt).toISOString() };
}
export async function audit(db: PoolClient, actor: string, action: string, targetType: string,
  targetId: string, reason: string, changes: unknown) {
  await db.query(`INSERT INTO admin_audit(actor_id,action,target_type,target_id,reason,changes)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [actor, action, targetType, targetId, reason, JSON.stringify(changes)]);
}

// SQL identifiers below are a closed allowlist, never request-supplied text.
export const contentSources = {
  book: { table: 'authored_books', title: 't.title', body: "''::text", publication: 't.publication' },
  writer_comment: { table: 'writer_comments', title: "'Kitap yorumu'::text", body: 'left(t.body,1000)', publication: "'comment'::text" },
  bulletin: { table: 'bulletins', title: "'Bülten'::text", body: 'left(t.body,1000)', publication: "'post'::text" },
  bulletin_comment: { table: 'bulletin_comments', title: "'Bülten yorumu'::text",
    body: "CASE WHEN t.deleted THEN '[Yazarı tarafından silinmiş]' ELSE left(t.body,1000) END", publication: "'comment'::text" },
} as const;
export function contentKind(value: unknown): AdminContentKind {
  if (typeof value !== 'string' || !Object.hasOwn(contentSources, value)) return fail(400, 'Geçersiz içerik türü.');
  return value as AdminContentKind;
}
export function contentSelect(kind: AdminContentKind) {
  const c = contentSources[kind];
  return `SELECT t.id,'${kind}'::text AS kind,u.nickname AS author,${c.title} AS title,${c.body} AS body,
    t.moderation_hidden AS hidden,${c.publication} AS publication,
    coalesce(t.created_at,now()) AS "createdAt" FROM ${c.table} t JOIN community_users u ON u.id=t.author_id`;
}
export function contentRecord(row: AdminContent & { createdAt: Date }): AdminContent {
  return { ...row, createdAt: new Date(row.createdAt).toISOString() };
}
export async function saveAdminSettings(req: Request, input: OfficialInstagramInput): Promise<SocialSettings> {
  const url = officialInstagramUrl(input.instagramUrl);
  return adminWrite(req, false, async (db, actor) => {
    const before = (await db.query<{ instagramUrl: string | null }>('SELECT instagram_handle AS "instagramUrl" FROM social_settings WHERE id=true')).rows[0]?.instagramUrl ?? null;
    const result = await db.query<SocialSettings>(`INSERT INTO social_settings(id,instagram_handle)
      VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET instagram_handle=excluded.instagram_handle
      RETURNING instagram_handle AS "instagramUrl",popular_days AS "popularDays",popular_limit AS "popularLimit"`, [url]);
    await audit(db, actor.id, 'settings.update', 'settings', 'instagram', 'Instagram bağlantısı güncellendi.', { before, after: url });
    return result.rows[0];
  });
}
