import { pool, type PoolClient } from '@workspace/db';
import type { PremiumAccount, PremiumApplication, PremiumPreferences } from '@workspace/api-zod';
import { transaction } from './community';
import { revenueCatConfig, verifyActiveRevenueCatEntitlement } from './revenuecat-premium';

export const DEFAULT_PREMIUM_PREFERENCES: PremiumPreferences = {
  profileFrame: 'classic', profileBackground: 'classic', chatEffect: 'none', storeDesign: 'classic',
  updatedAt: new Date(0),
};

type Db = PoolClient | typeof pool;
type ApplicationRow = {
  id: string; packageIdentifier: string; productIdentifier: string; planName: string; status: PremiumApplication['status']; createdAt: Date;
};

export async function assertPremiumSchema() {
  const result = await pool.query(`SELECT
    (SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema()
      AND table_name IN ('premium_applications','premium_memberships','premium_style_preferences'))=3
    AND (SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='social_notifications' AND column_name IN ('application_id','notification_body'))=2 AS ready`);
  if (!result.rows[0]?.ready) {
    throw new Error('Premium release blocked: apply the additive premium schema before serving production traffic.');
  }
}

export function applicationRecord(row: ApplicationRow): PremiumApplication {
  return { ...row, createdAt: new Date(row.createdAt) };
}

export async function notifyPremiumStatus(
  db: Db, userId: string, actorId: string, applicationId: string, status: string, eventKey = status,
) {
  const body = status === 'paid_approved'
    ? 'Afilli Premium başvurun onaylandı. Üyeliğini etkinleştirmek için ödeme adımını tamamla.'
    : status === 'active'
      ? 'Afilli Premium üyeliğin etkinleştirildi.'
      : status === 'renewed'
        ? 'Afilli Premium üyeliğin yenilendi.'
        : status === 'expired'
          ? 'Afilli Premium süren sona erdi. Premium görünüm ayrıcalıkları kapatıldı.'
      : status === 'rejected'
        ? 'Afilli Premium başvurun reddedildi.'
        : 'Afilli Premium başvurun ücretsiz olarak onaylandı.';
  await db.query(`INSERT INTO social_notifications(recipient_id,actor_id,kind,event_key,application_id,notification_body)
    VALUES($1,$2,'premium_status',$3,$4,$5) ON CONFLICT(recipient_id,event_key) DO NOTHING`,
  [userId, actorId, `premium:${applicationId}:${eventKey}`, applicationId, body]);
}

export async function grantFreePremium(
  db: PoolClient, userId: string, applicationId: string, adminId: string,
) {
  await db.query(`INSERT INTO premium_memberships(user_id,application_id,source,status,granted_by,started_at)
    VALUES($1,$2,'free','active',$3,clock_timestamp())
    ON CONFLICT(user_id) DO UPDATE SET application_id=excluded.application_id,source='free',status='active',
      product_id=NULL,product_identifier=NULL,started_at=clock_timestamp(),expires_at=NULL,
      verified_at=NULL,granted_by=excluded.granted_by,revoked_at=NULL`,
  [userId, applicationId, adminId]);
}

type ActiveEntitlementResolver = (owner: string, productId: string, productIdentifier: string) => Promise<Date | null>;
const DEFAULT_ENTITLEMENT_REFRESH_INTERVAL = 5 * 60_000;
const ENTITLEMENT_REFRESH_WINDOW = 24 * 60 * 60_000;

