import { readFileSync } from 'node:fs';
import { pool } from '@workspace/db';

if (process.env.NODE_ENV === 'production') throw new Error('Production migrations require explicit approval.');
try {
  await pool.query(readFileSync(new URL('./direct-messages.sql', import.meta.url), 'utf8'));
  await pool.query(readFileSync(new URL('./direct-message-media.sql', import.meta.url), 'utf8'));
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='direct_messages' AND column_name=ANY($1)`,
  [['sequence', 'payload_hash', 'reply_to_id', 'has_reply', 'gif', 'photo_id', 'change_sequence', 'deleted_at', 'media_expired_at']]);
  if (rows[0]?.n !== 9) throw new Error('Direct message schema verification failed.');
  const uploads = await pool.query("SELECT to_regclass('direct_message_uploads') IS NOT NULL AS ready");
  if (!uploads.rows[0]?.ready) throw new Error('Private message photo storage schema verification failed.');
  console.log('Direct message columns and stable ordering are ready.');
} finally { await pool.end(); }
