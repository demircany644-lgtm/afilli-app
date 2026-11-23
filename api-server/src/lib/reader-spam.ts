import { createHash } from 'node:crypto';
import { fail, type Transaction } from './community';

/** Account-bound and persisted: reconnecting or deleting a post cannot reset it. */
export async function readerAction(db: Transaction, actor: string, body: string) {
  const hash = createHash('sha256').update(body.normalize('NFC').trim().replace(/\s+/g, ' ')).digest('hex');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('afilli-reader-action:'||$1))", [actor]);
  await db.query("DELETE FROM reader_comment_events WHERE created_at<now()-interval '2 minutes'");
  const row = (await db.query<{ total: number; repeated: number }>(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE body_hash=$2)::int AS repeated FROM reader_comment_events
    WHERE user_id=$1 AND created_at>now()-interval '1 minute'`, [actor, hash])).rows[0];
  if (row.total >= 30 || row.repeated >= 3) return fail(429, 'Çok sık veya aynı içerikle işlem yaptın. Bir dakika sonra tekrar dene.');
  await db.query('INSERT INTO reader_comment_events(user_id,body_hash) VALUES($1,$2)', [actor, hash]);
}
