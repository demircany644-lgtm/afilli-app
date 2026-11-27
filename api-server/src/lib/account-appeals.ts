import { pool, type PoolClient } from '@workspace/db';
import type {
  AccountAppeal, AccountAppealConfig, AccountAppealSelf, AdminAccountAppeal,
  AdminAccountAppealPage, AdminAccountAppealDecisionInput,
} from '@workspace/api-zod';
import { fail, transaction } from './community';
import { accountAppealRevenueCatConfig, verifyRevenueCatOneTimePurchase } from './revenuecat-premium';
import { audit, reasonText } from './admin';

type Db = PoolClient | typeof pool;
type AppealRow = {
  id: string; status: AccountAppeal['status']; productIdentifier: string; packageIdentifier: string;
  platform: AccountAppeal['platform']; transactionId: string | null; paymentStatus: 'verified';
  paymentVerifiedAt: Date; createdAt: Date; decidedAt: Date | null; decisionReason: string | null;
};
type BlockRow = { disabled: boolean; blockReason: string | null; blockedAt: Date | null };

function accountAppealRecord(row: AppealRow): AccountAppeal {
  return {
    ...row,
    paymentVerifiedAt: new Date(row.paymentVerifiedAt),
    createdAt: new Date(row.createdAt),
    decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
  };
}

async function blockSnapshot(db: Db, userId: string): Promise<BlockRow> {
  const result = await db.query<BlockRow>(`SELECT a.disabled,
      coalesce(block.reason, 'Yönetici tarafından erişim kısıtlandı.') AS "blockReason",
      coalesce(block.created_at, a.created_at) AS "blockedAt"
    FROM afilli_auth_accounts a
    LEFT JOIN LATERAL (
      SELECT reason,created_at FROM admin_audit
      WHERE target_type='account' AND target_id=a.user_id AND action='account.update'
        AND changes #>> '{after,disabled}'='true'
      ORDER BY created_at DESC,id DESC LIMIT 1
    ) block ON true
    WHERE a.user_id=$1`, [userId]);
  return result.rows[0] ?? fail(401, 'Oturumun sona erdi. Yeniden giriş yap.');
}

export async function assertAccountAppealsSchema() {
  const result = await pool.query(`SELECT
    to_regclass('account_appeals') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='afilli_auth_sessions' AND column_name='access_mode')
    AND to_regclass('account_appeals_one_pending_per_user') IS NOT NULL AS ready`);
  if (!result.rows[0]?.ready) {
    throw new Error('Account appeal release blocked: apply the additive account-appeal schema before serving traffic.');
  }
}

export async function accountAppealConfig(): Promise<AccountAppealConfig> {
  const config = await accountAppealRevenueCatConfig();
  return {
    configured: config.configured,
    message: config.message,
    iosPublicKey: config.iosPublicKey,
    androidPublicKey: config.androidPublicKey,
    packages: config.packages.map(item => ({
      packageIdentifier: item.packageIdentifier,
      productIdentifier: item.productIdentifier,
      productName: item.productName,
      platform: item.platform,
    })),
    priceAmount: 200,
    currency: 'TRY',
  };
}

