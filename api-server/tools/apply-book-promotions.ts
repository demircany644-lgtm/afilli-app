import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';

if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) {
  throw new Error('Development-only schema setup. Use Replit Publish for production schema updates.');
}

const client = await pool.connect();
try {
  await client.query(await readFile(new URL('./book-promotions.sql', import.meta.url), 'utf8'));
  const result = await client.query(`SELECT
    to_regclass('book_promotion_settings') IS NOT NULL
    AND to_regclass('book_promotion_requests') IS NOT NULL
    AND (SELECT allowed_durations=ARRAY[3,7,15,30] FROM book_promotion_settings WHERE id=true)
    AS ok`);
  if (!result.rows[0]?.ok) throw new Error('Additive book promotion schema verification failed.');
  console.log('Development promotion tables verified; existing books and account data were not changed.');
} finally {
  client.release();
  await pool.end();
}
