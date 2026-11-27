import { Router, type IRouter } from 'express';
import { pool, type PoolClient } from '@workspace/db';
import {
  CreatePremiumApplicationBody, CreatePremiumApplicationResponse, GetPremiumConfigResponse,
  GetMyPremiumResponse, VerifyPremiumPurchaseResponse, UpdatePremiumPreferencesBody,
  UpdatePremiumPreferencesResponse,
} from '@workspace/api-zod';
import { route, requirePerson, parse, fail, transaction, uuid } from '../lib/community';
import { revenueCatConfig, verifyActiveRevenueCatEntitlement } from '../lib/revenuecat-premium';
import { premiumAccount, refreshPremiumEntitlement, notifyPremiumStatus, applicationRecord } from '../lib/premium';

const router: IRouter = Router();

router.get('/premium/config', route(async (req, res) => {
  await requirePerson(req);
  const config = await revenueCatConfig();
  res.json(GetPremiumConfigResponse.parse({
    configured: config.configured,
    message: config.message,
    iosPublicKey: config.iosPublicKey,
    androidPublicKey: config.androidPublicKey,
    packages: config.packages.map(({ packageIdentifier, productIdentifier, productName, platform }) =>
      ({ packageIdentifier, productIdentifier, productName, platform })),
  }));
}));

router.get('/premium/me', route(async (req, res) => {
  const actor = await requirePerson(req);
  await refreshPremiumEntitlement(actor.id);
  res.json(GetMyPremiumResponse.parse(await premiumAccount(actor.id)));
}));

router.post('/premium/applications', route(async (req, res) => {
  const actor = await requirePerson(req);
  const input = parse(CreatePremiumApplicationBody, req.body);
  const config = await revenueCatConfig();
  const selected = config.packages.find((item) =>
    item.packageIdentifier === input.packageIdentifier
    && item.productIdentifier === input.productIdentifier
    && item.platform === input.platform);
  if (!config.configured || !selected) return fail(409, 'Bu plan artık mevcut teklifte değil. Güncel planları yeniden yükle.');
  const created = await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`premium-application:${actor.id}`]);
    const active = await db.query(`SELECT 1 FROM premium_memberships WHERE user_id=$1 AND status='active'
      AND (source='free' OR expires_at>now()) FOR UPDATE`, [actor.id]);
    if (active.rowCount) return fail(409, 'Zaten etkin bir Afilli Premium üyeliğin var.');
    const pending = await db.query(`SELECT 1 FROM premium_applications WHERE user_id=$1
      AND status IN ('pending','paid_approved') FOR UPDATE`, [actor.id]);
    if (pending.rowCount) return fail(409, 'Zaten sonuç bekleyen bir Afilli Premium başvurun var.');
    const result = await db.query(`INSERT INTO premium_applications
      (user_id,package_id,package_identifier,product_id,product_identifier,plan_name,status)
      VALUES($1,$2,$3,$4,$5,$6,'pending')
      RETURNING id,package_identifier AS "packageIdentifier",product_identifier AS "productIdentifier",
        plan_name AS "planName",status,created_at AS "createdAt"`,
    [actor.id, selected.packageId, selected.packageIdentifier, selected.productId,
      selected.productIdentifier, selected.productName]);
    return result.rows[0];
  });
  res.status(201).json(CreatePremiumApplicationResponse.parse(applicationRecord(created)));
}));

router.post('/premium/applications/:id/verify', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  const application = (await pool.query<{
    id: string; userId: string; productId: string; productIdentifier: string; status: string; decidedBy: string | null;
  }>(`SELECT id,user_id AS "userId",product_id AS "productId",product_identifier AS "productIdentifier",
      status,decided_by AS "decidedBy"
    FROM premium_applications WHERE id=$1 AND user_id=$2`, [id, actor.id])).rows[0];
  if (!application) return fail(404, 'Başvuru bulunamadı.');
  if (application.status === 'active') return res.json(VerifyPremiumPurchaseResponse.parse(await premiumAccount(actor.id)));
  if (application.status !== 'paid_approved') return fail(409, 'Bu başvuru için ücretli ödeme onayı bulunmuyor.');
  const config = await revenueCatConfig();
  const expiresAt = await verifyActiveRevenueCatEntitlement(
    actor.id, application.productId, application.productIdentifier, config.projectId,
  );
  if (!expiresAt) return fail(409, 'RevenueCat bu plan için geçerli bir abonelik doğrulamadı. Premium açılmadı.');
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`premium-application:${id}`]);
    const current = (await db.query<{ user_id: string; status: string; decided_by: string | null }>(
      'SELECT user_id,status,decided_by FROM premium_applications WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!current || current.user_id !== actor.id) return fail(404, 'Başvuru bulunamadı.');
    if (current.status === 'active') return;
    if (current.status !== 'paid_approved') return fail(409, 'Başvurunun durumu ödeme sırasında değişti. Yenile ve tekrar kontrol et.');
    const membership = (await db.query<{ status: string; expires_at: Date | null }>(
      'SELECT status,expires_at FROM premium_memberships WHERE user_id=$1 FOR UPDATE', [actor.id])).rows[0];
    if (membership?.status === 'active' && membership.expires_at && membership.expires_at > new Date()) {
      return fail(409, 'Bu hesapta zaten etkin bir Premium üyeliği var.');
    }
    if (expiresAt <= new Date()) return fail(409, 'Ödeme süresi dolmuş. Premium açılmadı.');
    await db.query(`INSERT INTO premium_memberships
      (user_id,application_id,source,status,product_id,product_identifier,started_at,expires_at,verified_at,granted_by,revoked_at)
      VALUES($1,$2,'paid','active',$3,$4,clock_timestamp(),$5,clock_timestamp(),NULL,NULL)
      ON CONFLICT(user_id) DO UPDATE SET application_id=excluded.application_id,source='paid',status='active',
        product_id=excluded.product_id,product_identifier=excluded.product_identifier,started_at=excluded.started_at,
        expires_at=excluded.expires_at,verified_at=excluded.verified_at,granted_by=NULL,revoked_at=NULL`,
    [actor.id, id, application.productId, application.productIdentifier, expiresAt]);
    await db.query("UPDATE premium_applications SET status='active' WHERE id=$1", [id]);
    await notifyPremiumStatus(db, actor.id, current.decided_by ?? actor.id, id, 'active');
  });
  return res.json(VerifyPremiumPurchaseResponse.parse(await premiumAccount(actor.id)));
}));

