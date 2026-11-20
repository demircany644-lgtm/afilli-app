import type { Request } from 'express';
import { pool } from '@workspace/db';
import { fail, requirePerson, transaction } from './community';
import { verifyPassword } from './auth-crypto';
import { deleteOwnAccount } from './admin-account-delete';
import { limitAuth } from './accounts';

export async function removeOwnAccount(req: Request, password: string, confirmation: string, requestId: string) {
  const actor = await requirePerson(req);
  await limitAuth(req, 'delete-own-account', actor.id, 5);
  await transaction(async db => {
    // Same lock/order as admin role and deletion writes: concurrent deletes or
    // demotions cannot each believe a different last administrator survives.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('afilli-admin-governance'))");
    const used = await db.query("SELECT 1 FROM admin_audit WHERE action='account.self_delete' AND changes->>'requestId'=$1 LIMIT 1", [requestId]);
    if (used.rowCount) return fail(409, 'Bu silme isteği daha önce işlendi. Hesap durumunu kontrol et.');
    await db.query('SELECT id FROM community_users WHERE id=$1 FOR UPDATE', [actor.id]);
    const account = (await db.query<{ password_hash: string | null; disabled: boolean }>(
      'SELECT password_hash,disabled FROM afilli_auth_accounts WHERE user_id=$1 FOR UPDATE', [actor.id])).rows[0];
    if (!account || account.disabled) return fail(401, 'Oturumun sona erdi. Yeniden giriş yap.');
    if (!await verifyPassword(password, account.password_hash)) return fail(403, 'Hesabını silmek için güncel şifreni doğru yaz.');
    await deleteOwnAccount(db, actor.id, confirmation, requestId);
  });
}
