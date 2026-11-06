import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, startPayment, postCallback, subsOf, orderOf, type TestApp } from '../helpers/harness.ts';
import { assertInvariants } from '../helpers/invariants.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });
const ordersOf = (userId: string) => t.app.db.allOrders().filter((o) => o.userId === userId);

describe('P-08 duplicate payment INITIATION', () => {
  it('repeated sequential checkout for the same plan reuses the open order', async () => {
    const c = await signedInClient(t, 'dup1');
    const a = await c.checkout('pro_monthly'); const b = await c.checkout('pro_monthly'); const d = await c.checkout('pro_monthly');
    assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(d.status, 200);
    assert.equal(a.json.orderId, b.json.orderId); assert.equal(a.json.txnid, d.json.txnid); assert.equal(b.json.reused, true);
    assert.equal(ordersOf(c.userId!).length, 1);
  });
  it('10 truly concurrent checkout requests create exactly ONE order (double-click / retry storm)', async () => {
    const c = await signedInClient(t, 'dup2');
    const rs = await Promise.all(Array.from({ length: 10 }, () => c.checkout('starter_monthly')));
    assert.ok(rs.every((r) => r.status === 200 || r.status === 201));
    assert.equal(new Set(rs.map((r) => r.json.orderId)).size, 1); assert.equal(ordersOf(c.userId!).length, 1);
  });
  it('same Idempotency-Key replays the same OPEN order (browser refresh / retry cannot spawn a second charge)', async () => {
    const c = await signedInClient(t, 'dup3'); const key = 'key-' + Math.random().toString(36).slice(2, 12);
    const a = await c.checkout('pro_monthly', { idem: key }); const b = await c.checkout('pro_monthly', { idem: key });
    assert.equal(b.json.orderId, a.json.orderId); assert.equal(b.json.reused, true); assert.equal(ordersOf(c.userId!).length, 1);
  });
  it('DEF-004: a key whose order is already closed (failed or paid) is refused, never re-issuing a PayU form; a fresh key works', async () => {
    const c = await signedInClient(t, 'dup3b'); const key = 'key-' + Math.random().toString(36).slice(2, 12); const s = (await c.checkout('starter_monthly', { idem: key })).json;
    t.gateway.registerInitiation(s.payu.fields); t.gateway.settle(s.txnid, 'failure'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'failure'));
    const again = await c.checkout('starter_monthly', { idem: key }); assert.equal(again.status, 409); assert.equal(again.json.error.code, 'IDEMPOTENCY_KEY_USED'); assert.equal(again.json.payu, undefined);
    const fresh = await c.checkout('starter_monthly', { idem: key + '-2' }); assert.equal(fresh.status, 201); assert.notEqual(fresh.json.orderId, s.orderId);
    const k2 = 'key-' + Math.random().toString(36).slice(2, 12); const paid = (await c.checkout('pro_monthly', { idem: k2 })).json; t.gateway.registerInitiation(paid.payu.fields); t.gateway.settle(paid.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(paid.txnid, 'success'));
    assert.equal((await c.checkout('pro_monthly', { idem: k2 })).json.error.code, 'IDEMPOTENCY_KEY_USED');
  });
  it('Idempotency-Key reused with a different plan is rejected', async () => {
    const c = await signedInClient(t, 'dup4'); const key = 'key-' + Math.random().toString(36).slice(2, 12);
    await c.checkout('pro_monthly', { idem: key }); const r = await c.checkout('pro_yearly', { idem: key }); assert.equal(r.status, 400);
  });
  it('different users using the same Idempotency-Key do not collide', async () => {
    const a = await signedInClient(t, 'dup5a'); const b = await signedInClient(t, 'dup5b'); const key = 'shared-key-123456';
    const ra = await a.checkout('pro_monthly', { idem: key }); const rb = await b.checkout('pro_monthly', { idem: key });
    assert.notEqual(ra.json.orderId, rb.json.orderId);
  });
  it('a different plan while another is pending creates a separate order (user changed their mind)', async () => {
    const c = await signedInClient(t, 'dup6'); const a = await c.checkout('starter_monthly'); const b = await c.checkout('pro_monthly');
    assert.notEqual(a.json.orderId, b.json.orderId);
  });
  it('transaction ids are unique and unguessable-looking (≥ 80 bits of randomness, ≤ 25 chars for PayU)', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) { const c = await signedInClient(t, 'dup7'); ids.add((await c.checkout('starter_monthly')).json.txnid); }
    assert.equal(ids.size, 25); for (const id of ids) { assert.match(id, /^BC[0-9a-f]{20}$/); assert.ok(id.length <= 25); }
  });
});

