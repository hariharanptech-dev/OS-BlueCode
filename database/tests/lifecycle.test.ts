import { InvalidTransitionError, NotFoundError } from '../src/shared/errors';
import { closePrisma, getPrisma, key, makePlan, makeUser, svc, truncateAll, verifiedFor } from './helpers/db';

beforeEach(truncateAll);
afterAll(closePrisma);

const DAY = 86_400_000;
const t0 = new Date('2026-06-01T00:00:00.000Z');
const at = (days: number, h = 0) => new Date(t0.getTime() + days * DAY + h * 3600_000);

function world() {
  let now = t0;
  const s = svc({ clock: () => now });
  return {
    s, set: (d: Date) => { now = d; },
    async buy(userId: string, durationDays = 30) {
      const plan = await makePlan({ durationDays });
      const { payment } = await s.payments.createPaymentOrder({ userId, planId: plan.id, idempotencyKey: key() });
      return s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    },
  };
}

describe('expiry', () => {
  test('entitlement is date-based: access ends at end_date even if the sweep has not run yet', async () => {
    const w = world(); const u = await makeUser(); const r = await w.buy(u.id, 30);
    expect((await w.s.expiry.getCurrentEntitlement(u.id, at(29, 23))).active).toBe(true);
    expect((await w.s.expiry.getCurrentEntitlement(u.id, at(30))).active).toBe(false); // exact boundary: end is exclusive
    expect((await getPrisma().subscription.findUniqueOrThrow({ where: { id: r.subscription!.id } })).status).toBe('ACTIVE'); // not swept yet
  });
  test('sweep expires ended subscriptions, audits it, and is idempotent', async () => {
    const w = world(); const u = await makeUser(); const r = await w.buy(u.id, 30);
    w.set(at(31));
    expect(await w.s.expiry.run()).toEqual({ expired: 1, promoted: 0 });
    expect(await w.s.expiry.run()).toEqual({ expired: 0, promoted: 0 });
    expect((await getPrisma().subscription.findUniqueOrThrow({ where: { id: r.subscription!.id } })).status).toBe('EXPIRED');
    const evs = await getPrisma().subscriptionEvent.findMany({ where: { subscriptionId: r.subscription!.id }, orderBy: { createdAt: 'asc' } });
    expect(evs.map((e) => `${e.fromStatus}>${e.toStatus}`)).toEqual(['null>ACTIVE', 'ACTIVE>EXPIRED']);
  });
  test('concurrent sweeps do not double-process', async () => {
    const w = world(); const u = await makeUser(); await w.buy(u.id, 1); w.set(at(2));
    const rs = await Promise.all([w.s.expiry.run(), w.s.expiry.run(), w.s.expiry.run()]);
    expect(rs.reduce((a, r) => a + r.expired, 0)).toBe(1);
    expect(await getPrisma().subscriptionEvent.count({ where: { toStatus: 'EXPIRED' } })).toBe(1);
  });
});

describe('renewal (stacked purchase, no auto-billing)', () => {
  test('renewing while ACTIVE queues a PENDING subscription starting exactly at the current end, then it is promoted', async () => {
    const w = world(); const u = await makeUser();
    const first = await w.buy(u.id, 30);
    w.set(at(5));
    const renewal = await w.buy(u.id, 30);
    expect(renewal.subscription!.status).toBe('PENDING');
    expect(renewal.subscription!.startDate.toISOString()).toBe(first.subscription!.endDate.toISOString());
    expect(renewal.subscription!.activatedAt).toBeNull();
    expect((await w.s.expiry.getCurrentEntitlement(u.id, at(10))).subscription!.id).toBe(first.subscription!.id);

    w.set(at(30, 1));
    expect(await w.s.expiry.run()).toEqual({ expired: 1, promoted: 1 });
    const ent = await w.s.expiry.getCurrentEntitlement(u.id, at(30, 1));
    expect(ent.active && ent.subscription.id).toBe(renewal.subscription!.id);
    expect(ent.subscription!.endDate.toISOString()).toBe(at(60).toISOString());
  });
  test('renewing after expiry starts immediately (no stale window carried over)', async () => {
    const w = world(); const u = await makeUser(); await w.buy(u.id, 10);
    w.set(at(20));
    const r = await w.buy(u.id, 10); // activation itself expires the stale ACTIVE row for this user
    expect(r.subscription!.status).toBe('ACTIVE');
    expect(r.subscription!.startDate.toISOString()).toBe(at(20).toISOString());
    expect(await getPrisma().subscription.count({ where: { userId: u.id, status: 'ACTIVE' } })).toBe(1);
  });
});

