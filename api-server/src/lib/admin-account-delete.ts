import type { PoolClient } from '@workspace/db';
import { pool } from '@workspace/db';
import { adminAccount, audit } from './admin';
import { fail, transaction } from './community';
import { bulletinObject, moderationObject, profileObject, writerObject } from './bulletin-storage';
import { logger } from './logger';

export async function deletionScope(db: PoolClient | typeof pool, id: string) {
  const account = await adminAccount(db, id);
  const result = await db.query(`SELECT
    (SELECT count(*)::int FROM authored_books WHERE author_id=$1) AS books,
    (SELECT count(*)::int FROM bulletins WHERE author_id=$1) AS bulletins,
    ((SELECT count(*) FROM writer_comments WHERE author_id=$1)+
      (SELECT count(*) FROM bulletin_comments WHERE author_id=$1))::int AS comments,
    (SELECT count(*)::int FROM conversations WHERE user_low=$1 OR user_high=$1) AS conversations,
    ((SELECT count(*) FROM writer_uploads WHERE owner_id=$1)+
      (SELECT count(*) FROM profile_uploads WHERE owner_id=$1)+
      (SELECT count(*) FROM bulletin_uploads WHERE owner_id=$1)+
      (SELECT count(*) FROM prohibited_image_attempts WHERE user_id=$1))::int AS media`, [id]);
  return { nickname: account.nickname, ...result.rows[0] };
}

export async function deleteAccount(db: PoolClient, actor: string, id: string, confirmation: string, reason: string) {
  if (actor === id) return fail(409, 'Kendi hesabını silmek için Ayarlar bölümünü kullan.');
  return purgeAccount(db, actor, id, confirmation, reason, false);
}

// Called only after password reauthentication, under the governance lock.
export async function deleteOwnAccount(db: PoolClient, id: string, confirmation: string, requestId?: string) {
  return purgeAccount(db, id, id, confirmation, 'Kullanıcı kendi hesabını kalıcı olarak sildi.', true, requestId);
}

