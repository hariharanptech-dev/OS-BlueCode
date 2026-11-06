import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function scrypt(pw: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(pw.normalize('NFKC'), salt, keylen, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))),
  );
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scrypt(pw, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, s, h] = parts as [string, string, string, string, string, string];
  try {
    const expected = Buffer.from(h, 'base64');
    const dk = await scrypt(pw, Buffer.from(s, 'base64'), Number(n), Number(r), Number(p), expected.length);
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

/** Used to equalise work when the account does not exist (reduces user-enumeration via timing). */
export const DUMMY_HASH_PROMISE: Promise<string> = hashPassword('dummy-password-for-timing-equalisation');
