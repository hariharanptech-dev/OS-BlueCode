import { addDaysUtc } from '../src/shared/time';
import { closePrisma, getPrisma, key, makePlan, makeUser, svc, truncateAll, verifiedFor } from './helpers/db';

beforeEach(truncateAll);
afterAll(closePrisma);

async function order(opts: { priceMinor?: number; durationDays?: number } = {}, services = svc(), userId?: string) {
  const user = userId ? { id: userId } : await makeUser();
  const plan = await makePlan(opts);
  const { payment } = await services.payments.createPaymentOrder({ userId: user.id, planId: plan.id, idempotencyKey: key() });
  return { user, plan, payment };
}
const subCount = () => getPrisma().subscription.count();

describe('activation', () => {
  test('verified success => payment SUCCESS + exactly one ACTIVE subscription with correct UTC expiry', async () => {
    const t0 = new Date('2026-06-01T08:30:00.000Z');
    const s = svc({ clock: () => t0 });
    const { payment } = await order({ durationDays: 30 }, s);
    const r = await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    expect(r.outcome).toBe('ACTIVATED');
    expect(r.payment.status).toBe('SUCCESS');
    expect(r.payment.providerTransactionId).toBeTruthy();
    expect(r.subscription).toMatchObject({ status: 'ACTIVE', paymentId: payment.id, userId: payment.userId, planId: payment.planId });
    expect(r.subscription!.startDate.toISOString()).toBe(t0.toISOString());
    expect(r.subscription!.endDate.toISOString()).toBe(addDaysUtc(t0, 30).toISOString());
    expect(r.subscription!.endDate.toISOString()).toBe('2026-07-01T08:30:00.000Z');
    const evs = await getPrisma().paymentEvent.findMany({ where: { paymentId: payment.id }, orderBy: { receivedAt: 'asc' } });
    expect(evs.map((e) => e.eventType)).toEqual(expect.arrayContaining(['PAYMENT_CREATED', 'PAYMENT_STATUS_CHANGED', 'SUBSCRIPTION_ACTIVATED']));
    expect(await getPrisma().subscriptionEvent.count({ where: { subscriptionId: r.subscription!.id, toStatus: 'ACTIVE' } })).toBe(1);
  });

  test('duration comes from the order-time snapshot, not the current plan', async () => {
    const t0 = new Date('2026-06-01T00:00:00.000Z'); const s = svc({ clock: () => t0 });
    const { plan, payment } = await order({ durationDays: 30 }, s);
    await getPrisma().plan.update({ where: { id: plan.id }, data: { durationDays: 365 } });
    const r = await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    expect(r.subscription!.endDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  test('repeated callbacks are idempotent: still one subscription, later calls are ALREADY_ACTIVATED', async () => {
    const s = svc(); const { payment } = await order({}, s);
    const first = await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    const again = await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    const third = await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    expect([first.outcome, again.outcome, third.outcome]).toEqual(['ACTIVATED', 'ALREADY_ACTIVATED', 'ALREADY_ACTIVATED']);
    expect(again.subscription!.id).toBe(first.subscription!.id);
    expect(await subCount()).toBe(1);
  });

  test('RACE: 12 concurrent callbacks for one payment create exactly one subscription', async () => {
    const s = svc(); const { payment } = await order({}, s);
    const results = await Promise.all(Array.from({ length: 12 }, () => s.activation.activateFromVerifiedPayment(verifiedFor(payment))));
    expect(results.filter((r) => r.outcome === 'ACTIVATED')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'ALREADY_ACTIVATED')).toHaveLength(11);
    expect(await subCount()).toBe(1);
    expect(await getPrisma().subscription.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });

  test('RACE: two different payments of one user activated concurrently serialise into back-to-back windows', async () => {
    const t0 = new Date('2026-06-01T00:00:00.000Z'); const s = svc({ clock: () => t0 });
    const a = await order({ durationDays: 30 }, s);
    const plan2 = await makePlan({ durationDays: 10 });
    const p2 = (await s.payments.createPaymentOrder({ userId: a.user.id, planId: plan2.id, idempotencyKey: key() })).payment;
    await Promise.all([s.activation.activateFromVerifiedPayment(verifiedFor(a.payment)), s.activation.activateFromVerifiedPayment(verifiedFor(p2))]);
    const subs = await getPrisma().subscription.findMany({ where: { userId: a.user.id }, orderBy: { startDate: 'asc' } });
    expect(subs).toHaveLength(2);
    expect(subs.map((x) => x.status)).toEqual(['ACTIVE', 'PENDING']);
    expect(subs[1]!.startDate.getTime()).toBe(subs[0]!.endDate.getTime()); // no overlap, no gap
  });

  test('RACE: many users activating at once do not interfere', async () => {
    const s = svc(); const plan = await makePlan();
    const payments = await Promise.all(Array.from({ length: 10 }, async () => {
      const u = await makeUser();
      return (await s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() })).payment;
    }));
    await Promise.all(payments.map((p) => s.activation.activateFromVerifiedPayment(verifiedFor(p))));
    expect(await getPrisma().subscription.count({ where: { status: 'ACTIVE' } })).toBe(10);
  });
});

describe('failed / cancelled / rejected payments never activate', () => {
  test('FAILED payment: no subscription, and a later non-reconciliation "success" is rejected', async () => {
    const s = svc(); const { payment } = await order({}, s);
    expect((await s.payments.recordFailure({ orderId: payment.orderId, status: 'FAILED', reason: 'BANK_DECLINED' })).outcome).toBe('RECORDED');
    expect(await subCount()).toBe(0);
    const r = await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    expect(r).toMatchObject({ outcome: 'REJECTED', reason: 'PAYMENT_NOT_ACTIVATABLE' });
    expect(await subCount()).toBe(0);
    expect((await getPrisma().payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
  });
  test('CANCELLED payment: no subscription', async () => {
    const s = svc(); const { payment } = await order({}, s);
    await s.payments.recordFailure({ orderId: payment.orderId, status: 'CANCELLED', reason: 'USER_CANCELLED' });
    expect(await subCount()).toBe(0);
    expect((await getPrisma().payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CANCELLED');
  });
  test('duplicate failure callbacks are idempotent', async () => {
    const s = svc(); const { payment } = await order({}, s);
    await s.payments.recordFailure({ orderId: payment.orderId, status: 'FAILED' });
    expect((await s.payments.recordFailure({ orderId: payment.orderId, status: 'FAILED' })).outcome).toBe('ALREADY_TERMINAL');
  });
  test('a late failure callback after success cannot downgrade the payment or touch the subscription', async () => {
    const s = svc(); const { payment } = await order({}, s);
    await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    expect((await s.payments.recordFailure({ orderId: payment.orderId, status: 'FAILED' })).outcome).toBe('IGNORED_ALREADY_SUCCESS');
    expect((await getPrisma().payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCESS');
    expect(await getPrisma().subscription.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });
  test('reconciliation may revive a FAILED payment that PayU later confirms as successful', async () => {
    const s = svc(); const { payment } = await order({}, s);
    await s.payments.recordFailure({ orderId: payment.orderId, status: 'FAILED' });
    const r = await s.reconciliation.applyVerdict({ outcome: 'SUCCESS', verified: verifiedFor(payment) });
    expect(r).toMatchObject({ outcome: 'ACTIVATED' });
    expect(await subCount()).toBe(1);
  });
  test('amount, currency and txnid mismatches are rejected, audited, and activate nothing', async () => {
    const s = svc(); const { payment } = await order({ priceMinor: 49900 }, s);
    expect(await s.activation.activateFromVerifiedPayment(verifiedFor(payment, { amountMinor: 100 }))).toMatchObject({ outcome: 'REJECTED', reason: 'AMOUNT_MISMATCH' });
    expect(await s.activation.activateFromVerifiedPayment(verifiedFor(payment, { currency: 'USD' }))).toMatchObject({ outcome: 'REJECTED', reason: 'CURRENCY_MISMATCH' });
    expect(await s.activation.activateFromVerifiedPayment(verifiedFor(payment, { transactionId: 'WRONG' }))).toMatchObject({ outcome: 'REJECTED', reason: 'TRANSACTION_ID_MISMATCH' });
    expect(await subCount()).toBe(0);
    expect((await getPrisma().payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CREATED');
    expect(await getPrisma().paymentEvent.count({ where: { paymentId: payment.id, eventType: 'VERIFICATION_MISMATCH' } })).toBe(3);
    expect((await s.reconciliation.findAnomalies()).rejectedVerifications).toHaveLength(1);
  });
  test('the same PayU transaction id cannot be used to activate two different payments', async () => {
    const s = svc(); const a = await order({}, s); const b = await order({}, s);
    const shared = 'mihSHARED1';
    await s.activation.activateFromVerifiedPayment(verifiedFor(a.payment, { providerTransactionId: shared }));
    expect(await s.activation.activateFromVerifiedPayment(verifiedFor(b.payment, { providerTransactionId: shared }))).toMatchObject({ outcome: 'REJECTED', reason: 'PROVIDER_TRANSACTION_ALREADY_USED' });
    expect(await subCount()).toBe(1);
  });
  test('unknown order id throws NotFound', async () => {
    await expect(svc().activation.activateFromVerifiedPayment(verifiedFor({ orderId: 'ord_nope', transactionId: 'T', amountMinor: 1, currency: 'INR' }))).rejects.toThrow(/not found/);
  });
});

describe('auditing & data hygiene', () => {
  test('secrets / card data in provider payloads are never persisted', async () => {
    const s = svc(); const { payment } = await order({}, s);
    await s.payments.recordProviderEvent({ orderId: payment.orderId, eventType: 'CALLBACK_RECEIVED', providerReference: 'mih1', payload: { status: 'success', hash: 'H', cardnum: '4111111111111111', cvv: '123', name_on_card: 'N', email: 'a@b.c' } });
    await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    const dump = JSON.stringify(await getPrisma().paymentEvent.findMany());
    for (const secret of ['4111111111111111', 'MUST-NOT-BE-STORED', '"cvv"', 'cardnum', 'name_on_card', 'a@b.c', '"hash"']) expect(dump).not.toContain(secret);
    expect(dump).toContain('success');
  });
  test('subscription must reference exactly one payment; a second subscription for the same payment is impossible at DB level', async () => {
    const s = svc(); const { payment } = await order({}, s);
    const r = await s.activation.activateFromVerifiedPayment(verifiedFor(payment));
    await expect(getPrisma().subscription.create({ data: { userId: payment.userId, planId: payment.planId, paymentId: payment.id, status: 'EXPIRED', startDate: new Date('2020-01-01'), endDate: new Date('2020-02-01') } })).rejects.toThrow();
    expect(await subCount()).toBe(1);
    expect(r.subscription!.paymentId).toBe(payment.id);
  });
});

describe('transaction rollback', () => {
  test('failure just before commit rolls back payment status, subscription and audit events atomically', async () => {
    const s = svc({ activation: { beforeCommitHook: async () => { throw new Error('boom: simulated crash before commit'); } } });
    const { payment } = await order({}, s);
    await expect(s.activation.activateFromVerifiedPayment(verifiedFor(payment))).rejects.toThrow(/boom/);
    expect(await subCount()).toBe(0);
    expect(await getPrisma().subscriptionEvent.count()).toBe(0);
    const after = await getPrisma().payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('CREATED');
    expect(after.verifiedAt).toBeNull();
    expect(after.providerTransactionId).toBeNull();
    expect(await getPrisma().paymentEvent.count({ where: { paymentId: payment.id } })).toBe(1); // only PAYMENT_CREATED
    // and the system recovers: a healthy retry succeeds
    const ok = await svc().activation.activateFromVerifiedPayment(verifiedFor(payment));
    expect(ok.outcome).toBe('ACTIVATED');
  });
});

describe('database-level subscription guards (bypassing the services)', () => {
  async function twoPaidPayments() {
    const s = svc(); const a = await order({}, s); const plan = await makePlan();
    const p2 = (await s.payments.createPaymentOrder({ userId: a.user.id, planId: plan.id, idempotencyKey: key() })).payment;
    return { s, a, p2 };
  }
  test('a second ACTIVE subscription for one user is impossible', async () => {
    const { s, a, p2 } = await twoPaidPayments();
    await s.activation.activateFromVerifiedPayment(verifiedFor(a.payment));
    await expect(getPrisma().subscription.create({ data: { userId: a.user.id, planId: p2.planId, paymentId: p2.id, status: 'ACTIVE', activatedAt: new Date(), startDate: new Date('2099-01-01'), endDate: new Date('2099-02-01') } })).rejects.toThrow();
  });
  test('overlapping live windows are impossible (EXCLUDE constraint)', async () => {
    const { s, a, p2 } = await twoPaidPayments();
    const r = await s.activation.activateFromVerifiedPayment(verifiedFor(a.payment));
    await expect(getPrisma().subscription.create({ data: { userId: a.user.id, planId: p2.planId, paymentId: p2.id, status: 'PENDING', startDate: new Date(r.subscription!.startDate.getTime() + 1000), endDate: new Date(r.subscription!.endDate.getTime() + 1000) } })).rejects.toThrow(/subscriptions_no_overlap_excl|exclusion/i);
  });
  test('start/end/payment of an existing subscription are immutable; terminal states cannot be left', async () => {
    const { s, a } = await twoPaidPayments();
    const r = await s.activation.activateFromVerifiedPayment(verifiedFor(a.payment)); const id = r.subscription!.id;
    await expect(getPrisma().$executeRawUnsafe(`UPDATE subscriptions SET end_date = end_date + interval '100 days' WHERE id='${id}'`)).rejects.toThrow(/BC_IMMUTABLE/);
    await s.lifecycle.cancel(id, 'test');
    await expect(getPrisma().$executeRawUnsafe(`UPDATE subscriptions SET status='ACTIVE', activated_at=now() WHERE id='${id}'`)).rejects.toThrow(/BC_TRANSITION/);
    await expect(getPrisma().$executeRawUnsafe(`DELETE FROM subscriptions WHERE id='${id}'`)).rejects.toThrow(/BC_RETENTION/);
  });
});
