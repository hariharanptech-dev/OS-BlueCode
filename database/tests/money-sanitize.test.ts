import { decimalStringToMinor, minorToDecimalString } from '../src/shared/money';
import { sanitizePayload } from '../src/shared/sanitize';
import { addDaysUtc } from '../src/shared/time';
import { requestFingerprint } from '../src/shared/fingerprint';

test('money round-trips with exact integer math', () => {
  expect(minorToDecimalString(49900, 'INR')).toBe('499.00');
  expect(minorToDecimalString(5, 'INR')).toBe('0.05');
  expect(decimalStringToMinor('499.00', 'INR')).toBe(49900);
  expect(decimalStringToMinor('0.10', 'INR') + decimalStringToMinor('0.20', 'INR')).toBe(30); // no 0.30000000000000004
  for (const bad of ['499', '499.5', '1e3', '-1.00', ' 1.00', '1.000']) expect(() => decimalStringToMinor(bad, 'INR')).toThrow();
  expect(() => minorToDecimalString(1.5, 'INR')).toThrow();
  expect(() => minorToDecimalString(100, 'XXX')).toThrow(/Unsupported/);
});
test('UTC expiry arithmetic is exactly N*24h', () => {
  const s = new Date('2026-03-28T10:00:00.000Z');
  expect(addDaysUtc(s, 30).toISOString()).toBe('2026-04-27T10:00:00.000Z');
  expect(() => addDaysUtc(s, 0)).toThrow();
});
test('sanitizer is an allow-list: secrets, hashes and card data never survive', () => {
  const out = sanitizePayload({ status: 'success', txnid: 'T1', hash: 'abc', salt: 's', key: 'merchantkey', cardnum: '4111111111111111', cvv: '123', name_on_card: 'X', email: 'a@b.c', phone: '99', nested: { cvv: '1' } });
  expect(out).toEqual({ status: 'success', txnid: 'T1' });
});
test('fingerprint is key-order independent', () => {
  expect(requestFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(requestFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  expect(requestFingerprint({ a: 1 })).not.toBe(requestFingerprint({ a: 2 }));
});
