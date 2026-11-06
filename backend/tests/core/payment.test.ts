import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { PaymentService } from '../../src/services/paymentService';
import { responseHash, requestHash, apiHash } from '../../src/integrations/payu/hash';
import { PayuGateway, VerifiedTxn } from '../../src/integrations/payu/client';
import { canTransition, TRANSITIONS } from '../../src/services/paymentStateMachine';
import { MemoryRepo } from './memoryRepo';

const cfg = { key: 'TESTKEY', salt: 'TESTSALT', baseUrl: 'https://test.payu.in/_payment', verifyUrl: 'https://test.payu.in/merchant/postservice?form=2' };
const sha = (s: string) => createHash('sha512').update(s).digest('hex');
const PLAN = '11111111-1111-4111-8111-111111111111', USER = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';

class FakeGateway implements PayuGateway {
  next: VerifiedTxn | Error = { found: true, status: 'success', mihpayid: 'M1', amount: '499.00' };
  calls = 0;
  async verifyTransaction() { this.calls++; if (this.next instanceof Error) throw this.next; return this.next; }
}

let repo: MemoryRepo, gw: FakeGateway, svc: PaymentService;
beforeEach(() => {
  repo = new MemoryRepo(); gw = new FakeGateway();
  repo.plans.set(PLAN, { id: PLAN, code: 'basic', name: 'Basic', priceInPaise: 49900, currency: 'INR', durationDays: 30, isActive: true });
  repo.users.set(USER, { id: USER, email: 'a@b.co', name: 'Asha', phone: '9999999999' });
  svc = new PaymentService(repo, gw, cfg, { backendUrl: 'https://api.example.com' });
});

/** Builds a PayU-style callback signed the way PayU documents (reverse hash). */
function callback(txnid: string, orderId: string, over: Record<string, string> = {}) {
  const b: Record<string, string> = { key: cfg.key, txnid, amount: '499.00', productinfo: 'Basic', firstname: 'Asha', email: 'a@b.co',
    status: 'success', mihpayid: 'M1', udf1: orderId, ...over };
  b.hash = over.hash ?? sha(['TESTSALT', b.status, '', '', '', '', '', b.udf5 ?? '', b.udf4 ?? '', b.udf3 ?? '', b.udf2 ?? '', b.udf1 ?? '', b.email, b.firstname, b.productinfo, b.amount, b.txnid, b.key].join('|'));
  return b;
}
async function start(key = 'idem-key-0123456789') { const r = await svc.initiate(USER, PLAN, key); const p = (await repo.findByOrderId(r.orderId))!; return { r, p }; }

describe('hashing (formulas from docs.payu.in)', () => {
  test('request hash: key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT', () => {
    // key,txnid,amount,productinfo,firstname,email,udf1=U1,udf2..udf5 empty, 5 reserved empties, salt = 17 fields
    const manual = ['K', 'T1', '10.00', 'Prod', 'Ann', 'a@b.co', 'U1', '', '', '', '', '', '', '', '', '', 'S'].join('|');
    assert.equal(manual.split('|').length, 17);
    assert.equal(requestHash({ key: 'K', txnid: 'T1', amount: '10.00', productinfo: 'Prod', firstname: 'Ann', email: 'a@b.co', udf1: 'U1' }, 'S'), sha(manual));
  });
  test('response hash: SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key', () => {
    const r = { status: 'success', udf1: 'U1', email: 'e', firstname: 'f', productinfo: 'p', amount: '1.00', txnid: 't', key: 'k' };
    // docs: SALT|status|<5 empties>|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
    const manual = ['S', 'success', '', '', '', '', '', '', '', '', '', 'U1', 'e', 'f', 'p', '1.00', 't', 'k'].join('|');
    assert.equal(manual.split('|').length, 18);
    assert.equal(responseHash(r, 'S'), sha(manual));
  });
  test('additionalCharges is prepended when PayU posts it', () => {
    const r = { status: 'success', udf1: '', email: 'e', firstname: 'f', productinfo: 'p', amount: '1.00', txnid: 't', key: 'k' };
    const base = ['S', 'success', '', '', '', '', '', '', '', '', '', '', 'e', 'f', 'p', '1.00', 't', 'k'].join('|');
    assert.equal(responseHash(r, 'S'), sha(base));
    assert.equal(responseHash({ ...r, additionalCharges: '2.00' }, 'S'), sha('2.00|' + base));
  });
  test('api hash reproduces the verify_payment example published by PayU', () => {
    assert.equal(apiHash('0MQaQP', 'verify_payment', '123455666677', '13p0PXZk'),
      'e43ede14c88c70e27f47001b4207aefda114e665fe054e1eeeaa7d2c1cda41449d04dae1b63074b13d48098d404dae4b31216214a557d39265d55a45249dba2e');
  });
});

