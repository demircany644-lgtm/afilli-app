import { pool } from '@workspace/db';
import { readFileSync } from 'node:fs';
if (process.env.NODE_ENV === 'production') throw new Error('Development reconciliation only; production migrations require explicit approval.');
try {
  await pool.query(readFileSync(new URL('./reading-position.sql', import.meta.url), 'utf8'));
  const { rows } = await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='book_reading_positions' ORDER BY ordinal_position`);
  if (rows.map(r => r.column_name).join(',') !== 'reader_id,book_id,chapter_id,updated_at') throw new Error('Reading-position schema verification failed.');
  console.log('Reading-position schema verified.');
} finally { await pool.end(); }