export async function accountAppealSelf(userId: string): Promise<AccountAppealSelf> {
  const [block, latest] = await Promise.all([
    blockSnapshot(pool, userId),
    pool.query<AppealRow>(`SELECT id,status,product_identifier AS "productIdentifier",
      package_identifier AS "packageIdentifier",platform,transaction_id AS "transactionId",
      payment_status AS "paymentStatus",payment_verified_at AS "paymentVerifiedAt",
      created_at AS "createdAt",decided_at AS "decidedAt",decision_reason AS "decisionReason"
      FROM account_appeals WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [userId]),
  ]);
  return {
    blocked: block.disabled,
    appeal: latest.rows[0] ? accountAppealRecord(latest.rows[0]) : null,
    blockReason: block.disabled ? block.blockReason : null,
    blockedAt: block.disabled && block.blockedAt ? new Date(block.blockedAt) : null,
  };
}

export async function verifyAndCreateAccountAppeal(
  userId: string,
  input: { productIdentifier: string; packageIdentifier: string; platform: 'ios' | 'android'; transactionId: string },
): Promise<{ appeal: AccountAppeal; created: boolean }> {
  const config = await accountAppealRevenueCatConfig();
  if (!config.configured || !config.projectId) return fail(503, config.message ?? 'Tek seferlik ödeme şu anda yapılandırılmamış.');
  const product = config.packages.find(item =>
    item.packageIdentifier === input.packageIdentifier
    && item.productIdentifier === input.productIdentifier
    && item.platform === input.platform);
  if (!product || product.packageIdentifier !== 'account_appeal') {
    return fail(400, 'Ödeme, engel kaldırma için tanımlı tek seferlik mağaza ürünüyle eşleşmiyor.');
  }

  const initialBlock = await blockSnapshot(pool, userId);
  if (!initialBlock.disabled) return fail(409, 'Bu hesap şu anda engelli değil.');
  if (!initialBlock.blockedAt) return fail(409, 'Engel tarihi doğrulanamadı. Yöneticiyle iletişime geç.');
  const purchase = await verifyRevenueCatOneTimePurchase(
    userId, product.productId, product.productIdentifier, input.transactionId,
    config.projectId, new Date(initialBlock.blockedAt),
  );
  if (!purchase) return fail(402, 'RevenueCat bu hesaba ait, engel tarihinden sonra yapılmış başarılı ödemeyi doğrulayamadı. Talep oluşturulmadı.');

  try {
    return await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`account-appeal:${userId}`]);
    const existingTransaction = await db.query<AppealRow>(`SELECT id,status,product_identifier AS "productIdentifier",
      package_identifier AS "packageIdentifier",platform,transaction_id AS "transactionId",
      payment_status AS "paymentStatus",payment_verified_at AS "paymentVerifiedAt",
      created_at AS "createdAt",decided_at AS "decidedAt",decision_reason AS "decisionReason"
      FROM account_appeals WHERE transaction_id=$1 FOR UPDATE`, [purchase.transactionId]);
    if (existingTransaction.rows[0]) {
      if ((await db.query('SELECT user_id FROM account_appeals WHERE transaction_id=$1', [purchase.transactionId])).rows[0]?.user_id !== userId) {
        return fail(409, 'Bu ödeme başka bir başvuruda kullanılmış.');
      }
      return { appeal: accountAppealRecord(existingTransaction.rows[0]), created: false };
    }
    const lockedAccount = await db.query<{ disabled: boolean }>(
      'SELECT disabled FROM afilli_auth_accounts WHERE user_id=$1 FOR UPDATE', [userId]);
    if (!lockedAccount.rows[0]?.disabled) return fail(409, 'Hesap ödeme doğrulanırken yönetici tarafından açıldı; yeni talep oluşturulmadı.');
    const currentBlock = await blockSnapshot(db, userId);
    if (!currentBlock.disabled) return fail(409, 'Hesap ödeme doğrulanırken yönetici tarafından açıldı; yeni talep oluşturulmadı.');
    if (!currentBlock.blockedAt || purchase.purchasedAt < new Date(currentBlock.blockedAt)) {
      return fail(409, 'Bu ödeme mevcut engel tarihinden eski; yeni bir ödeme doğrulanmalı.');
    }
    const pending = await db.query('SELECT 1 FROM account_appeals WHERE user_id=$1 AND status=$2 LIMIT 1', [userId, 'pending']);
    if (pending.rowCount) return fail(409, 'Zaten incelemede olan bir engel kaldırma talebin var.');
    const inserted = await db.query<AppealRow>(`INSERT INTO account_appeals(
        user_id,product_identifier,package_identifier,platform,transaction_id,payment_status,
        payment_verified_at,status,block_reason,blocked_at)
      VALUES($1,$2,$3,$4,$5,'verified',$6,'pending',$7,$8)
      RETURNING id,status,product_identifier AS "productIdentifier",package_identifier AS "packageIdentifier",
        platform,transaction_id AS "transactionId",payment_status AS "paymentStatus",
        payment_verified_at AS "paymentVerifiedAt",created_at AS "createdAt",
        decided_at AS "decidedAt",decision_reason AS "decisionReason"`, [
      userId, product.productIdentifier, product.packageIdentifier, input.platform,
      purchase.transactionId, purchase.purchasedAt, currentBlock.blockReason ?? 'Yönetici tarafından erişim kısıtlandı.',
      currentBlock.blockedAt,
    ]);
    return { appeal: accountAppealRecord(inserted.rows[0]), created: true };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return fail(409, 'Bu ödeme veya hesap için zaten bir engel kaldırma talebi mevcut.');
    throw error;
  }
}

export async function adminAccountAppeals(offset: number): Promise<AdminAccountAppealPage> {
  const result = await pool.query<AdminAccountAppeal & { createdAt: Date; paymentVerifiedAt: Date; decidedAt: Date | null; blockedAt: Date }>(
    `SELECT p.id,p.user_id AS "userId",u.nickname,coalesce(a.email,'') AS email,u.avatar,u.cover,
      p.status,p.product_identifier AS "productIdentifier",p.package_identifier AS "packageIdentifier",
      p.platform,p.transaction_id AS "transactionId",p.payment_status AS "paymentStatus",
      p.payment_verified_at AS "paymentVerifiedAt",p.created_at AS "createdAt",
      p.decided_at AS "decidedAt",p.decision_reason AS "decisionReason",
      p.block_reason AS "blockReason",p.blocked_at AS "blockedAt"
    FROM account_appeals p
    JOIN community_users u ON u.id=p.user_id
    LEFT JOIN afilli_auth_accounts a ON a.user_id=p.user_id
    ORDER BY CASE WHEN p.status='pending' THEN 0 ELSE 1 END,p.created_at DESC,p.id DESC
    LIMIT 25 OFFSET $1`, [offset]);
  const total = Number((await pool.query('SELECT count(*)::int AS n FROM account_appeals')).rows[0]?.n ?? 0);
  const items = result.rows.map(row => ({
    ...row,
    paymentVerifiedAt: new Date(row.paymentVerifiedAt),
    createdAt: new Date(row.createdAt),
    blockedAt: new Date(row.blockedAt),
    decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
  }));
  return { items, total, nextOffset: offset + 25 < total ? offset + 25 : null };
}

export async function decideAccountAppeal(
  db: PoolClient, actor: { id: string }, id: string, input: AdminAccountAppealDecisionInput,
) {
  const reason = reasonText(input.reason);
  const row = (await db.query<AdminAccountAppeal & { createdAt: Date; paymentVerifiedAt: Date; decidedAt: Date | null; blockedAt: Date }>(
    `SELECT p.id,p.user_id AS "userId",u.nickname,coalesce(a.email,'') AS email,u.avatar,u.cover,
      p.status,p.product_identifier AS "productIdentifier",p.package_identifier AS "packageIdentifier",
      p.platform,p.transaction_id AS "transactionId",p.payment_status AS "paymentStatus",
      p.payment_verified_at AS "paymentVerifiedAt",p.created_at AS "createdAt",
      p.decided_at AS "decidedAt",p.decision_reason AS "decisionReason",
      p.block_reason AS "blockReason",p.blocked_at AS "blockedAt"
    FROM account_appeals p
    JOIN community_users u ON u.id=p.user_id
    LEFT JOIN afilli_auth_accounts a ON a.user_id=p.user_id
    WHERE p.id=$1 FOR UPDATE OF p`, [id])).rows[0];
  if (!row) return fail(404, 'Engel kaldırma talebi bulunamadı.');
  if (row.status !== 'pending' || row.paymentStatus !== 'verified') return fail(409, 'Bu talep beklemede değil veya doğrulanmış ödeme kaydı yok.');

  const nextStatus = input.decision === 'approve' ? 'approved' : 'rejected';
  if (input.decision === 'approve') {
    await db.query('UPDATE afilli_auth_accounts SET disabled=false WHERE user_id=$1', [row.userId]);
    await db.query(`UPDATE afilli_auth_sessions SET access_mode='normal'
      WHERE user_id=$1 AND revoked_at IS NULL AND access_mode='appeal'`, [row.userId]);
  }
  await db.query(`UPDATE account_appeals SET status=$2,decided_at=clock_timestamp(),decided_by=$3,decision_reason=$4
    WHERE id=$1`, [id, nextStatus, actor.id, reason]);

  const body = input.decision === 'approve'
    ? 'Engel kaldırma başvurun onaylandı. Hesabın yeniden etkinleştirildi.'
    : 'Engel kaldırma başvurun reddedildi. Hesabına uygulanan kısıtlama devam ediyor.';
  await db.query(`INSERT INTO social_notifications(recipient_id,actor_id,kind,event_key,notification_body)
    VALUES($1,$2,'account_appeal',$3,$4) ON CONFLICT(recipient_id,event_key) DO NOTHING`,
  [row.userId, actor.id, `account-appeal:${id}:${nextStatus}`, body]);
  await audit(db, actor.id, `account_appeal.${input.decision}`, 'account_appeal', id, reason, {
    userId: row.userId, transactionId: row.transactionId, paymentStatus: row.paymentStatus, status: nextStatus,
  });

  return {
    ...row,
    status: nextStatus,
    paymentVerifiedAt: new Date(row.paymentVerifiedAt),
    createdAt: new Date(row.createdAt),
    blockedAt: new Date(row.blockedAt),
    decidedAt: new Date(),
    decisionReason: reason,
  };
}
