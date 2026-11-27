import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { UpdateAdminAccountBody, UpdateAdminContentBody, UpdateAdminSettingsBody,
  GetAdminOverviewResponse, GetAdminAccountsResponse, UpdateAdminAccountResponse,
  GetAdminContentResponse, UpdateAdminContentResponse, GetAdminHistoryResponse, UpdateAdminSettingsResponse,
  type AdminAccount, type AdminContent } from '@workspace/api-zod';
import { route, parse, fail, uuid } from '../lib/community';
import { personId } from '../lib/social';
import { deletionScope, deleteAccount } from '../lib/admin-account-delete';
import { DeleteAdminAccountBody, GetAdminAccountDeletionResponse } from '@workspace/api-zod';
import { DecideAdminPremiumApplicationBody, DecideAdminPremiumApplicationResponse,
  GetAdminPremiumApplicationsResponse } from '@workspace/api-zod';
import { adminActor, adminWrite, adminPage, reasonText, accountColumns, adminAccount, audit,
  contentSources, contentKind, contentSelect, contentRecord, saveAdminSettings } from '../lib/admin';
import { grantFreePremium, notifyPremiumStatus } from '../lib/premium';
import { adminAccountAppeals, decideAccountAppeal } from '../lib/account-appeals';
import { GetAdminAccountAppealsResponse, DecideAdminAccountAppealBody, DecideAdminAccountAppealResponse } from '@workspace/api-zod';

