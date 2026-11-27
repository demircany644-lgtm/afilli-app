import { pool } from '@workspace/db';
import { readFileSync } from 'node:fs';
import { assertBookCommunitySchema } from '../src/lib/book-community-schema';
if (process.env.NODE_ENV === 'production') throw new Error('Development reconciliation only; production migrations require explicit approval.');
try {
  await pool.query(readFileSync(new URL('./book-community.sql', import.meta.url), 'utf8'));
  await pool.query(readFileSync(new URL('./reader-interactions.sql', import.meta.url), 'utf8'));
  await pool.query(readFileSync(new URL('./writer-book-copies.sql', import.meta.url), 'utf8'));
  await assertBookCommunitySchema();
  console.log('Book community schema and moderation trigger verified.');
} finally { await pool.end(); }
