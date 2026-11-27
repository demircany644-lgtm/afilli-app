import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';
if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_DEV_DOMAIN) throw Error('Development only. Use Publish for managed production.');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./gif-library.sql', import.meta.url), 'utf8'));
  const result = await client.query(`SELECT count(*)=10 AS ok FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gif_library'
    AND column_name IN ('id','owner_id','client_id','title','object_path','size','ready','width','height','created_at')`);
  if (!result.rows[0]?.ok) throw Error('GIF collection schema verification failed.');
  await client.query('COMMIT');
  process.stdout.write('Development GIF collection schema verified; existing data unchanged.\n');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