describe('state machine', () => {
  test('terminal states have no exits', () => { for (const s of ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'] as const) assert.deepEqual(TRANSITIONS[s], []); });
  test('no way back to CREATED', () => { for (const k of Object.keys(TRANSITIONS)) assert.ok(!canTransition(k as any, 'CREATED')); });
});

describe('initiation', () => {
  test('valid initiation: DB price, signed form, no salt in response, PENDING record', async () => {
    const { r, p } = await start();
    assert.equal(r.status, 'PENDING'); assert.equal(p.amountInPaise, 49900);
    const f = r.payment!.fields;
    assert.equal(f.amount, '499.00'); assert.equal(f.udf1, r.orderId);
    assert.equal(f.hash, requestHash({ ...f } as any, cfg.salt));
    assert.ok(!JSON.stringify(r).includes('TESTSALT'));
  });
  test('invalid plan rejected', async () => {
    await assert.rejects(svc.initiate(USER, '99999999-9999-4999-8999-999999999999', 'idem-key-0123456789'), { code: 'INVALID_PLAN' });
  });
  test('inactive plan rejected', async () => {
    repo.plans.get(PLAN)!.isActive = false;
    await assert.rejects(svc.initiate(USER, PLAN, 'idem-key-0123456789'), { code: 'INVALID_PLAN' });
  });
  test('unknown user rejected', async () => {
    await assert.rejects(svc.initiate(OTHER, PLAN, 'idem-key-0123456789'), { status: 401 });
  });
  test('duplicate initiation with same key returns the same order, one payment row', async () => {
    const a = await svc.initiate(USER, PLAN, 'idem-key-0123456789'); const b = await svc.initiate(USER, PLAN, 'idem-key-0123456789');
    assert.equal(a.orderId, b.orderId); assert.equal(b.replayed, true); assert.equal(repo.payments.size, 1);
  });
  test('same key, different request -> conflict', async () => {
    await svc.initiate(USER, PLAN, 'idem-key-0123456789');
    repo.plans.set(OTHER, { ...repo.plans.get(PLAN)!, id: OTHER, code: 'x' });
    await assert.rejects(svc.initiate(USER, OTHER, 'idem-key-0123456789'), { code: 'IDEMPOTENCY_MISMATCH' });
  });
});

describe('callback processing', () => {
  test('valid success -> verified with PayU -> SUCCESS and exactly one subscription', async () => {
    const { r, p } = await start();
    const res = await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
    assert.equal(res.outcome, 'processed'); assert.equal(res.status, 'SUCCESS');
    assert.equal(gw.calls, 1); assert.equal(repo.subs.length, 1); assert.equal(repo.subs[0].paymentId, p.id);
  });
  test('duplicate callback does not activate twice and does not re-verify', async () => {
    const { r, p } = await start(); const cb = callback(p.txnid, r.orderId);
    await svc.processCallback(cb, 'browser'); const again = await svc.processCallback(cb, 'webhook');
    assert.equal(again.outcome, 'duplicate'); assert.equal(repo.subs.length, 1); assert.equal(gw.calls, 1);
  });
  test('webhook after browser callback with different payload still yields one subscription', async () => {
    const { r, p } = await start();
    await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
    const second = await svc.processCallback(callback(p.txnid, r.orderId, { mode: 'UPI' }), 'webhook');
    assert.equal(second.outcome, 'duplicate'); assert.equal(repo.subs.length, 1);
  });
  test('invalid hash rejected, nothing changes', async () => {
    const { r, p } = await start();
    const res = await svc.processCallback(callback(p.txnid, r.orderId, { hash: 'deadbeef' }), 'browser');
    assert.equal(res.reason, 'INVALID_HASH'); assert.equal((await repo.findByTxnid(p.txnid))!.status, 'PENDING'); assert.equal(repo.subs.length, 0);
  });
  test('tampered amount (validly signed for another amount) rejected', async () => {
    const { r, p } = await start();
    const res = await svc.processCallback(callback(p.txnid, r.orderId, { amount: '1.00' }), 'browser');
    assert.equal(res.reason, 'AMOUNT_MISMATCH'); assert.equal(repo.subs.length, 0); assert.equal(gw.calls, 0);
  });
  test('wrong merchant key rejected', async () => {
    const { r, p } = await start();
    assert.equal((await svc.processCallback(callback(p.txnid, r.orderId, { key: 'OTHER' }), 'browser')).reason, 'MERCHANT_MISMATCH');
  });
  test('invalid transaction reference rejected', async () => {
    const res = await svc.processCallback(callback('BCDOESNOTEXIST', 'ORD-X-00000000'), 'webhook');
    assert.equal(res.reason, 'UNKNOWN_TXN');
  });
  test('order reference mismatch rejected', async () => {
    const { p } = await start();
    assert.equal((await svc.processCallback(callback(p.txnid, 'ORD-WRONG-00000000'), 'browser')).reason, 'ORDER_MISMATCH');
  });
  test('failed transaction -> FAILED, never a subscription', async () => {
    const { r, p } = await start();
    const res = await svc.processCallback(callback(p.txnid, r.orderId, { status: 'failure', error_Message: 'Bank declined' }), 'browser');
    assert.equal(res.status, 'FAILED'); assert.equal(repo.subs.length, 0); assert.equal(gw.calls, 0);
  });
  test('cancelled transaction -> CANCELLED', async () => {
    const { r, p } = await start();
    const res = await svc.processCallback(callback(p.txnid, r.orderId, { status: 'failure', unmappedstatus: 'userCancelled' }), 'browser');
    assert.equal(res.status, 'CANCELLED'); assert.equal(repo.subs.length, 0);
  });
  test('callback says success but PayU verify says failure -> FAILED, no subscription', async () => {
    gw.next = { found: true, status: 'failure' };
    const { r, p } = await start();
    const res = await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
    assert.equal(res.status, 'FAILED'); assert.equal(repo.subs.length, 0);
  });
  test('verify amount differs from our record -> FAILED, no subscription', async () => {
    gw.next = { found: true, status: 'success', mihpayid: 'M', amount: '1.00' };
    const { r, p } = await start();
    const res = await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
    assert.equal(res.outcome, 'rejected'); assert.equal(repo.subs.length, 0);
  });
  test('verification unavailable -> VERIFICATION_PENDING, no subscription', async () => {
    gw.next = new Error('timeout');
    const { r, p } = await start();
    const res = await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
    assert.equal(res.status, 'VERIFICATION_PENDING'); assert.equal(repo.subs.length, 0);
  });
  test('VERIFICATION_PENDING is later settled by status reconciliation', async () => {
    gw.next = new Error('timeout');
    const { r, p } = await start(); await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
    gw.next = { found: true, status: 'success', mihpayid: 'M1', amount: '499.00' };
    const s = await svc.status(USER, r.orderId);
    assert.equal(s.status, 'SUCCESS'); assert.equal(repo.subs.length, 1);
  });
  test('conflicting success after FAILED is flagged and does not overwrite or activate', async () => {
    const { r, p } = await start();
    await svc.processCallback(callback(p.txnid, r.orderId, { status: 'failure' }), 'browser');
    const res = await svc.processCallback(callback(p.txnid, r.orderId, { status: 'success', mode: 'X' }), 'webhook');
    assert.equal(res.outcome, 'conflict'); assert.equal((await repo.findByTxnid(p.txnid))!.status, 'FAILED'); assert.equal(repo.subs.length, 0);
    assert.ok(repo.events.some((e) => e.eventType === 'CONFLICT'));
  });
  test('concurrent success callbacks activate once', async () => {
    const { r, p } = await start();
    await Promise.all([1, 2, 3].map((i) => svc.processCallback(callback(p.txnid, r.orderId, { mode: 'M' + i }), 'webhook')));
    assert.equal(repo.subs.length, 1);
  });
  test('unexpected callback body (missing fields) rejected', async () => {
    assert.equal((await svc.processCallback({}, 'webhook')).reason, 'MISSING_FIELDS');
  });
  test('status endpoint hides other users\' orders', async () => {
    const { r } = await start();
    await assert.rejects(svc.status(OTHER, r.orderId), { status: 404 });
  });
});