async function purgeAccount(db: PoolClient, actor: string, id: string, confirmation: string, reason: string, selfService: boolean, requestId?: string) {
  // Blocks new FK-backed writes while removing all of this identity's data.
  await db.query('SELECT id FROM community_users WHERE id=$1 FOR UPDATE', [id]);
  const account = await adminAccount(db, id);
  if (confirmation !== account.nickname) return fail(409, 'Onay için güncel takma adı aynen yaz.');
  if (account.role === 'superadmin' && !account.disabled) {
    const count = (await db.query("SELECT count(*)::int AS n FROM afilli_auth_accounts WHERE role='superadmin' AND NOT disabled")).rows[0].n;
    if (count <= 1) return fail(409, 'Son üst yönetici silinemez. Önce başka bir etkin hesaba üst yönetici yetkisi devret.');
  }
  const scope = await deletionScope(db, id);
  // Persist storage work BEFORE removing ownership metadata, in the SAME tx.
  for (const [table, kind] of [['writer_uploads', 'writer'], ['profile_uploads', 'profiles'], ['bulletin_uploads', 'bulletins']]) {
    await db.query(`INSERT INTO account_media_deletions(kind,media_id,eligible_at)
      SELECT $2,id,now()+interval '20 minutes' FROM ${table} WHERE owner_id=$1
      ON CONFLICT(media_id) DO NOTHING`, [id, kind]);
  }
  await db.query(`INSERT INTO account_media_deletions(kind,media_id,eligible_at)
    SELECT 'moderation_attempt',id,now()+interval '20 minutes' FROM prohibited_image_attempts WHERE user_id=$1
    ON CONFLICT(media_id) DO NOTHING`, [id]);
  // Keep other authors' posts/replies, detaching links to deleted content.
  await db.query(`UPDATE bulletins SET book_id=NULL,
    body=CASE WHEN length(trim(body))=0 AND cardinality(photo_ids)=0 THEN 'Paylaşılan kitap kaldırıldı.' ELSE body END
    WHERE book_id IN (SELECT id FROM authored_books WHERE author_id=$1)`, [id]);
  await db.query(`UPDATE bulletin_comments SET parent_id=NULL,depth=1
    WHERE author_id<>$1 AND parent_id IN (SELECT id FROM bulletin_comments WHERE author_id=$1)`, [id]);
  await db.query(`DELETE FROM bulletin_reactions WHERE user_id=$1
    OR (target_type='comment' AND target_id IN (SELECT id FROM bulletin_comments WHERE author_id=$1
      OR post_id IN (SELECT id FROM bulletins WHERE author_id=$1)))
    OR (target_type='post' AND target_id IN (SELECT id FROM bulletins WHERE author_id=$1))`, [id]);
  await db.query(`DELETE FROM bulletin_notifications WHERE recipient_id=$1 OR actor_id=$1
    OR comment_id IN (SELECT id FROM bulletin_comments WHERE author_id=$1)`, [id]);
  await db.query('DELETE FROM social_notifications WHERE recipient_id=$1 OR actor_id=$1', [id]);
  await db.query(`DELETE FROM prohibited_image_contact_messages WHERE user_id=$1
    OR attempt_id IN (SELECT id FROM prohibited_image_attempts WHERE user_id=$1)`, [id]);
  await db.query('DELETE FROM prohibited_image_attempts WHERE user_id=$1', [id]);
  await db.query('DELETE FROM conversations WHERE user_low=$1 OR user_high=$1', [id]);
  await db.query('DELETE FROM direct_messages WHERE sender_id=$1', [id]);
  for (const [table, column] of [
    ['profile_follows', 'follower_id=$1 OR followed_id'],
    ['writer_comments', 'author_id'], ['bulletin_comments', 'author_id'],
    ['writer_likes', 'user_id'], ['bulletin_likes', 'user_id'], ['book_reads', 'reader_id'],
    ['bulletin_uploads', 'owner_id'], ['profile_uploads', 'owner_id'],
    ['writer_uploads', 'owner_id'], ['writer_voice_requests', 'owner_id'],
    ['writer_voice_usage', 'user_id'], ['writer_book_deletions', 'owner_id'],
    ['bulletins', 'author_id'], ['authored_books', 'author_id'],
    ['afilli_auth_codes', 'user_id'], ['afilli_auth_sessions', 'user_id'],
    ['afilli_auth_accounts', 'user_id'], ['admin_bootstrap_grants', 'user_id'],
  ]) {
    await db.query(`DELETE FROM ${table} WHERE ${column}=$1`, [id]);
  }
  await db.query('DELETE FROM community_users WHERE id=$1', [id]);
  await audit(db, actor, selfService ? 'account.self_delete' : 'account.delete', 'account', id, reason, {
    books: scope.books, bulletins: scope.bulletins, comments: scope.comments,
    conversations: scope.conversations, media: scope.media, ...(requestId ? { requestId } : {}),
  });
}

export async function cleanDeletedAccountMedia(
  remove = async (kind: string, id: string) => {
    if (kind === 'writer') {
      await writerObject(`${id}/source`).delete({ ignoreNotFound: true });
      await writerObject(`${id}/image`).delete({ ignoreNotFound: true });
    } else if (kind === 'profiles') {
      await Promise.all([
        profileObject(id).delete({ ignoreNotFound: true }),
        profileObject(`${id}/source`).delete({ ignoreNotFound: true }),
        profileObject(`${id}/image`).delete({ ignoreNotFound: true }),
      ]);
    } else if (kind === 'bulletins') {
      await Promise.all([
        bulletinObject(id).delete({ ignoreNotFound: true }),
        bulletinObject(`${id}/source`).delete({ ignoreNotFound: true }),
        bulletinObject(`${id}/image`).delete({ ignoreNotFound: true }),
      ]);
    } else if (kind === 'moderation_attempt') {
      await moderationObject(`attempts/${id}.jpg`).delete({ ignoreNotFound: true });
    }
    else throw new Error('Unknown deletion media kind');
  },
) {
  await transaction(async db => {
    const batch = await db.query<{ kind: string; media_id: string }>(`SELECT kind,media_id FROM account_media_deletions
      WHERE eligible_at<=now() ORDER BY eligible_at LIMIT 25 FOR UPDATE SKIP LOCKED`);
    for (const item of batch.rows) {
      try {
        await remove(item.kind, item.media_id);
        await db.query('DELETE FROM account_media_deletions WHERE media_id=$1', [item.media_id]);
      } catch {
        // Retain the durable job for the next retry; never log storage paths.
        logger.warn({ warning: 'account_media_deletion_retry' }, 'Silinen hesabın görsel temizliği yeniden denenecek');
      }
    }
  });
}
