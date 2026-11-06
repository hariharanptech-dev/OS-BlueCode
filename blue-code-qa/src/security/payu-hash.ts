import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * PayU hash helpers (SHA-512, pipe-delimited).
 *  Request : key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
 *  Response: SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
 *            (prefixed with additionalCharges| when PayU returns that field)
 * Implemented from PayU's published format. Confirm against the PayU sandbox (see tests/sandbox).
 */
export interface PayUFields {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}

export function sha512Hex(input: string): string {
  return createHash('sha512').update(input, 'utf8').digest('hex');
}

export function requestHash(p: PayUFields, salt: string): string {
  const u = [p.udf1, p.udf2, p.udf3, p.udf4, p.udf5].map((v) => v ?? '');
  return sha512Hex([p.key, p.txnid, p.amount, p.productinfo, p.firstname, p.email, ...u, '', '', '', '', '', salt].join('|'));
}

export function responseHash(p: PayUFields & { status: string; additionalCharges?: string | undefined }, salt: string): string {
  const u = [p.udf5, p.udf4, p.udf3, p.udf2, p.udf1].map((v) => v ?? '');
  const core = [salt, p.status, '', '', '', '', '', ...u, p.email, p.firstname, p.productinfo, p.amount, p.txnid, p.key].join('|');
  return sha512Hex(p.additionalCharges ? `${p.additionalCharges}|${core}` : core);
}

/** Constant-time comparison; safe for different lengths / non-hex input. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing roughly uniform
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Verify verify_payment-API hash: sha512(key|command|var1|salt). */
export function verifyApiHash(key: string, command: string, var1: string, salt: string): string {
  return sha512Hex(`${key}|${command}|${var1}|${salt}`);
}

const AMOUNT_RE = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

/** Converts a canonical decimal amount string to integer paise; null if malformed. Never uses floats. */
export function toPaise(amount: string): number | null {
  if (!AMOUNT_RE.test(amount)) return null;
  const [whole = '0', frac = ''] = amount.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

export function amountsEqual(a: string, b: string): boolean {
  const pa = toPaise(a);
  const pb = toPaise(b);
  return pa !== null && pb !== null && pa === pb;
}

export function formatPaise(paise: number): string {
  return `${Math.trunc(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}
