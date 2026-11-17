import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const sessionSecret = () => randomBytes(32).toString('base64url');
let hashing = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  if (hashing >= 8) throw new Error('Password service busy');
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { hashing--; }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string | null) {
  const [, salt, hex] = encoded?.match(/^scrypt1\$([a-f0-9]{32})\$([a-f0-9]{128})$/) ?? [];
  // Similar work for accounts that do not exist or do not yet have a password.
  const candidate = await derive(password, salt || '00000000000000000000000000000000');
  return !!hex && timingSafeEqual(candidate, Buffer.from(hex, 'hex'));
}