const router: IRouter = Router();
router.get('/admin/overview', route(async (req, res) => {
  const actor = await adminActor(req);
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM afilli_auth_accounts) AS users,
    (SELECT count(*)::int FROM afilli_auth_accounts WHERE disabled) AS "disabledUsers",
    (SELECT count(*)::int FROM authored_books) AS books,
    (SELECT count(*)::int FROM bulletins) AS bulletins,
    ((SELECT count(*) FROM writer_comments)+(SELECT count(*) FROM bulletin_comments))::int AS comments,
    ((SELECT count(*) FROM authored_books WHERE moderation_hidden)+(SELECT count(*) FROM bulletins WHERE moderation_hidden)
      +(SELECT count(*) FROM writer_comments WHERE moderation_hidden)+(SELECT count(*) FROM bulletin_comments WHERE moderation_hidden))::int AS "hiddenContent"`);
  res.json(GetAdminOverviewResponse.parse({ ...result.rows[0], role: actor.role }));
}));

router.get('/admin/premium-applications', route(async (req, res) => {
  await adminActor(req);
  const { offset } = adminPage(req.query);
  const result = await pool.query(`SELECT p.id,p.user_id AS "userId",u.nickname,a.email,
      p.package_identifier AS "packageIdentifier",p.product_identifier AS "productIdentifier",
      p.plan_name AS "planName",p.status,p.created_at AS "createdAt"
    FROM premium_applications p JOIN community_users u ON u.id=p.user_id
    LEFT JOIN afilli_auth_accounts a ON a.user_id=p.user_id
    ORDER BY p.created_at DESC,p.id DESC LIMIT 25 OFFSET $1`, [offset]);
  const total = (await pool.query('SELECT count(*)::int AS n FROM premium_applications')).rows[0].n as number;
  res.json(GetAdminPremiumApplicationsResponse.parse({
    items: result.rows,
    total, nextOffset: offset + 25 < total ? offset + 25 : null,
  }));
}));

router.post('/admin/premium-applications/:id/decision', route(async (req, res) => {
  const id = uuid(req.params.id), input = parse(DecideAdminPremiumApplicationBody, req.body);
  const reason = reasonText(input.reason);
  const result = await adminWrite(req, false, async (db, actor) => {
    const application = (await db.query<{
      id: string; userId: string; status: string; planName: string; packageIdentifier: string;
      productIdentifier: string; nickname: string; email: string; createdAt: Date;
    }>(`SELECT p.id,p.user_id AS "userId",p.status,p.plan_name AS "planName",
        p.package_identifier AS "packageIdentifier",p.product_identifier AS "productIdentifier",
        u.nickname,coalesce(a.email,'') AS email,p.created_at AS "createdAt"
      FROM premium_applications p JOIN community_users u ON u.id=p.user_id
      LEFT JOIN afilli_auth_accounts a ON a.user_id=p.user_id WHERE p.id=$1 FOR UPDATE OF p`, [id])).rows[0];
    if (!application) return fail(404, 'Başvuru bulunamadı.');
    if (application.status !== 'pending') return fail(409, 'Bu başvuru artık beklemede değil. Listeyi yenile.');

    const status = input.decision === 'paid' ? 'paid_approved' : input.decision === 'free' ? 'active' : 'rejected';
    if (input.decision === 'free') {
      const active = await db.query(`SELECT 1 FROM premium_memberships WHERE user_id=$1 AND status='active'
        AND (source='free' OR expires_at>now()) FOR UPDATE`, [application.userId]);
      if (active.rowCount) return fail(409, 'Kullanıcının zaten etkin bir Premium üyeliği var.');
      await grantFreePremium(db, application.userId, id, actor.id);
    }
    await db.query(`UPDATE premium_applications SET status=$2,decision=$3,decided_at=clock_timestamp(),decided_by=$4
      WHERE id=$1`, [id, status, input.decision, actor.id]);
    await notifyPremiumStatus(db, application.userId, actor.id, id, input.decision === 'free' ? 'free' : status);
    await audit(db, actor.id, `premium.application.${input.decision}`, 'premium_application', id, reason,
      { userId: application.userId, packageIdentifier: application.packageIdentifier, productIdentifier: application.productIdentifier });
    return { ...application, status };
  });
  res.json(DecideAdminPremiumApplicationResponse.parse(result));
}));

router.get('/admin/account-appeals', route(async (req, res) => {
  await adminActor(req, pool, true);
  const { offset } = adminPage(req.query);
  res.json(GetAdminAccountAppealsResponse.parse(await adminAccountAppeals(offset)));
}));

router.post('/admin/account-appeals/:id/decision', route(async (req, res) => {
  const id = uuid(req.params.id), input = parse(DecideAdminAccountAppealBody, req.body);
  const result = await adminWrite(req, true, (db, actor) => decideAccountAppeal(db, actor, id, input));
  res.json(DecideAdminAccountAppealResponse.parse(result));
}));

router.get('/admin/accounts', route(async (req, res) => {
  await adminActor(req, pool, true);
  const { offset, search } = adminPage(req.query);
  const condition = '(u.nickname ILIKE $1 OR a.email ILIKE $1)';
  const result = await pool.query<AdminAccount & { createdAt: Date }>(`SELECT ${accountColumns}
    FROM afilli_auth_accounts a JOIN community_users u ON u.id=a.user_id
    WHERE ${condition} ORDER BY a.created_at DESC,a.user_id LIMIT 25 OFFSET $2`, [search, offset]);
  const total = (await pool.query(`SELECT count(*)::int AS n FROM afilli_auth_accounts a
    JOIN community_users u ON u.id=a.user_id WHERE ${condition}`, [search])).rows[0].n as number;
  res.json(GetAdminAccountsResponse.parse({ items: result.rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })),
    total, nextOffset: offset + 25 < total ? offset + 25 : null }));
}));
router.get('/admin/accounts/:id/deletion', route(async (req, res) => {
  await adminActor(req, pool, true);
  res.json(GetAdminAccountDeletionResponse.parse(await deletionScope(pool, personId(req.params.id))));
}));
router.delete('/admin/accounts/:id', route(async (req, res) => {
  const id = personId(req.params.id), input = parse(DeleteAdminAccountBody, req.body);
  const reason = reasonText(input.reason);
  await adminWrite(req, true, (db, actor) => deleteAccount(db, actor.id, id, input.confirmation, reason));
  res.status(204).end();
}));
router.patch('/admin/accounts/:id', route(async (req, res) => {
  const id = personId(req.params.id), input = parse(UpdateAdminAccountBody, req.body), reason = reasonText(input.reason);
  if (input.role === undefined && input.disabled === undefined && input.nickname === undefined) return fail(400, 'Değiştirilecek bir alan seç.');
  const result = await adminWrite(req, true, async (db, actor) => {
    const before = await adminAccount(db, id);
    const role = input.role ?? before.role, disabled = input.disabled ?? before.disabled;
    const nickname = input.nickname?.trim() ?? before.nickname;
    if (nickname.length < 3 || nickname.length > 15) return fail(400, 'Takma ad 3–15 karakter olmalı.');
    if (actor.id === id && (disabled || role !== before.role)) return fail(409, 'Kendi yetkini düşüremez veya kendi hesabını kapatamazsın.');
    if (before.role === 'superadmin' && !before.disabled && (disabled || role !== 'superadmin')) {
      const count = (await db.query("SELECT count(*)::int AS n FROM afilli_auth_accounts WHERE role='superadmin' AND NOT disabled")).rows[0].n;
      if (count <= 1) return fail(409, 'Son üst yönetici kaldırılamaz.');
    }
    if (disabled && role !== 'user' && role !== before.role) return fail(409, 'Engelli hesaba yönetici yetkisi verilemez.');
    await db.query('UPDATE afilli_auth_accounts SET role=$2,disabled=$3 WHERE user_id=$1', [id, role, disabled]);
    await db.query('UPDATE community_users SET nickname=$2 WHERE id=$1', [id, nickname]);
    // Privilege changes invalidate sessions and pending recovery codes; an old
    // bearer token must not retain access after demotion or disablement.
    if (disabled || role !== before.role) {
      await db.query('UPDATE afilli_auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
      await db.query('UPDATE afilli_auth_codes SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [id]);
    } else if (before.disabled && !disabled) {
      await db.query(`UPDATE afilli_auth_sessions SET access_mode='normal'
        WHERE user_id=$1 AND revoked_at IS NULL AND access_mode IN ('appeal','contact')`, [id]);
    }
    await audit(db, actor.id, 'account.update', 'account', id, reason,
      { before: { role: before.role, disabled: before.disabled }, after: { role, disabled }, nicknameChanged: nickname !== before.nickname });
    return adminAccount(db, id);
  });
  res.json(UpdateAdminAccountResponse.parse(result));
}));
router.get('/admin/content', route(async (req, res) => {
  await adminActor(req);
  const kind = contentKind(req.query.kind), { offset, search } = adminPage(req.query);
  const c = contentSources[kind], condition = `(${c.title} ILIKE $1 OR ${c.body} ILIKE $1 OR u.nickname ILIKE $1)`;
  const result = await pool.query<AdminContent & { createdAt: Date }>(`${contentSelect(kind)}
    WHERE ${condition} ORDER BY t.created_at DESC NULLS LAST,t.id LIMIT 25 OFFSET $2`, [search, offset]);
  const total = (await pool.query(`SELECT count(*)::int AS n FROM ${c.table} t
    JOIN community_users u ON u.id=t.author_id WHERE ${condition}`, [search])).rows[0].n as number;
  res.json(GetAdminContentResponse.parse({ items: result.rows.map(contentRecord), total,
    nextOffset: offset + 25 < total ? offset + 25 : null }));
}));
router.patch('/admin/content/:kind/:id', route(async (req, res) => {
  const kind = contentKind(req.params.kind), id = uuid(req.params.id), input = parse(UpdateAdminContentBody, req.body);
  const reason = reasonText(input.reason), c = contentSources[kind];
  const result = await adminWrite(req, false, async (db, actor) => {
    const before = (await db.query<{ moderation_hidden: boolean }>(`SELECT moderation_hidden FROM ${c.table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) return fail(404, 'İçerik bulunamadı.');
    await db.query(`UPDATE ${c.table} SET moderation_hidden=$2 WHERE id=$1`, [id, input.hidden]);
    await audit(db, actor.id, input.hidden ? 'content.hide' : 'content.restore', kind, id, reason,
      { before: before.moderation_hidden, after: input.hidden });
    return contentRecord((await db.query<AdminContent & { createdAt: Date }>(`${contentSelect(kind)} WHERE t.id=$1`, [id])).rows[0]);
  });
  res.json(UpdateAdminContentResponse.parse(result));
}));
router.get('/admin/history', route(async (req, res) => {
  await adminActor(req);
  const { offset } = adminPage(req.query);
  const result = await pool.query(`SELECT h.id,coalesce(u.nickname,'Eski yönetici') AS actor,h.action,
    h.target_type AS "targetType",h.target_id AS "targetId",h.reason,h.created_at AS "createdAt"
    FROM admin_audit h LEFT JOIN community_users u ON u.id=h.actor_id
    ORDER BY h.created_at DESC,h.id DESC LIMIT 25 OFFSET $1`, [offset]);
  const total = (await pool.query('SELECT count(*)::int AS n FROM admin_audit')).rows[0].n as number;
  res.json(GetAdminHistoryResponse.parse({ items: result.rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })),
    total, nextOffset: offset + 25 < total ? offset + 25 : null }));
}));
router.put('/admin/settings', route(async (req, res) => {
  const input = parse(UpdateAdminSettingsBody, req.body);
  res.json(UpdateAdminSettingsResponse.parse(await saveAdminSettings(req, input)));
}));
export default router;
