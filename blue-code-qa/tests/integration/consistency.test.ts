import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, startPayment, postCallback, subsOf, orderOf, type TestApp } from '../helpers/harness.ts';
import { assertInvariants } from '../helpers/invariants.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

describe('INT-DB transactional consistency', () => {
  it('a failure in the middle of activation rolls back the order update too (no "paid but no subscription")', async () => {
    const c = await signedInClient(t, 'tx1'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); const p = t.gateway.callbackFor(s.txnid, 'success');
    t.app.db.injectFailure('insertSubscription', 1);
    const r = await postCallback(t, p); assert.equal(r.status, 503);
    assert.equal(orderOf(t, s.orderId).status, 'pending', 'order update was rolled back'); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 0); assert.equal(t.app.db.eventsFor(s.txnid).length, 0, 'audit event rolled back too');
    assert.equal((await postCallback(t, p)).status, 303, 'PayU retry succeeds'); assert.equal(orderOf(t, s.orderId).status, 'success'); assertInvariants(t);
  });
  it('a failure when recording the audit event also rolls back the state change', async () => {
    const c = await signedInClient(t, 'tx2'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'failure'); t.app.db.injectFailure('insertEvent', 1);
    assert.equal((await postCallback(t, t.gateway.callbackFor(s.txnid, 'failure'))).status, 503); assert.equal(orderOf(t, s.orderId).status, 'pending');
  });
  it('database outage during checkout creates no partial order and no PayU form', async () => {
    const c = await signedInClient(t, 'tx3'); const n = t.app.db.allOrders().length; t.app.db.injectFailure('insertOrder', 1);
    const r = await c.checkout('pro_monthly'); assert.equal(r.status, 503); assert.equal(r.json.error.code, 'DB_UNAVAILABLE'); assert.equal(t.app.db.allOrders().length, n); assert.equal(r.json.payu, undefined);
    assert.equal((await c.checkout('pro_monthly')).status, 201, 'recovers');
  });
  it('transient outage on EVERY operation for a while, then recovery: system converges with no duplicates', async () => {
    const c = await signedInClient(t, 'tx4'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); const p = t.gateway.callbackFor(s.txnid, 'success');
    t.app.db.injectFailure('*', 3); const codes: number[] = []; for (let i = 0; i < 6; i++) codes.push((await postCallback(t, p)).status);
    assert.ok(codes.includes(503) && codes.includes(303), codes.join()); assert.equal(subsOf(t).filter((x) => x.paymentId === s.orderId).length, 1); t.app.db.clearFailures(); assertInvariants(t);
  });
  it('gateway outage then recovery: reconcile completes payments that were stuck, once', async () => {
    const cs = await Promise.all(Array.from({ length: 5 }, (_, i) => signedInClient(t, 'tx5' + i))); const ss = await Promise.all(cs.map((c) => startPayment(t, c)));
    t.gateway.verifyBehaviour = 'throw'; for (const s of ss) { t.gateway.settle(s.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'success')); }
    assert.ok(ss.every((s) => orderOf(t, s.orderId).status === 'pending')); t.clock.advanceMinutes(3); await t.app.payments.reconcilePending(); assert.ok(ss.every((s) => orderOf(t, s.orderId).status === 'pending'), 'still down: nothing changes');
    t.gateway.verifyBehaviour = 'ok'; await t.app.payments.reconcilePending(); await t.app.payments.reconcilePending();
    assert.ok(ss.every((s) => orderOf(t, s.orderId).status === 'success')); assertInvariants(t);
  });
});

/** Seeded PRNG so any failure is reproducible: re-run with the printed seed. */
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

describe('INT-FUZZ randomised event sequences preserve every payment/subscription invariant', () => {
  for (const seed of [1, 7, 42, 2026, 99991]) {
    it(`seed ${seed}: 150 random events across 6 orders`, async () => {
      const rand = rng(seed); const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
      const users = await Promise.all(Array.from({ length: 3 }, (_, i) => signedInClient(t, `fz${seed}_${i}`)));
      const orders: Array<{ txnid: string; orderId: string; u: number }> = [];
      for (let i = 0; i < 6; i++) { const u = i % 3; const s = await startPayment(t, users[u]!, pick(['starter_monthly', 'pro_monthly', 'pro_yearly'] as const)).catch(() => null); if (s) orders.push({ txnid: s.txnid, orderId: s.orderId, u }); }
      assert.ok(orders.length >= 3);
      const log: string[] = [];
      for (let step = 0; step < 150; step++) {
        const o = pick(orders); const act = pick(['settle-success', 'settle-failure', 'settle-cancel', 'cb-success', 'cb-failure', 'cb-cancel', 'cb-forged', 'cb-wrongamount', 'refresh', 'reconcile', 'gw-down', 'gw-up', 'clock'] as const); log.push(`${step}:${act}:${o.txnid.slice(-4)}`);
        try {
          switch (act) {
            case 'settle-success': if (t.gateway.txns.get(o.txnid)!.status === 'initiated') t.gateway.settle(o.txnid, 'success'); break; // a real txn does not change its mind after settling
            case 'settle-failure': if (t.gateway.txns.get(o.txnid)!.status === 'initiated') t.gateway.settle(o.txnid, 'failure'); break;
            case 'settle-cancel': if (t.gateway.txns.get(o.txnid)!.status === 'initiated') t.gateway.settle(o.txnid, 'cancel'); break;
            case 'cb-success': await postCallback(t, t.gateway.callbackFor(o.txnid, 'success')); break;
            case 'cb-failure': await postCallback(t, t.gateway.callbackFor(o.txnid, 'failure')); break;
            case 'cb-cancel': await postCallback(t, t.gateway.callbackFor(o.txnid, 'cancel')); break;
            case 'cb-forged': await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { wrongSalt: true })); break;
            case 'cb-wrongamount': await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { amount: '1.00' } })); break;
            case 'refresh': await users[o.u]!.post(`/api/payments/${o.orderId}/refresh`).catch(() => undefined); break;
            case 'reconcile': t.clock.advanceMinutes(3); await t.app.payments.reconcilePending(); break;
            case 'gw-down': t.gateway.verifyBehaviour = 'throw'; break;
            case 'gw-up': t.gateway.verifyBehaviour = 'ok'; break;
            case 'clock': t.clock.advanceMinutes(rand() < 0.2 ? 40 : 1); break;
          }
          assertInvariants(t, `seed=${seed} step=${step} ${act}`);
        } catch (e) { throw new Error(`invariant violated; seed=${seed}; trace=${log.slice(-12).join(' ')}\n${(e as Error).message}`); }
      }
      t.gateway.verifyBehaviour = 'ok'; t.clock.advanceMinutes(3); await t.app.payments.reconcilePending();
      assertInvariants(t, `seed=${seed} final`);
      // convergence: any order the gateway settled as success must now be success locally
      for (const o of orders) if (t.gateway.txns.get(o.txnid)!.status === 'success') assert.equal(orderOf(t, o.orderId).status, 'success', `order ${o.txnid} paid at gateway but not activated (seed ${seed})`);
    });
  }
});
