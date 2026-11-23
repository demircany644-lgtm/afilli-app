import { pool } from '@workspace/db';
import { readFileSync } from 'node:fs';
if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw new Error('Development reconciliation only; production migration requires explicit approval.');
try {
  await pool.query(readFileSync(new URL('./reader-interactions.sql', import.meta.url), 'utf8'));
  const result = await pool.query(`SELECT to_regclass('reader_paragraphs') IS NOT NULL
    AND to_regclass('reader_comment_targets') IS NOT NULL AND to_regclass('reader_likes') IS NOT NULL
    AND to_regclass('reader_reports') IS NOT NULL AND to_regclass('reader_comment_events') IS NOT NULL AS ok`);
  if (!result.rows[0]?.ok) throw new Error('Reader interaction tables were not installed.');
  console.log('Additive reader interaction schema verified; existing books and comments were not rewritten.');
} finally { await pool.end(); }
