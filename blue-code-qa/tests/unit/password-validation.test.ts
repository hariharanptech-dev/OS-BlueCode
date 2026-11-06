import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordPolicyViolations, registerSchema, checkoutSchema, loginSchema, paginationSchema, orderIdSchema, callbackSchema, parse, AppError } from '../../src/security/index.ts';

describe('password hashing', () => {
  it('hashes with scrypt, unique salt per hash, and verifies', async () => {
    const a = await hashPassword('Correct-Horse-42');
    const b = await hashPassword('Correct-Horse-42');
    assert.notEqual(a, b);
    assert.match(a, /^scrypt\$16384\$8\$1\$/);
    assert.ok(!a.includes('Correct-Horse-42'));
    assert.equal(await verifyPassword('Correct-Horse-42', a), true);
    assert.equal(await verifyPassword('correct-horse-42', a), false);
  });
  it('rejects malformed or tampered stored hashes without throwing', async () => {
    assert.equal(await verifyPassword('x', 'garbage'), false);
    assert.equal(await verifyPassword('x', 'scrypt$1$1$1$AA$AA'), false);
    assert.equal(await verifyPassword('x', 'bcrypt$a$b$c$d$e'), false);
    const h = await hashPassword('Another-Pass-9');
    const tampered = h.slice(0, -4) + 'AAAA';
    assert.equal(await verifyPassword('Another-Pass-9', tampered), false);
  });
});

describe('password policy', () => {
  it('accepts a strong password', () => assert.deepEqual(passwordPolicyViolations('Correct-Horse-42'), []));
  for (const [pw, why] of [['short1', 'too short'], ['onlyletterslong', 'no digits'], ['12345678901', 'no letters'], ['password123', 'common'], ['aaaaaaaaaaaa', 'repeated'], ['x'.repeat(129) + '1', 'too long']] as const) {
    it(`rejects ${why}`, () => assert.ok(passwordPolicyViolations(pw).length > 0));
  }
  it('rejects passwords containing the email local part', () => assert.ok(passwordPolicyViolations('asharao-2026-x', { email: 'asharao@example.test' }).length > 0));
});

const bad = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof AppError && e.code === 'VALIDATION_FAILED');

describe('input validation (Zod, strict)', () => {
  const okReg = { name: "Asha O'Neil-Rao", email: 'A@Example.TEST ', password: 'x' };
  it('normalises email (trim + lowercase) and accepts unicode names', () => {
    assert.equal(parse(registerSchema, okReg).email, 'a@example.test');
    assert.ok(parse(registerSchema, { ...okReg, name: 'आशा राव' }));
  });
  it('rejects unknown keys (mass assignment / prototype pollution)', () => {
    bad(() => parse(registerSchema, { ...okReg, role: 'admin' }));
    bad(() => parse(registerSchema, JSON.parse('{"name":"A","email":"a@b.co","password":"x","__proto__":{"admin":true}}')));
    bad(() => parse(loginSchema, { email: 'a@b.co', password: 'x', isAdmin: true }));
  });
  it('rejects type confusion (NoSQL-style objects, arrays, numbers)', () => {
    bad(() => parse(loginSchema, { email: { $ne: null }, password: 'x' }));
    bad(() => parse(loginSchema, { email: ['a@b.co'], password: 'x' }));
    bad(() => parse(loginSchema, { email: 'a@b.co', password: 12345 }));
    bad(() => parse(registerSchema, null));
    bad(() => parse(registerSchema, 'string'));
  });
  for (const payload of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', "Robert'); DROP TABLE users;--", '" onmouseover="alert(1)', 'javascript:alert(1)', '${7*7}', '{{7*7}}', 'a\u0000b', 'A'.repeat(61), '']) {
    it(`rejects hostile/invalid name ${JSON.stringify(payload).slice(0, 40)}`, () => bad(() => parse(registerSchema, { ...okReg, name: payload })));
  }
  it('rejects invalid emails and phone numbers', () => {
    for (const e of ['', 'nope', 'a@', '@b.co', 'a b@c.co', 'a@b.co\r\nBcc: x@y.z', 'x'.repeat(250) + '@b.co']) bad(() => parse(loginSchema, { email: e, password: 'x' }));
    const co = (phone: string) => ({ planId: 'pro_monthly', customer: { firstname: 'A', email: 'a@b.co', phone } });
    assert.ok(parse(checkoutSchema, co('9876543210')));
    for (const p of ['123', 'abcdefghij', '98765 43210', '+', "9876543210'--"]) bad(() => parse(checkoutSchema, co(p)));
  });
  it('checkout schema refuses client-supplied amount/currency/userId', () => {
    const base = { planId: 'pro_monthly', customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' } };
    bad(() => parse(checkoutSchema, { ...base, amount: '1.00' }));
    bad(() => parse(checkoutSchema, { ...base, currency: 'USD' }));
    bad(() => parse(checkoutSchema, { ...base, userId: 'someone-else' }));
    bad(() => parse(checkoutSchema, { ...base, customer: { ...base.customer, userId: 'x' } }));
    bad(() => parse(checkoutSchema, { ...base, planId: "x' OR '1'='1" }));
    bad(() => parse(checkoutSchema, { ...base, planId: '../etc/passwd' }));
  });
  it('pagination is bounded and numeric', () => {
    assert.deepEqual(parse(paginationSchema, {}), { page: 1, pageSize: 20 });
    assert.equal(parse(paginationSchema, { page: '3', pageSize: '100' }).pageSize, 100);
    for (const q of [{ page: '0' }, { page: '-1' }, { pageSize: '101' }, { pageSize: '0' }, { page: '1.5' }, { page: 'abc' }, { page: '1; DROP TABLE x' }, { page: '999999999' }, { extra: '1' }]) bad(() => parse(paginationSchema, q));
  });
  it('order ids must be UUIDs', () => {
    assert.ok(orderIdSchema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success);
    for (const v of ['1', 'abc', "1' OR '1'='1", '../../x', '3f2504e0-4f89-41d3-9a0c-0305e82c33011']) assert.equal(orderIdSchema.safeParse(v).success, false);
  });
  it('callback schema requires the signed fields and bounds sizes', () => {
    const ok = { key: 'k', txnid: 't', amount: '1.00', productinfo: 'p', firstname: 'f', email: 'e', status: 'success', hash: 'a'.repeat(128) };
    assert.ok(callbackSchema.safeParse(ok).success);
    for (const k of Object.keys(ok)) { const c: Record<string, string> = { ...ok }; delete c[k]; assert.equal(callbackSchema.safeParse(c).success, false, `missing ${k}`); }
    assert.equal(callbackSchema.safeParse({ ...ok, txnid: 'x'.repeat(41) }).success, false);
    assert.equal(callbackSchema.safeParse({ ...ok, productinfo: 'x'.repeat(501) }).success, false);
  });
  it('validation errors never echo submitted values', () => {
    try { parse(registerSchema, { name: '<script>SECRETPAYLOAD</script>', email: 'a@b.co', password: 'x' }); assert.fail('should throw'); }
    catch (e) { assert.ok(!JSON.stringify((e as AppError).fieldErrors).includes('SECRETPAYLOAD')); }
  });
});