router.post('/premium/restore', route(async (req, res) => {
  const actor = await requirePerson(req);
  const candidate = (await pool.query<{
    id: string;
    productId: string;
    productIdentifier: string;
    status: string;
  }>(`SELECT a.id,a.product_id AS "productId",a.product_identifier AS "productIdentifier",
      a.status
    FROM premium_applications a
    LEFT JOIN premium_memberships m ON m.user_id=a.user_id AND m.application_id=a.id
    WHERE a.user_id=$1 AND (a.status='paid_approved' OR (a.status IN ('active','expired') AND m.source='paid'))
    ORDER BY a.created_at DESC,a.id DESC LIMIT 1`, [actor.id])).rows[0];
  if (!candidate) return fail(409, 'Bu hesapta geri yüklenecek ücretli Premium satın alımı bulunamadı.');

  const config = await revenueCatConfig();
  const expiresAt = await verifyActiveRevenueCatEntitlement(
    actor.id, candidate.productId, candidate.productIdentifier, config.projectId,
  );
  if (!expiresAt) {
    await premiumAccount(actor.id);
    return fail(409, 'Mağazada etkin bir Premium üyeliği bulunamadı. Premium erişimi açılmadı.');
  }

  await transaction(async (db) => {
    const application = (await db.query<{ status: string; decided_by: string | null }>(
      'SELECT status,decided_by FROM premium_applications WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [candidate.id, actor.id],
    )).rows[0];
    if (!application || !['paid_approved', 'active', 'expired'].includes(application.status)) {
      return fail(409, 'Premium başvurusunun durumu değişti. Durumu yenileyip tekrar dene.');
    }
    const membership = (await db.query<{ source: string; status: string; expires_at: Date | null }>(
      'SELECT source,status,expires_at FROM premium_memberships WHERE user_id=$1 FOR UPDATE', [actor.id],
    )).rows[0];
    if (membership?.source === 'free' && membership.status === 'active') {
      return fail(409, 'Bu hesapta zaten ücretsiz Premium üyeliği etkin.');
    }
    const previousExpiry = membership?.source === 'paid' && membership.expires_at
      ? new Date(membership.expires_at).getTime()
      : 0;
    const renewed = application.status === 'expired' || membership?.status === 'expired'
      || expiresAt.getTime() > previousExpiry + 1000;
    await db.query(`INSERT INTO premium_memberships
      (user_id,application_id,source,status,product_id,product_identifier,started_at,expires_at,verified_at,granted_by,revoked_at)
      VALUES($1,$2,'paid','active',$3,$4,clock_timestamp(),$5,clock_timestamp(),NULL,NULL)
      ON CONFLICT(user_id) DO UPDATE SET application_id=excluded.application_id,source='paid',status='active',
        product_id=excluded.product_id,product_identifier=excluded.product_identifier,
        expires_at=excluded.expires_at,verified_at=excluded.verified_at,granted_by=NULL,revoked_at=NULL`,
    [actor.id, candidate.id, candidate.productId, candidate.productIdentifier, expiresAt]);
    await db.query("UPDATE premium_applications SET status='active' WHERE id=$1", [candidate.id]);
    const notificationStatus = application.status === 'paid_approved' ? 'active' : renewed ? 'renewed' : null;
    if (notificationStatus) {
      const key = notificationStatus === 'renewed' ? `renewed:${expiresAt.toISOString()}` : notificationStatus;
      await notifyPremiumStatus(db, actor.id, application.decided_by ?? actor.id, candidate.id, notificationStatus, key);
    }
  });
  res.json(GetMyPremiumResponse.parse(await premiumAccount(actor.id)));
}));

router.put('/premium/preferences', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(UpdatePremiumPreferencesBody, req.body);
  const preferences = await transaction(async (db) => {
    const membership = await db.query(`SELECT 1 FROM premium_memberships WHERE user_id=$1 AND status='active'
      AND (source='free' OR expires_at>now()) FOR UPDATE`, [actor.id]);
    if (!membership.rowCount) return fail(403, 'Görünüm seçenekleri yalnızca etkin Premium üyelerine açıktır.');
    return (await db.query(`INSERT INTO premium_style_preferences
      (user_id,profile_frame,profile_background,chat_effect,store_design,updated_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp())
      ON CONFLICT(user_id) DO UPDATE SET profile_frame=excluded.profile_frame,
        profile_background=excluded.profile_background,chat_effect=excluded.chat_effect,
        store_design=excluded.store_design,updated_at=excluded.updated_at
      RETURNING profile_frame AS "profileFrame",profile_background AS "profileBackground",
        chat_effect AS "chatEffect",store_design AS "storeDesign",updated_at AS "updatedAt"`,
    [actor.id, input.profileFrame, input.profileBackground, input.chatEffect, input.storeDesign])).rows[0];
  });
  res.json(UpdatePremiumPreferencesResponse.parse({ ...preferences, updatedAt: new Date(preferences.updatedAt) }));
}));

export default router;