export async function refreshPremiumEntitlement(
  userId: string,
  resolveActiveEntitlement: ActiveEntitlementResolver = async (owner, productId, productIdentifier) => {
    const config = await revenueCatConfig();
    return verifyActiveRevenueCatEntitlement(owner, productId, productIdentifier, config.projectId);
  },
) {
  const result = await pool.query<{
    applicationId: string;
    applicationStatus: string;
    productId: string | null;
    productIdentifier: string | null;
    status: string;
    expiresAt: Date | null;
    verifiedAt: Date | null;
  }>(`SELECT m.application_id AS "applicationId",a.status AS "applicationStatus",
      m.product_id AS "productId",m.product_identifier AS "productIdentifier",m.status,
      m.expires_at AS "expiresAt",m.verified_at AS "verifiedAt"
    FROM premium_memberships m JOIN premium_applications a ON a.id=m.application_id
    WHERE m.user_id=$1 AND m.source='paid' AND m.status IN ('active','expired') LIMIT 1`, [userId]);
  const membership = result.rows[0];
  if (!membership?.productId || !membership.productIdentifier) return;
  const now = Date.now();
  const expiresAt = membership.expiresAt ? new Date(membership.expiresAt).getTime() : 0;
  if (membership.status !== 'expired' && expiresAt - now > ENTITLEMENT_REFRESH_WINDOW) return;
  const verifiedAt = membership.verifiedAt ? new Date(membership.verifiedAt).getTime() : 0;
  if (verifiedAt && now - verifiedAt < DEFAULT_ENTITLEMENT_REFRESH_INTERVAL) return;

  const activeExpiry = await resolveActiveEntitlement(userId, membership.productId, membership.productIdentifier);
  if (!activeExpiry || activeExpiry.getTime() <= Date.now()) {
    await pool.query(`UPDATE premium_memberships SET verified_at=clock_timestamp()
      WHERE user_id=$1 AND application_id=$2 AND source='paid' AND status IN ('active','expired')`,
    [userId, membership.applicationId]);
    return;
  }

  await transaction(async (db) => {
    const current = (await db.query<{
      applicationId: string;
      applicationStatus: string;
      decidedBy: string | null;
      source: string;
      status: string;
      expiresAt: Date | null;
    }>(`SELECT m.application_id AS "applicationId",a.status AS "applicationStatus",
        a.decided_by AS "decidedBy",m.source,m.status,m.expires_at AS "expiresAt"
      FROM premium_memberships m JOIN premium_applications a ON a.id=m.application_id
      WHERE m.user_id=$1 FOR UPDATE OF m,a`, [userId])).rows[0];
    if (!current || current.applicationId !== membership.applicationId || current.source !== 'paid') return;
    const previousExpiry = current.expiresAt ? new Date(current.expiresAt).getTime() : 0;
    const needsRenewalNotice = current.status === 'expired' || current.applicationStatus === 'expired'
      || activeExpiry.getTime() > previousExpiry + 1000;
    await db.query(`UPDATE premium_memberships SET status='active',expires_at=$2,verified_at=clock_timestamp(),
      revoked_at=NULL WHERE user_id=$1 AND source='paid'`, [userId, activeExpiry]);
    await db.query(`UPDATE premium_applications SET status='active'
      WHERE id=$1 AND user_id=$2 AND status IN ('active','expired')`, [current.applicationId, userId]);
    if (needsRenewalNotice) {
      await notifyPremiumStatus(
        db, userId, current.decidedBy ?? userId, current.applicationId, 'renewed',
        `renewed:${activeExpiry.toISOString()}`,
      );
    }
  });
}

export async function premiumAccount(userId: string): Promise<PremiumAccount> {
  await transaction(async (db) => {
    const expired = await db.query<{ application_id: string }>(`UPDATE premium_memberships
      SET status='expired',revoked_at=coalesce(revoked_at,now())
      WHERE user_id=$1 AND source='paid' AND status='active' AND expires_at<=now()
      RETURNING application_id`, [userId]);
    for (const { application_id: applicationId } of expired.rows) {
      const application = await db.query<{ id: string }>(
        `UPDATE premium_applications SET status='expired' WHERE id=$1 AND user_id=$2 AND status='active' RETURNING id`,
        [applicationId, userId],
      );
      if (application.rowCount) await notifyPremiumStatus(db, userId, userId, applicationId, 'expired');
    }
  });
  const [application, membership, preferences] = await Promise.all([
    pool.query<ApplicationRow>(`SELECT id,package_identifier AS "packageIdentifier",product_identifier AS "productIdentifier",
      plan_name AS "planName",status,created_at AS "createdAt"
      FROM premium_applications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [userId]),
    pool.query<{ source: 'free' | 'paid'; expiresAt: Date | null }>(`SELECT source,expires_at AS "expiresAt"
      FROM premium_memberships WHERE user_id=$1 AND status='active'
        AND (source='free' OR expires_at>now())`, [userId]),
    pool.query<PremiumPreferences>(`SELECT profile_frame AS "profileFrame",profile_background AS "profileBackground",
      chat_effect AS "chatEffect",store_design AS "storeDesign",updated_at AS "updatedAt"
      FROM premium_style_preferences WHERE user_id=$1`, [userId]),
  ]);
  const active = membership.rows[0] ?? null;
  const prefs = preferences.rows[0];
  return {
    active: !!active,
    source: active?.source ?? null,
    expiresAt: active?.expiresAt ? new Date(active.expiresAt) : null,
    application: application.rows[0] ? applicationRecord(application.rows[0]) : null,
    preferences: prefs ? { ...prefs, updatedAt: new Date(prefs.updatedAt) } : DEFAULT_PREMIUM_PREFERENCES,
  };
}