describe('suspend / resume / cancel', () => {
  test('suspend then resume within the window; both audited', async () => {
    const w = world(); const u = await makeUser(); const r = await w.buy(u.id, 30); const id = r.subscription!.id;
    w.set(at(2));
    expect((await w.s.lifecycle.suspend(id, 'PAYMENT_REVIEW', 'ADMIN:1')).status).toBe('SUSPENDED');
    expect((await w.s.expiry.getCurrentEntitlement(u.id, at(3))).active).toBe(false);
    w.set(at(4));
    const resumed = await w.s.lifecycle.resume(id, 'REVIEW_CLEARED', 'ADMIN:1');
    expect(resumed.status).toBe('ACTIVE');
    expect(resumed.endDate.toISOString()).toBe(r.subscription!.endDate.toISOString()); // dates never move
    expect((await getPrisma().subscriptionEvent.findMany({ where: { subscriptionId: id }, orderBy: { createdAt: 'asc' } })).map((e) => e.toStatus)).toEqual(['ACTIVE', 'SUSPENDED', 'ACTIVE']);
  });
  test('resume after the window ended yields EXPIRED, not ACTIVE', async () => {
    const w = world(); const u = await makeUser(); const r = await w.buy(u.id, 5);
    await w.s.lifecycle.suspend(r.subscription!.id, 'x'); w.set(at(9));
    expect((await w.s.lifecycle.resume(r.subscription!.id, 'late')).status).toBe('EXPIRED');
  });
  test('cancel is terminal; illegal transitions are rejected by the service', async () => {
    const w = world(); const u = await makeUser(); const r = await w.buy(u.id, 30); const id = r.subscription!.id;
    const c = await w.s.lifecycle.cancel(id, 'USER_REQUEST');
    expect(c).toMatchObject({ status: 'CANCELLED', statusReason: 'USER_REQUEST' });
    expect(c.cancelledAt).toBeTruthy();
    await expect(w.s.lifecycle.resume(id, 'x')).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(w.s.lifecycle.suspend(id, 'x')).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(w.s.lifecycle.cancel('00000000-0000-4000-8000-000000000000', 'x')).rejects.toBeInstanceOf(NotFoundError);
    expect((await w.s.expiry.getCurrentEntitlement(u.id)).active).toBe(false);
  });
  test('RACE: concurrent cancel + suspend leaves a consistent single outcome', async () => {
    const w = world(); const u = await makeUser(); const r = await w.buy(u.id, 30); const id = r.subscription!.id;
    const results = await Promise.allSettled([w.s.lifecycle.cancel(id, 'a'), w.s.lifecycle.suspend(id, 'b')]);
    expect(results.some((x) => x.status === 'fulfilled')).toBe(true);
    const final = await getPrisma().subscription.findUniqueOrThrow({ where: { id } });
    expect(['CANCELLED', 'SUSPENDED']).toContain(final.status);
  });
});