describe('P-09 duplicate / replayed CALLBACKS never double-activate', () => {
  it('3 sequential identical callbacks → one subscription; second and third are recorded as duplicates', async () => {
    const c = await signedInClient(t, 'cb1'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    const payload = t.gateway.callbackFor(s.txnid, 'success'); const calls = t.gateway.verifyCalls;
    for (let i = 0; i < 3; i++) assert.equal((await postCallback(t, payload)).status, 303);
    assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
    assert.deepEqual(t.app.db.eventsFor(s.txnid).map((e) => e.outcome), ['applied', 'duplicate', 'duplicate']);
    assert.equal(t.gateway.verifyCalls, calls + 1, 'replays do not hammer the gateway'); assertInvariants(t);
  });
  it('25 CONCURRENT identical callbacks → exactly one subscription', async () => {
    const c = await signedInClient(t, 'cb2'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    const payload = t.gateway.callbackFor(s.txnid, 'success');
    const rs = await Promise.all(Array.from({ length: 25 }, () => postCallback(t, payload)));
    assert.ok(rs.every((r) => r.status === 303), rs.map((r) => r.status).join());
    assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
    const outcomes = t.app.db.eventsFor(s.txnid).map((e) => e.outcome); assert.equal(outcomes.filter((o) => o === 'applied').length, 1); assert.equal(outcomes.length, 25);
    assertInvariants(t);
  });
  it('concurrent redirect + webhook for the same payment (the real-world race) activate once', async () => {
    const c = await signedInClient(t, 'cb3'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); const p = t.gateway.callbackFor(s.txnid, 'success');
    await Promise.all([postCallback(t, p), postCallback(t, p, { path: '/api/payments/payu/webhook' }), postCallback(t, p, { json: true }), postCallback(t, p, { path: '/api/payments/payu/webhook', json: true })]);
    assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1); assertInvariants(t);
  });
  it('replaying an old success callback weeks later (after expiry) does not re-activate', async () => {
    const c = await signedInClient(t, 'cb4'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); const p = t.gateway.callbackFor(s.txnid, 'success');
    await postCallback(t, p); t.clock.advanceDays(90);
    assert.equal((await postCallback(t, p)).status, 303); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
    await c.relogin(); // 90 days later the session is long gone
    assert.equal((await c.get('/api/subscription')).json.current, null, 'expired period is not resurrected');
  });
  it('a captured success callback cannot be replayed to a different order', async () => {
    const a = await signedInClient(t, 'cb5a'); const b = await signedInClient(t, 'cb5b');
    const sa = await startPayment(t, a); const sb = await startPayment(t, b); t.gateway.settle(sa.txnid, 'success'); t.gateway.settle(sb.txnid, 'success');
    const pa = t.gateway.callbackFor(sa.txnid, 'success'); await postCallback(t, pa);
    const spoof = { ...pa, txnid: sb.txnid }; assert.equal((await postCallback(t, spoof)).status, 400);
    assert.equal(orderOf(t, sb.orderId).status, 'pending');
  });
  it('a stale FAILURE callback arriving after success is ignored (success is terminal)', async () => {
    const c = await signedInClient(t, 'cb6'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    const fail = t.gateway.callbackFor(s.txnid, 'failure'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'));
    assert.equal((await postCallback(t, fail)).status, 303); assert.equal(orderOf(t, s.orderId).status, 'success');
    assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
    assert.ok(t.app.db.eventsFor(s.txnid).some((e) => e.outcome === 'conflict_ignored'));
    const cancel = t.gateway.callbackFor(s.txnid, 'cancel'); await postCallback(t, cancel); assert.equal(orderOf(t, s.orderId).status, 'success');
  });
  it('failure followed by cancel does not flip a closed order', async () => {
    const c = await signedInClient(t, 'cb7'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'failure');
    await postCallback(t, t.gateway.callbackFor(s.txnid, 'failure')); await postCallback(t, t.gateway.callbackFor(s.txnid, 'cancel'));
    assert.equal(orderOf(t, s.orderId).status, 'failed');
  });
  it('failure then genuinely VERIFIED success (customer retried inside PayU) → rescued exactly once', async () => {
    const c = await signedInClient(t, 'cb8'); const s = await startPayment(t, c);
    t.gateway.settle(s.txnid, 'failure'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'failure')); assert.equal(orderOf(t, s.orderId).status, 'failed');
    t.gateway.settle(s.txnid, 'success'); const ok = t.gateway.callbackFor(s.txnid, 'success');
    await postCallback(t, ok); await postCallback(t, ok);
    assert.equal(orderOf(t, s.orderId).status, 'success'); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
    assert.ok(t.app.db.eventsFor(s.txnid).some((e) => e.outcome === 'late_success')); assertInvariants(t);
  });
  it('failure then an UNVERIFIED success claim stays failed', async () => {
    const c = await signedInClient(t, 'cb9'); const s = await startPayment(t, c);
    t.gateway.settle(s.txnid, 'failure'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'failure'));
    await postCallback(t, t.gateway.callbackFor(s.txnid, 'success')); assert.equal(orderOf(t, s.orderId).status, 'failed'); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 0);
  });
  it('browser refresh / repeated reads of the result endpoint are stable and side-effect free', async () => {
    const c = await signedInClient(t, 'cb10'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'));
    const snaps = new Set<string>(); for (let i = 0; i < 10; i++) snaps.add(JSON.stringify((await c.get(`/api/payments/${s.orderId}`)).json));
    assert.equal(snaps.size, 1); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1);
  });
  it('success vs cancel racing on the same transaction never produces an inconsistent end state', async () => {
    for (let round = 0; round < 8; round++) {
      const c = await signedInClient(t, 'race'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
      const ps = t.gateway.callbackFor(s.txnid, 'success'); const pc = t.gateway.callbackFor(s.txnid, 'cancel');
      await Promise.all([...Array.from({ length: 5 }, () => postCallback(t, ps)), ...Array.from({ length: 5 }, () => postCallback(t, pc))]);
      // gateway ledger says success, so whatever order the callbacks arrived in, a reconcile must converge on success
      await c.post(`/api/payments/${s.orderId}/refresh`);
      assert.equal(orderOf(t, s.orderId).status, 'success', `round ${round}`); assertInvariants(t, `round ${round}`);
    }
  });
});
