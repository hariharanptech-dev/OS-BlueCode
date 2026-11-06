import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { requestHash } from '../../src/security/index.ts';
import { startApp, signedInClient, startPayment, completePayment, postCallback, subsOf, orderOf, Client, type TestApp } from '../helpers/harness.ts';
import { assertInvariants } from '../helpers/invariants.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

describe('P-01 successful payment (end-to-end at API level, mocked PayU)', () => {
  it('walks every step and activates exactly one subscription only after verified success', async () => {
    const c = await signedInClient(t, 'p01');

    // 1-3: customer selects plan → order created → PayU request generated
    const s = await startPayment(t, c, 'pro_monthly');
    assert.equal(s.res.status, 201);
    const f = s.checkout.payu.fields;
    assert.equal(f['amount'], '1499.00', 'amount comes from the server plan table');
    assert.equal(f['key'], t.config.payuKey);
    assert.equal(f['hash'], requestHash({ key: f['key']!, txnid: f['txnid']!, amount: f['amount']!, productinfo: f['productinfo']!, firstname: f['firstname']!, email: f['email']!, udf1: f['udf1']! }, t.config.payuSalt), 'request hash verifies with the merchant salt');
    assert.equal(s.checkout.payu.method, 'POST');
    assert.equal(orderOf(t, s.orderId).status, 'pending');
    assert.equal(subsOf(t).length, 0, 'no entitlement before payment');

    // before the callback: dashboard still shows no subscription
    assert.equal((await c.get('/api/subscription')).json.current, null);

    // 4: customer completes payment at PayU
    t.gateway.settle(s.txnid, 'success');
    assert.equal(orderOf(t, s.orderId).status, 'pending', 'settling at the gateway alone changes nothing locally');

    // 5-7: PayU → our callback; backend verifies server-to-server then activates
    const before = t.gateway.verifyCalls;
    const cb = await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'));
    assert.equal(cb.status, 303);
    assert.equal(cb.location, `/payment/result?order=${s.orderId}`);
    assert.equal(t.gateway.verifyCalls, before + 1, 'server-to-server verification was performed');
    const o = orderOf(t, s.orderId);
    assert.equal(o.status, 'success'); assert.ok(o.mihpayid); assert.ok(o.completedAt);

    // 8: dashboard
    const sub = (await c.get('/api/subscription')).json;
    assert.equal(sub.current.planId, 'pro_monthly'); assert.equal(sub.current.userId, c.userId); assert.equal(sub.current.status, 'active');
    assert.equal(sub.history.length, 1);
    assert.equal((await c.get(`/api/payments/${s.orderId}`)).json.order.status, 'success');
    assertInvariants(t);
  });

  it('records an audit event for the applied callback without storing hash or salt', async () => {
    const c = await signedInClient(t, 'p01b');
    const r = await completePayment(t, c, 'success');
    const ev = t.app.db.eventsFor(r.txnid);
    assert.equal(ev.length, 1); assert.equal(ev[0]!.outcome, 'applied'); assert.equal(ev[0]!.source, 'redirect');
    assert.ok(!JSON.stringify(ev).includes(t.config.payuSalt)); assert.ok(!('hash' in ev[0]!));
  });

  it('accepts the server-to-server webhook path and JSON bodies identically', async () => {
    const c = await signedInClient(t, 'p01c');
    const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    const r = await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'), { path: '/api/payments/payu/webhook', json: true });
    assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true, result: 'applied' });
    assert.equal(orderOf(t, s.orderId).status, 'success');
  });

  it('callback endpoint needs no session and never sets cookies', async () => {
    const c = await signedInClient(t, 'p01d');
    const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    const r = await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'));
    assert.equal(r.status, 303); assert.equal(r.headers.get('set-cookie'), null);
  });

  it('accepts uppercase / padded hex hash from the gateway (case-insensitive comparison)', async () => {
    const c = await signedInClient(t, 'p01e');
    const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    const p = t.gateway.callbackFor(s.txnid, 'success'); p['hash'] = p['hash']!.toUpperCase();
    assert.equal((await postCallback(t, p)).status, 303); assert.equal(orderOf(t, s.orderId).status, 'success');
  });

  it('tolerates extra, unsigned PayU fields without trusting them', async () => {
    const c = await signedInClient(t, 'p01f');
    const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    const p = { ...t.gateway.callbackFor(s.txnid, 'success'), bankcode: 'CC', PG_TYPE: 'CC-PG', unmappedstatus: 'captured', userId: 'someone-else', role: 'admin' };
    assert.equal((await postCallback(t, p)).status, 303);
    assert.equal(subsOf(t).find((x) => x.paymentId === s.orderId)!.userId, c.userId, 'user comes from our order, not the callback');
  });
});

