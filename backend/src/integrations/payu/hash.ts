import { createHash, timingSafeEqual } from 'crypto';

/**
 * Hash rules verified against docs.payu.in (Authentication with PayU APIs, Hosted Checkout,
 * Verify Payment API). Do NOT change field order without re-checking the docs.
 *
 *  Request : sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
 *  Response: sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 *            with additionalCharges: sha512(additionalCharges|SALT|status||||||udf5|...|key)
 *  API     : sha512(key|command|var1|SALT)
 */
const sha512 = (s: string) => createHash('sha512').update(s, 'utf8').digest('hex');

export interface PaymentHashInput {
  key: string; txnid: string; amount: string; productinfo: string; firstname: string; email: string;
  udf1?: string; udf2?: string; udf3?: string; udf4?: string; udf5?: string;
}

export function requestHash(p: PaymentHashInput, salt: string): string {
  return sha512([
    p.key, p.txnid, p.amount, p.productinfo, p.firstname, p.email,
    p.udf1 ?? '', p.udf2 ?? '', p.udf3 ?? '', p.udf4 ?? '', p.udf5 ?? '',
    '', '', '', '', '', salt,
  ].join('|'));
}

export function responseHash(r: Record<string, string | undefined>, salt: string): string {
  const g = (k: string) => r[k] ?? '';
  const parts = [
    salt, g('status'), '', '', '', '', '',
    g('udf5'), g('udf4'), g('udf3'), g('udf2'), g('udf1'),
    g('email'), g('firstname'), g('productinfo'), g('amount'), g('txnid'), g('key'),
  ];
  // PayU docs: when additionalCharges is posted back, it is prepended to the reverse hash string.
  if (r['additionalCharges']) parts.unshift(r['additionalCharges']);
  return sha512(parts.join('|'));
}

export function apiHash(key: string, command: string, var1: string, salt: string): string {
  return sha512([key, command, var1, salt].join('|'));
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a.trim().toLowerCase(), 'utf8');
  const y = Buffer.from(b.trim().toLowerCase(), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
