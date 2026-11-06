import { createHash } from 'crypto';
import { safeEqual, toPaise, amountsEqual } from '../../security/payu-hash';

export { safeEqual, toPaise, amountsEqual };

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
  if (r['additionalCharges']) parts.unshift(r['additionalCharges']);
  return sha512(parts.join('|'));
}

export function apiHash(key: string, command: string, var1: string, salt: string): string {
  return sha512([key, command, var1, salt].join('|'));
}

export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return safeEqual(a.trim().toLowerCase(), b.trim().toLowerCase());
}
