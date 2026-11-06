import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, startPayment, postCallback, subsOf, orderOf, type TestApp } from '../helpers/harness.ts';
import { assertInvariants } from '../helpers/invariants.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

describe('P-10 delayed / interrupted payments', () => {
  it('customer pays, closes the browser, callback never arrives: reconcile job settles it', async () => {
    const c = await signedInClient(t, 'del1'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    assert.equal(orderOf(t, s.orderId).status, 'pending');
    await t.app.payments.reconcilePending(); // orders younger than the minimum age are left alone
    assert.equal(orderOf(t, s.orderId).status, 'pending');
    t.clock.advanceMinutes(3);
    const r = await t.app.payments.reconcilePending(); assert.ok(r.checked >= 1);
    assert.equal(orderOf(t, s.orderId).status, 'success'); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
    assert.equal(t.app.db.eventsFor(s.txnid)[0]!.source, 'reconcile'); assertInvariants(t);
  });
  it('the late callback that arrives AFTER reconciliation is a harmless duplicate', async () => {
    const c = await signedInClient(t, 'del2'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); t.clock.advanceMinutes(3);
    await t.app.payments.reconcilePending(); assert.equal((await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'))).status, 303);
    assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
  });
  it('browser returns before verification finishes: result API says pending, then success after the callback', async () => {
    const c = await signedInClient(t, 'del3'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    t.gateway.verifyDelayMs = 150;
    const cbP = postCallback(t, t.gateway.callbackFor(s.txnid, 'success'));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await c.get(`/api/payments/${s.orderId}`)).json.order.status, 'pending', 'mid-verification the UI must show pending, not success');
    assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 0);
    await cbP; t.gateway.verifyDelayMs = 0;
    assert.equal((await c.get(`/api/payments/${s.orderId}`)).json.order.status, 'success');
  });
  it('refresh endpoint settles a paid-but-uncallbacked order', async () => {
    const c = await signedInClient(t, 'del4'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    const r = await c.post(`/api/payments/${s.orderId}/refresh`); assert.equal(r.status, 200); assert.equal(r.json.order.status, 'success'); assert.equal(r.json.gatewayReachable, true);
  });
  it('refresh on a still-pending payment keeps it pending', async () => {
    const c = await signedInClient(t, 'del5'); const s = await startPayment(t, c);
    const r = await c.post(`/api/payments/${s.orderId}/refresh`); assert.equal(r.json.order.status, 'pending'); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 0);
  });
  it('refresh during a gateway outage is a graceful 200 with gatewayReachable=false (no 5xx, no activation)', async () => {
    const c = await signedInClient(t, 'del6'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); t.gateway.verifyBehaviour = 'throw';
    try { const r = await c.post(`/api/payments/${s.orderId}/refresh`); assert.equal(r.status, 200); assert.equal(r.json.gatewayReachable, false); assert.equal(r.json.order.status, 'pending'); } finally { t.gateway.verifyBehaviour = 'ok'; }
  });
  it('refresh learns about failures and cancellations too', async () => {
    const c = await signedInClient(t, 'del7'); const a = await startPayment(t, c, 'starter_monthly'); t.gateway.settle(a.txnid, 'failure');
    assert.equal((await c.post(`/api/payments/${a.orderId}/refresh`)).json.order.status, 'failed');
    const b = await startPayment(t, c, 'pro_monthly'); t.gateway.settle(b.txnid, 'cancel'); assert.equal((await c.post(`/api/payments/${b.orderId}/refresh`)).json.order.status, 'cancelled');
  });
  it('abandoned checkout is expired after 30 minutes; a new checkout then creates a fresh order', async () => {
    const c = await signedInClient(t, 'del8'); const s = await startPayment(t, c); t.clock.advanceMinutes(31);
    await t.app.payments.reconcilePending(); assert.equal(orderOf(t, s.orderId).status, 'expired');
    await c.relogin(); // 31 idle minutes also expired the session (correctly)
    const again = await startPayment(t, c); assert.notEqual(again.orderId, s.orderId);
  });
  it('an open order older than the 30-minute window is not reused by checkout', async () => {
    const c = await signedInClient(t, 'del9'); const s = await startPayment(t, c); t.clock.advanceMinutes(31);
    await c.relogin(); const r = await c.checkout('starter_monthly');
    assert.equal(r.status, 201, 'must be a NEW order, not a reuse (200)'); assert.notEqual(r.json.orderId, s.orderId);
  });
  it('late verified success after expiry still grants the paid subscription', async () => {
    const c = await signedInClient(t, 'del10'); const s = await startPayment(t, c); t.clock.advanceMinutes(31); await t.app.payments.reconcilePending(); assert.equal(orderOf(t, s.orderId).status, 'expired');
    t.gateway.settle(s.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'));
    assert.equal(orderOf(t, s.orderId).status, 'success'); assertInvariants(t);
  });
  it('reconcile is idempotent: running it repeatedly changes nothing further', async () => {
    const c = await signedInClient(t, 'del11'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); t.clock.advanceMinutes(3);
    for (let i = 0; i < 4; i++) await t.app.payments.reconcilePending();
    assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
  });
  it('DEF-003 regression: failure callback, customer retries inside PayU and pays, success callback is lost → reconcile rescues it', async () => {
    const c = await signedInClient(t, 'del12'); const s = await startPayment(t, c);
    t.gateway.settle(s.txnid, 'failure'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'failure')); assert.equal(orderOf(t, s.orderId).status, 'failed');
    t.gateway.settle(s.txnid, 'success'); // retried and paid; no callback ever arrives
    await t.app.payments.reconcilePending(); assert.equal(orderOf(t, s.orderId).status, 'success'); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
    assert.ok(t.app.db.eventsFor(s.txnid).some((e) => e.outcome === 'late_success')); assertInvariants(t);
  });
  it('DEF-003: the user-triggered refresh also rescues a closed-but-paid order, and leaves a genuinely failed one alone', async () => {
    const c = await signedInClient(t, 'del13'); const a = await startPayment(t, c, 'starter_monthly'); t.gateway.settle(a.txnid, 'failure'); await postCallback(t, t.gateway.callbackFor(a.txnid, 'failure'));
    assert.equal((await c.post(`/api/payments/${a.orderId}/refresh`)).json.order.status, 'failed');
    t.gateway.settle(a.txnid, 'success'); assert.equal((await c.post(`/api/payments/${a.orderId}/refresh`)).json.order.status, 'success');
  });
  it('closed orders older than the 24h look-back are not re-polled (bounds gateway load)', async () => {
    const c = await signedInClient(t, 'del14'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'failure'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'failure'));
    t.clock.advanceDays(2); const n = t.gateway.verifyCalls; await t.app.payments.reconcilePending(); assert.equal(t.gateway.verifyCalls, n, 'nothing to poll for this order');
  });
});
