import { pool } from '@workspace/db';
import { transaction } from './community';
import { member } from './direct-messages';
import { directEvent } from './direct-events';
import { directPhotoObject } from './bulletin-storage';
import { logger } from './logger';

const due = `(m.gif IS NOT NULL OR m.photo_id IS NOT NULL) AND m.deleted_at IS NULL
  AND m.media_expired_at IS NULL AND m.created_at<=now()-interval '7 days'`;
/** Server time is authoritative. DTOs/access checks redact at the deadline even if this sweep fails. */
export async function expireDirectMedia(actor: string) {
  const threads = (await pool.query<{ id: string }>(`SELECT c.id FROM conversations c
    WHERE (c.user_low=$1 OR c.user_high=$1) AND EXISTS(SELECT 1 FROM direct_messages m WHERE m.thread_id=c.id AND ${due}) LIMIT 20`, [actor])).rows;
  for (const thread of threads) await transaction(async client => {
    const pair = await member(thread.id, actor, client, true);
    const expired = (await client.query<{ id: string; photo_id: string | null }>(`UPDATE direct_messages SET gif=NULL,
      media_expired_at=clock_timestamp(),change_sequence=nextval('direct_message_change_seq') WHERE id IN
      (SELECT m.id FROM direct_messages m WHERE m.thread_id=$1 AND ${due} LIMIT 100)
      RETURNING id,photo_id`, [thread.id])).rows;
    if (!expired.length) return;
    await client.query("UPDATE direct_messages SET change_sequence=nextval('direct_message_change_seq') WHERE thread_id=$1 AND reply_to_id=ANY($2::uuid[])", [thread.id, expired.map(row => row.id)]);
    await client.query('UPDATE direct_message_uploads SET delete_requested_at=coalesce(delete_requested_at,clock_timestamp()) WHERE id=ANY($1::uuid[])', [expired.map(row => row.photo_id).filter(Boolean)]);
    await directEvent(client, pair, thread.id, 'sync');
  });
  return !!(await pool.query(`SELECT 1 FROM conversations c JOIN direct_messages m ON m.thread_id=c.id
    WHERE (c.user_low=$1 OR c.user_high=$1) AND ${due} LIMIT 1`, [actor])).rowCount;
}

/**
 * System sweep for expired media. It runs independently of user sessions, so
 * messages and photo files are cleaned even when neither participant opens
 * the app. A bounded batch and transaction-scoped advisory lock make this
 * safe across multiple API instances.
 */
export async function sweepExpiredDirectMedia(threadIds?: string[]) {
  const expired = await transaction(async client => {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('afilli:direct-media-expiry')) AS acquired");
    if (!lock.rows[0]?.acquired) return null;

    const rows = (await client.query<{ id: string; thread_id: string; photo_id: string | null }>(`WITH due_messages AS (
      SELECT m.id FROM direct_messages m
      WHERE ${due} AND ($1::uuid[] IS NULL OR m.thread_id=ANY($1::uuid[]))
      ORDER BY m.created_at,m.id LIMIT 500 FOR UPDATE SKIP LOCKED
    )
    UPDATE direct_messages m SET gif=NULL,media_expired_at=clock_timestamp(),
      change_sequence=nextval('direct_message_change_seq')
    FROM due_messages d WHERE m.id=d.id RETURNING m.id,m.thread_id,m.photo_id`, [threadIds ?? null])).rows;

    const byThread = new Map<string, typeof rows>();
    for (const row of rows) {
      const current = byThread.get(row.thread_id) ?? [];
      current.push(row);
      byThread.set(row.thread_id, current);
    }
    for (const [threadId, messages] of byThread) {
      const messageIds = messages.map(message => message.id);
      await client.query('UPDATE direct_messages SET change_sequence=nextval(\'direct_message_change_seq\') WHERE thread_id=$1 AND reply_to_id=ANY($2::uuid[])',
        [threadId, messageIds]);
      const photoIds = messages.map(message => message.photo_id).filter((id): id is string => !!id);
      if (photoIds.length) await client.query(
        'UPDATE direct_message_uploads SET delete_requested_at=coalesce(delete_requested_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',
        [photoIds]);
      const pair = (await client.query<{ user_low: string; user_high: string }>(
        'SELECT user_low,user_high FROM conversations WHERE id=$1', [threadId])).rows[0];
      if (pair) await directEvent(client, pair, threadId, 'sync');
    }
    return rows;
  });

  if (expired === null) return { processed: 0, hasMore: true, locked: false };
  const more = await pool.query(`SELECT 1 FROM direct_messages m
    WHERE ${due} AND ($1::uuid[] IS NULL OR m.thread_id=ANY($1::uuid[])) LIMIT 1`, [threadIds ?? null]);
  return { processed: expired.length, hasMore: !!more.rowCount, locked: true };
}
const cleanupDue = `(delete_requested_at IS NOT NULL OR thread_id IS NULL OR owner_id IS NULL OR
  attached_at IS NULL AND created_at<=now()-interval '7 days')
  AND (purged_at IS NULL OR purged_at<source_put_until AND now()>source_put_until)`;
/** Retain cleanup intent through failures/account deletion; never forget unremoved bytes. */
export async function purgeDirectPhotoQueue(): Promise<{ hasMore: boolean; retryNeeded: boolean }> {
  const lock = await pool.connect();
  let acquired = false;
  try {
    acquired = !!(await lock.query("SELECT pg_try_advisory_lock(hashtext('afilli:direct-media-cleanup')) AS ok")).rows[0]?.ok;
    if (!acquired) return { hasMore: false, retryNeeded: true };
    const rows = (await lock.query<{ id: string }>(`UPDATE direct_message_uploads
      SET delete_requested_at=coalesce(delete_requested_at,clock_timestamp()) WHERE id IN
      (SELECT id FROM direct_message_uploads WHERE ${cleanupDue} LIMIT 25 FOR UPDATE SKIP LOCKED) RETURNING id`)).rows;
    let retryNeeded = false;
    await Promise.all(rows.map(async row => {
      try {
        await Promise.all(['source', 'image'].map(part => directPhotoObject(`${row.id}/${part}`).delete({ ignoreNotFound: true })));
        // If an earlier PUT URL is still valid, one final purge becomes due
        // after it expires. This also catches late uploads after deletion.
        await lock.query('UPDATE direct_message_uploads SET purged_at=clock_timestamp() WHERE id=$1', [row.id]);
      } catch {
        retryNeeded = true;
        logger.warn('Özel mesaj fotoğrafının fiziksel temizliği yeniden denenecek');
      }
    }));
    const hasMore = !!(await lock.query(`SELECT 1 FROM direct_message_uploads WHERE ${cleanupDue} LIMIT 1`)).rowCount;
    return { hasMore: hasMore && !retryNeeded, retryNeeded };
  } finally {
    if (acquired) await lock.query("SELECT pg_advisory_unlock(hashtext('afilli:direct-media-cleanup'))");
    lock.release();
  }
}
