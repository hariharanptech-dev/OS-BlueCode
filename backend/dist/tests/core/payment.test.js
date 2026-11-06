"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const crypto_1 = require("crypto");
const paymentService_1 = require("../../src/services/paymentService");
const hash_1 = require("../../src/integrations/payu/hash");
const paymentStateMachine_1 = require("../../src/services/paymentStateMachine");
const memoryRepo_1 = require("./memoryRepo");
const cfg = { key: 'TESTKEY', salt: 'TESTSALT', baseUrl: 'https://test.payu.in/_payment', verifyUrl: 'https://test.payu.in/merchant/postservice?form=2' };
const sha = (s) => (0, crypto_1.createHash)('sha512').update(s).digest('hex');
const PLAN = '11111111-1111-4111-8111-111111111111', USER = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
class FakeGateway {
    next = { found: true, status: 'success', mihpayid: 'M1', amount: '499.00' };
    calls = 0;
    async verifyTransaction() { this.calls++; if (this.next instanceof Error)
        throw this.next; return this.next; }
}
let repo, gw, svc;
(0, node_test_1.beforeEach)(() => {
    repo = new memoryRepo_1.MemoryRepo();
    gw = new FakeGateway();
    repo.plans.set(PLAN, { id: PLAN, code: 'basic', name: 'Basic', priceInPaise: 49900, currency: 'INR', durationDays: 30, isActive: true });
    repo.users.set(USER, { id: USER, email: 'a@b.co', name: 'Asha', phone: '9999999999' });
    svc = new paymentService_1.PaymentService(repo, gw, cfg, { backendUrl: 'https://api.example.com' });
});
/** Builds a PayU-style callback signed the way PayU documents (reverse hash). */
function callback(txnid, orderId, over = {}) {
    const b = { key: cfg.key, txnid, amount: '499.00', productinfo: 'Basic', firstname: 'Asha', email: 'a@b.co',
        status: 'success', mihpayid: 'M1', udf1: orderId, ...over };
    b.hash = over.hash ?? sha(['TESTSALT', b.status, '', '', '', '', '', b.udf5 ?? '', b.udf4 ?? '', b.udf3 ?? '', b.udf2 ?? '', b.udf1 ?? '', b.email, b.firstname, b.productinfo, b.amount, b.txnid, b.key].join('|'));
    return b;
}
async function start(key = 'idem-key-0123456789') { const r = await svc.initiate(USER, PLAN, key); const p = (await repo.findByOrderId(r.orderId)); return { r, p }; }
(0, node_test_1.describe)('hashing (formulas from docs.payu.in)', () => {
    (0, node_test_1.test)('request hash: key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT', () => {
        // key,txnid,amount,productinfo,firstname,email,udf1=U1,udf2..udf5 empty, 5 reserved empties, salt = 17 fields
        const manual = ['K', 'T1', '10.00', 'Prod', 'Ann', 'a@b.co', 'U1', '', '', '', '', '', '', '', '', '', 'S'].join('|');
        strict_1.default.equal(manual.split('|').length, 17);
        strict_1.default.equal((0, hash_1.requestHash)({ key: 'K', txnid: 'T1', amount: '10.00', productinfo: 'Prod', firstname: 'Ann', email: 'a@b.co', udf1: 'U1' }, 'S'), sha(manual));
    });
    (0, node_test_1.test)('response hash: SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key', () => {
        const r = { status: 'success', udf1: 'U1', email: 'e', firstname: 'f', productinfo: 'p', amount: '1.00', txnid: 't', key: 'k' };
        // docs: SALT|status|<5 empties>|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
        const manual = ['S', 'success', '', '', '', '', '', '', '', '', '', 'U1', 'e', 'f', 'p', '1.00', 't', 'k'].join('|');
        strict_1.default.equal(manual.split('|').length, 18);
        strict_1.default.equal((0, hash_1.responseHash)(r, 'S'), sha(manual));
    });
    (0, node_test_1.test)('additionalCharges is prepended when PayU posts it', () => {
        const r = { status: 'success', udf1: '', email: 'e', firstname: 'f', productinfo: 'p', amount: '1.00', txnid: 't', key: 'k' };
        const base = ['S', 'success', '', '', '', '', '', '', '', '', '', '', 'e', 'f', 'p', '1.00', 't', 'k'].join('|');
        strict_1.default.equal((0, hash_1.responseHash)(r, 'S'), sha(base));
        strict_1.default.equal((0, hash_1.responseHash)({ ...r, additionalCharges: '2.00' }, 'S'), sha('2.00|' + base));
    });
    (0, node_test_1.test)('api hash reproduces the verify_payment example published by PayU', () => {
        strict_1.default.equal((0, hash_1.apiHash)('0MQaQP', 'verify_payment', '123455666677', '13p0PXZk'), 'e43ede14c88c70e27f47001b4207aefda114e665fe054e1eeeaa7d2c1cda41449d04dae1b63074b13d48098d404dae4b31216214a557d39265d55a45249dba2e');
    });
});
(0, node_test_1.describe)('state machine', () => {
    (0, node_test_1.test)('terminal states have no exits', () => { for (const s of ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'])
        strict_1.default.deepEqual(paymentStateMachine_1.TRANSITIONS[s], []); });
    (0, node_test_1.test)('no way back to CREATED', () => { for (const k of Object.keys(paymentStateMachine_1.TRANSITIONS))
        strict_1.default.ok(!(0, paymentStateMachine_1.canTransition)(k, 'CREATED')); });
});
(0, node_test_1.describe)('initiation', () => {
    (0, node_test_1.test)('valid initiation: DB price, signed form, no salt in response, PENDING record', async () => {
        const { r, p } = await start();
        strict_1.default.equal(r.status, 'PENDING');
        strict_1.default.equal(p.amountInPaise, 49900);
        const f = r.payment.fields;
        strict_1.default.equal(f.amount, '499.00');
        strict_1.default.equal(f.udf1, r.orderId);
        strict_1.default.equal(f.hash, (0, hash_1.requestHash)({ ...f }, cfg.salt));
        strict_1.default.ok(!JSON.stringify(r).includes('TESTSALT'));
    });
    (0, node_test_1.test)('invalid plan rejected', async () => {
        await strict_1.default.rejects(svc.initiate(USER, '99999999-9999-4999-8999-999999999999', 'idem-key-0123456789'), { code: 'INVALID_PLAN' });
    });
    (0, node_test_1.test)('inactive plan rejected', async () => {
        repo.plans.get(PLAN).isActive = false;
        await strict_1.default.rejects(svc.initiate(USER, PLAN, 'idem-key-0123456789'), { code: 'INVALID_PLAN' });
    });
    (0, node_test_1.test)('unknown user rejected', async () => {
        await strict_1.default.rejects(svc.initiate(OTHER, PLAN, 'idem-key-0123456789'), { status: 401 });
    });
    (0, node_test_1.test)('duplicate initiation with same key returns the same order, one payment row', async () => {
        const a = await svc.initiate(USER, PLAN, 'idem-key-0123456789');
        const b = await svc.initiate(USER, PLAN, 'idem-key-0123456789');
        strict_1.default.equal(a.orderId, b.orderId);
        strict_1.default.equal(b.replayed, true);
        strict_1.default.equal(repo.payments.size, 1);
    });
    (0, node_test_1.test)('same key, different request -> conflict', async () => {
        await svc.initiate(USER, PLAN, 'idem-key-0123456789');
        repo.plans.set(OTHER, { ...repo.plans.get(PLAN), id: OTHER, code: 'x' });
        await strict_1.default.rejects(svc.initiate(USER, OTHER, 'idem-key-0123456789'), { code: 'IDEMPOTENCY_MISMATCH' });
    });
});
(0, node_test_1.describe)('callback processing', () => {
    (0, node_test_1.test)('valid success -> verified with PayU -> SUCCESS and exactly one subscription', async () => {
        const { r, p } = await start();
        const res = await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
        strict_1.default.equal(res.outcome, 'processed');
        strict_1.default.equal(res.status, 'SUCCESS');
        strict_1.default.equal(gw.calls, 1);
        strict_1.default.equal(repo.subs.length, 1);
        strict_1.default.equal(repo.subs[0].paymentId, p.id);
    });
    (0, node_test_1.test)('duplicate callback does not activate twice and does not re-verify', async () => {
        const { r, p } = await start();
        const cb = callback(p.txnid, r.orderId);
        await svc.processCallback(cb, 'browser');
        const again = await svc.processCallback(cb, 'webhook');
        strict_1.default.equal(again.outcome, 'duplicate');
        strict_1.default.equal(repo.subs.length, 1);
        strict_1.default.equal(gw.calls, 1);
    });
    (0, node_test_1.test)('webhook after browser callback with different payload still yields one subscription', async () => {
        const { r, p } = await start();
        await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
        const second = await svc.processCallback(callback(p.txnid, r.orderId, { mode: 'UPI' }), 'webhook');
        strict_1.default.equal(second.outcome, 'duplicate');
        strict_1.default.equal(repo.subs.length, 1);
    });
    (0, node_test_1.test)('invalid hash rejected, nothing changes', async () => {
        const { r, p } = await start();
        const res = await svc.processCallback(callback(p.txnid, r.orderId, { hash: 'deadbeef' }), 'browser');
        strict_1.default.equal(res.reason, 'INVALID_HASH');
        strict_1.default.equal((await repo.findByTxnid(p.txnid)).status, 'PENDING');
        strict_1.default.equal(repo.subs.length, 0);
    });
    (0, node_test_1.test)('tampered amount (validly signed for another amount) rejected', async () => {
        const { r, p } = await start();
        const res = await svc.processCallback(callback(p.txnid, r.orderId, { amount: '1.00' }), 'browser');
        strict_1.default.equal(res.reason, 'AMOUNT_MISMATCH');
        strict_1.default.equal(repo.subs.length, 0);
        strict_1.default.equal(gw.calls, 0);
    });
    (0, node_test_1.test)('wrong merchant key rejected', async () => {
        const { r, p } = await start();
        strict_1.default.equal((await svc.processCallback(callback(p.txnid, r.orderId, { key: 'OTHER' }), 'browser')).reason, 'MERCHANT_MISMATCH');
    });
    (0, node_test_1.test)('invalid transaction reference rejected', async () => {
        const res = await svc.processCallback(callback('BCDOESNOTEXIST', 'ORD-X-00000000'), 'webhook');
        strict_1.default.equal(res.reason, 'UNKNOWN_TXN');
    });
    (0, node_test_1.test)('order reference mismatch rejected', async () => {
        const { p } = await start();
        strict_1.default.equal((await svc.processCallback(callback(p.txnid, 'ORD-WRONG-00000000'), 'browser')).reason, 'ORDER_MISMATCH');
    });
    (0, node_test_1.test)('failed transaction -> FAILED, never a subscription', async () => {
        const { r, p } = await start();
        const res = await svc.processCallback(callback(p.txnid, r.orderId, { status: 'failure', error_Message: 'Bank declined' }), 'browser');
        strict_1.default.equal(res.status, 'FAILED');
        strict_1.default.equal(repo.subs.length, 0);
        strict_1.default.equal(gw.calls, 0);
    });
    (0, node_test_1.test)('cancelled transaction -> CANCELLED', async () => {
        const { r, p } = await start();
        const res = await svc.processCallback(callback(p.txnid, r.orderId, { status: 'failure', unmappedstatus: 'userCancelled' }), 'browser');
        strict_1.default.equal(res.status, 'CANCELLED');
        strict_1.default.equal(repo.subs.length, 0);
    });
    (0, node_test_1.test)('callback says success but PayU verify says failure -> FAILED, no subscription', async () => {
        gw.next = { found: true, status: 'failure' };
        const { r, p } = await start();
        const res = await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
        strict_1.default.equal(res.status, 'FAILED');
        strict_1.default.equal(repo.subs.length, 0);
    });
    (0, node_test_1.test)('verify amount differs from our record -> FAILED, no subscription', async () => {
        gw.next = { found: true, status: 'success', mihpayid: 'M', amount: '1.00' };
        const { r, p } = await start();
        const res = await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
        strict_1.default.equal(res.outcome, 'rejected');
        strict_1.default.equal(repo.subs.length, 0);
    });
    (0, node_test_1.test)('verification unavailable -> VERIFICATION_PENDING, no subscription', async () => {
        gw.next = new Error('timeout');
        const { r, p } = await start();
        const res = await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
        strict_1.default.equal(res.status, 'VERIFICATION_PENDING');
        strict_1.default.equal(repo.subs.length, 0);
    });
    (0, node_test_1.test)('VERIFICATION_PENDING is later settled by status reconciliation', async () => {
        gw.next = new Error('timeout');
        const { r, p } = await start();
        await svc.processCallback(callback(p.txnid, r.orderId), 'browser');
        gw.next = { found: true, status: 'success', mihpayid: 'M1', amount: '499.00' };
        const s = await svc.status(USER, r.orderId);
        strict_1.default.equal(s.status, 'SUCCESS');
        strict_1.default.equal(repo.subs.length, 1);
    });
    (0, node_test_1.test)('conflicting success after FAILED is flagged and does not overwrite or activate', async () => {
        const { r, p } = await start();
        await svc.processCallback(callback(p.txnid, r.orderId, { status: 'failure' }), 'browser');
        const res = await svc.processCallback(callback(p.txnid, r.orderId, { status: 'success', mode: 'X' }), 'webhook');
        strict_1.default.equal(res.outcome, 'conflict');
        strict_1.default.equal((await repo.findByTxnid(p.txnid)).status, 'FAILED');
        strict_1.default.equal(repo.subs.length, 0);
        strict_1.default.ok(repo.events.some((e) => e.eventType === 'CONFLICT'));
    });
    (0, node_test_1.test)('concurrent success callbacks activate once', async () => {
        const { r, p } = await start();
        await Promise.all([1, 2, 3].map((i) => svc.processCallback(callback(p.txnid, r.orderId, { mode: 'M' + i }), 'webhook')));
        strict_1.default.equal(repo.subs.length, 1);
    });
    (0, node_test_1.test)('unexpected callback body (missing fields) rejected', async () => {
        strict_1.default.equal((await svc.processCallback({}, 'webhook')).reason, 'MISSING_FIELDS');
    });
    (0, node_test_1.test)('status endpoint hides other users\' orders', async () => {
        const { r } = await start();
        await strict_1.default.rejects(svc.status(OTHER, r.orderId), { status: 404 });
    });
});
