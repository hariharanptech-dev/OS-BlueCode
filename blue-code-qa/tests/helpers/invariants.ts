import assert from 'node:assert/strict';
import type { TestApp } from './harness.ts';

/** System-wide invariants that must hold after ANY sequence of events. */
export function assertInvariants(t: TestApp, label = ''): void {
  const orders = t.app.db.allOrders();
  const subs = t.app.db.allSubscriptions();
  const byPayment = new Map<string, number>();
  for (const s of subs) byPayment.set(s.paymentId, (byPayment.get(s.paymentId) ?? 0) + 1);
  for (const [pid, n] of byPayment) assert.equal(n, 1, `${label} payment ${pid} activated ${n} times`);
  for (const o of orders) {
    const sub = subs.find((s) => s.paymentId === o.id);
    if (o.status === 'success') {
      assert.ok(sub, `${label} success order ${o.txnid} has no subscription`);
      assert.equal(sub.userId, o.userId, `${label} subscription assigned to wrong user`);
      assert.equal(sub.planId, o.planId, `${label} subscription has wrong plan`);
      assert.ok(o.completedAt, `${label} success order missing completedAt`);
    } else {
      assert.equal(sub, undefined, `${label} order ${o.txnid} is ${o.status} but has a subscription (money not confirmed!)`);
    }
    const g = t.gateway.txns.get(o.txnid);
    if (o.status === 'success') assert.equal(g?.status, 'success', `${label} order success but gateway ledger says ${g?.status}`);
  }
}