describe('P-02 failed payment', () => {
  it('records failure, never activates, and allows a fresh attempt', async () => {
    const c = await signedInClient(t, 'p02');
    const r = await completePayment(t, c, 'failure');
    assert.equal(r.cb.status, 303);
    assert.equal(orderOf(t, r.orderId).status, 'failed');
    assert.equal(subsOf(t).filter((s) => s.userId === c.userId).length, 0);
    assert.equal((await c.get(`/api/payments/${r.orderId}`)).json.order.status, 'failed');
    assert.equal((await c.get('/api/subscription')).json.current, null);
    const retry = await startPayment(t, c); assert.notEqual(retry.orderId, r.orderId, 'a failed order is not reused');
    assertInvariants(t);
  });
});

describe('P-03 cancelled payment', () => {
  it('is recorded as cancelled and is never treated as success', async () => {
    const c = await signedInClient(t, 'p03');
    const calls = t.gateway.verifyCalls;
    const r = await completePayment(t, c, 'cancel');
    assert.equal(r.cb.status, 303);
    assert.equal(t.gateway.verifyCalls, calls, 'cancellation needs no money verification');
    const o = orderOf(t, r.orderId); assert.equal(o.status, 'cancelled'); assert.ok(o.completedAt);
    assert.equal(subsOf(t).filter((s) => s.userId === c.userId).length, 0);
    assertInvariants(t);
  });
  it('a "pending" callback leaves the order pending', async () => {
    const c = await signedInClient(t, 'p03b');
    const s = await startPayment(t, c);
    const r = await postCallback(t, t.gateway.callbackFor(s.txnid, 'success', { statusOverride: 'pending' }));
    assert.equal(r.status, 303); assert.equal(orderOf(t, s.orderId).status, 'pending'); assert.equal(t.app.db.eventsFor(s.txnid)[0]!.outcome, 'pending');
  });
});

describe('P-04 checkout contract', () => {
  it('requires authentication', async () => {
    const anon = new Client(t.url);
    const r = await anon.post('/api/payments/checkout', { json: { planId: 'pro_monthly', customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' } } });
    assert.equal(r.status, 401); assert.equal(r.json.error.code, 'AUTH_REQUIRED');
  });
  it('price is server-owned for every plan, regardless of client input', async () => {
    const c = await signedInClient(t, 'p04');
    for (const [plan, price] of [['starter_monthly', '499.00'], ['pro_monthly', '1499.00'], ['pro_yearly', '14990.00']] as const) {
      const cc = await signedInClient(t, 'p04x');
      const r = await cc.checkout(plan); assert.equal(r.json.amount, price); assert.equal(r.json.payu.fields.amount, price);
    }
    void c;
  });
  it('rejects client-supplied amount, currency, userId, status (strict schema)', async () => {
    const c = await signedInClient(t, 'p04b');
    for (const extra of [{ amount: '1.00' }, { currency: 'USD' }, { userId: 'x' }, { status: 'success' }, { amount: 1 }]) {
      const r = await c.checkout('pro_monthly', { extra }); assert.equal(r.status, 400, JSON.stringify(extra)); assert.equal(r.json.error.code, 'VALIDATION_FAILED');
    }
    assert.equal(t.app.db.allOrders().filter((o) => o.userId === c.userId).length, 0, 'nothing created by rejected requests');
  });
  it('rejects unknown plans with a user-safe message', async () => {
    const c = await signedInClient(t, 'p04c');
    const r = await c.checkout('enterprise_forever'); assert.equal(r.status, 400); assert.equal(r.json.error.code, 'PLAN_INVALID');
    assert.equal((await c.checkout("x'; DROP TABLE orders;--")).status, 400);
  });
  it('never exposes the merchant salt in the checkout response or response headers', async () => {
    const c = await signedInClient(t, 'p04d');
    const r = await c.checkout('pro_monthly');
    assert.ok(!r.text.includes(t.config.payuSalt)); assert.ok(![...r.headers.values()].join('\n').includes(t.config.payuSalt));
  });
  it('rejects malformed Idempotency-Key values', async () => {
    const c = await signedInClient(t, 'p04e');
    for (const k of ['short', 'has space here!!', 'x'.repeat(65), '../../etc']) assert.equal((await c.checkout('pro_monthly', { idem: k })).status, 400, k);
  });
});