describe('transaction history', () => {
  test('cursor pagination is stable, complete and ordered newest-first', async () => {
    const w = world(); const u = await makeUser(); const plan = await makePlan();
    for (let i = 0; i < 5; i++) await w.s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() });
    const seen: string[] = []; let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await w.s.history.listPayments({ userId: u.id, limit: 2, cursor });
      seen.push(...r.items.map((i) => i.id)); cursor = r.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
  test('status filter and no leakage across users; detail includes events + subscription', async () => {
    const w = world(); const a = await makeUser(); const b = await makeUser();
    const ra = await w.buy(a.id); await w.buy(b.id);
    const only = await w.s.history.listPayments({ userId: a.id, status: 'SUCCESS' });
    expect(only.items).toHaveLength(1);
    expect(only.items[0]).not.toHaveProperty('idempotencyKey');
    const detail = await w.s.history.getPaymentDetail(a.id, ra.payment.id);
    expect(detail.subscription?.id).toBe(ra.subscription!.id);
    expect(detail.events.length).toBeGreaterThanOrEqual(3);
    await expect(w.s.history.getPaymentDetail(b.id, ra.payment.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await w.s.history.listSubscriptions(a.id)).toHaveLength(1);
  });
  test('history is retained after failures and expiry', async () => {
    const w = world(); const u = await makeUser(); const plan = await makePlan();
    const { payment } = await w.s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() });
    await w.s.payments.recordFailure({ orderId: payment.orderId, status: 'FAILED', reason: 'DECLINED' });
    await w.buy(u.id, 1); w.set(at(3)); await w.s.expiry.run();
    const all = await w.s.history.listPayments({ userId: u.id });
    expect(all.items.map((i) => i.status).sort()).toEqual(['FAILED', 'SUCCESS']);
  });
});

describe('reconciliation support', () => {
  test('finds stale CREATED/PENDING payments only', async () => {
    const w = world(); w.set(new Date()); const u = await makeUser(); const plan = await makePlan();
    const old = (await w.s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() })).payment;
    await getPrisma().$executeRawUnsafe(`ALTER TABLE payments DISABLE TRIGGER payments_guard_update`);
    await getPrisma().$executeRawUnsafe(`UPDATE payments SET initiated_at = now() - interval '2 hours' WHERE id='${old.id}'`);
    await getPrisma().$executeRawUnsafe(`ALTER TABLE payments ENABLE TRIGGER payments_guard_update`);
    await w.s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() }); // fresh
    w.set(new Date());
    const stale = await w.s.reconciliation.findStalePayments(3600_000);
    expect(stale.map((p) => p.id)).toEqual([old.id]);
  });
  test('verdicts: SUCCESS activates, STILL_PENDING only audits, FAILED records failure; re-applying is harmless', async () => {
    const w = world(); const u = await makeUser(); const plan = await makePlan();
    const mk = async () => (await w.s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() })).payment;
    const ok = await mk(); const pend = await mk(); const bad = await mk();
    const v = verifiedFor(ok);
    await w.s.reconciliation.applyVerdict({ outcome: 'SUCCESS', verified: v });
    expect(await w.s.reconciliation.applyVerdict({ outcome: 'SUCCESS', verified: v })).toMatchObject({ outcome: 'ALREADY_ACTIVATED' });
    await w.s.reconciliation.applyVerdict({ outcome: 'STILL_PENDING', orderId: pend.orderId });
    await w.s.reconciliation.applyVerdict({ outcome: 'FAILED', orderId: bad.orderId, reason: 'PAYU_FAILED' });
    const st = async (id: string) => (await getPrisma().payment.findUniqueOrThrow({ where: { id } })).status;
    expect([await st(ok.id), await st(pend.id), await st(bad.id)]).toEqual(['SUCCESS', 'CREATED', 'FAILED']);
    expect(await getPrisma().paymentEvent.count({ where: { paymentId: pend.id, eventType: 'RECONCILIATION_CHECKED' } })).toBe(1);
  });
  test('anomaly report catches SUCCESS payments without a subscription, and reconciliation repairs them', async () => {
    const w = world(); const u = await makeUser(); const plan = await makePlan();
    const p = (await w.s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() })).payment;
    await getPrisma().$executeRawUnsafe(`UPDATE payments SET status='SUCCESS', verified_at=now(), provider_transaction_id='mihX' WHERE id='${p.id}'`);
    expect((await w.s.reconciliation.findAnomalies()).successWithoutSubscription.map((r) => r.id)).toEqual([p.id]);
    const r = await w.s.reconciliation.applyVerdict({ outcome: 'SUCCESS', verified: verifiedFor(p, { providerTransactionId: 'mihX' }) });
    expect(r).toMatchObject({ outcome: 'ACTIVATED' });
    const a = await w.s.reconciliation.findAnomalies();
    expect([a.successWithoutSubscription, a.subscriptionsWithoutSuccessPayment, a.liveButPastEnd]).toEqual([[], [], []]);
  });
});
