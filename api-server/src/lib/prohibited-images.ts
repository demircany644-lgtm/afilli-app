import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool } from '@workspace/db';
import type { PoolClient } from '@workspace/db';
import { fail, transaction } from './community';
import { moderationObject } from './bulletin-storage';

export const PROHIBITED_IMAGE_DISTANCE = 6;
const HASH_SIZE = 32;
const VARIANT_SCALES = [1, 0.86, 0.72, 0.58] as const;
const DCT = Array.from({ length: 8 }, (_, frequency) =>
  Array.from({ length: HASH_SIZE }, (_, position) =>
    Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * HASH_SIZE))));

export type ProhibitedImageArea = 'profile' | 'bulletin' | 'book' | 'private_message';
export type ProhibitedImageMatch = { referenceId: string; distance: number };
type ReferenceRow = { id: string; hashes: string[] };
type Database = PoolClient | typeof pool;

function cropHashes(pixels: Buffer, width: number, height: number): string[] {
  const result: string[] = [];
  for (const scale of VARIANT_SCALES) {
    const cropWidth = Math.max(1, Math.round(width * scale));
    const cropHeight = Math.max(1, Math.round(height * scale));
    const xs = scale === 1 ? [0] : [0, Math.round((width - cropWidth) / 2), width - cropWidth];
    const ys = scale === 1 ? [0] : [0, Math.round((height - cropHeight) / 2), height - cropHeight];
    for (const top of new Set(ys)) for (const left of new Set(xs)) {
      const sample = new Float64Array(HASH_SIZE * HASH_SIZE);
      for (let y = 0; y < HASH_SIZE; y++) {
        const sourceY = Math.min(height - 1, top + Math.floor((y + 0.5) * cropHeight / HASH_SIZE));
        for (let x = 0; x < HASH_SIZE; x++) {
          const sourceX = Math.min(width - 1, left + Math.floor((x + 0.5) * cropWidth / HASH_SIZE));
          sample[y * HASH_SIZE + x] = pixels[sourceY * width + sourceX];
        }
      }
      const coefficients: number[] = [];
      for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let y = 0; y < HASH_SIZE; y++) {
          const cy = DCT[v][y];
          for (let x = 0; x < HASH_SIZE; x++) sum += sample[y * HASH_SIZE + x] * DCT[u][x] * cy;
        }
        coefficients.push(sum);
      }
      const sorted = coefficients.slice(1).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      let binary = '';
      for (const value of coefficients) binary += value > median ? '1' : '0';
      result.push(BigInt(`0b${binary}`).toString(16).padStart(16, '0'));
    }
  }
  return result;
}

export async function imagePerceptualHashes(bytes: Buffer): Promise<string[]> {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) return fail(400, 'Fotoğraf boyutu geçersiz.');
  try {
    const { data, info } = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, animated: false })
      .rotate().resize(HASH_SIZE * 8, HASH_SIZE * 8, { fit: 'contain', background: '#fff' })
      .flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    return cropHashes(data, info.width, info.height);
  } catch {
    return fail(400, 'Fotoğraf okunamadı. JPEG, PNG veya WebP görseli seç.');
  }
}

function hammingDistance(left: string, right: string): number {
  let count = 0;
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    let value = Number.parseInt(left[i], 16) ^ Number.parseInt(right[i], 16);
    while (value) { count += value & 1; value >>>= 1; }
  }
  return count;
}

export async function findProhibitedImageMatch(bytes: Buffer, db: Database = pool): Promise<ProhibitedImageMatch | null> {
  const references = await db.query<ReferenceRow>(
    `SELECT id,hashes FROM prohibited_image_references WHERE ready AND cardinality(hashes)>0
      ORDER BY created_at,id LIMIT 6`,
  );
  // Do not arm moderation until the administrator has completed the minimum
  // five-reference setup. Partial setup remains visible but cannot misfire.
  if (references.rows.length < 5) return null;
  const hashes = await imagePerceptualHashes(bytes);
  let match: ProhibitedImageMatch | null = null;
  for (const reference of references.rows) {
    for (const candidateHash of hashes) for (const referenceHash of reference.hashes) {
      const distance = hammingDistance(candidateHash, referenceHash);
      if (distance <= PROHIBITED_IMAGE_DISTANCE && (!match || distance < match.distance)) {
        match = { referenceId: reference.id, distance };
      }
    }
  }
  return match;
}

async function privateEvidence(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, animated: false })
    .rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true }).toBuffer();
}

export async function recordProhibitedImageAttempt(
  userId: string, area: ProhibitedImageArea, bytes: Buffer, match: ProhibitedImageMatch,
) {
  const id = randomUUID(), evidencePath = `attempts/${id}.jpg`;
  const evidence = await privateEvidence(bytes);
  await moderationObject(evidencePath).save(evidence, {
    resumable: false, contentType: 'image/jpeg', metadata: { cacheControl: 'private,no-store' },
  });
  try {
    const result = await transaction(async db => {
      const account = await db.query<{ role: string; disabled: boolean }>(
        'SELECT role,disabled FROM afilli_auth_accounts WHERE user_id=$1 FOR UPDATE', [userId],
      );
      if (!account.rows[0]) return fail(404, 'Hesap bulunamadı.');
      const restricted = account.rows[0].role === 'user' && !account.rows[0].disabled;
      await db.query(`INSERT INTO prohibited_image_attempts(
          id,user_id,reference_id,area,evidence_path,distance,threshold,auto_block_applied,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
      [id, userId, match.referenceId, area, evidencePath, match.distance, PROHIBITED_IMAGE_DISTANCE, restricted]);
      if (restricted) {
        await db.query('UPDATE afilli_auth_accounts SET disabled=true WHERE user_id=$1', [userId]);
        await db.query(`UPDATE afilli_auth_sessions SET access_mode='contact'
          WHERE user_id=$1 AND revoked_at IS NULL`, [userId]);
      }
      return { id, restricted };
    });
    return result;
  } catch (error) {
    await moderationObject(evidencePath).delete({ ignoreNotFound: true }).catch(() => {});
    throw error;
  }
}

export function prohibitedImageFailure(caseId: string): never {
  return fail(403, `Fotoğraf yasaklı görsel denetiminde eşleşti ve gönderilmedi. İnceleme kodu: ${caseId}.`, 'prohibited_image');
}

export async function checkAndRecordProhibitedImage(
  userId: string, area: ProhibitedImageArea, bytes: Buffer,
) {
  const match = await findProhibitedImageMatch(bytes);
  if (!match) return null;
  return recordProhibitedImageAttempt(userId, area, bytes, match);
}
