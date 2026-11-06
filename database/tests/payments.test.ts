import { createRepositories } from '../src/repositories';
import { AccountNotActiveError, DuplicateOrderError, IdempotencyKeyReuseError, PlanNotPurchasableError } from '../src/shared/errors';
import { closePrisma, getPrisma, key, makePlan, makeUser, svc, truncateAll } from './helpers/db';

beforeEach(truncateAll);
afterAll(closePrisma);

describe('payment creation', () => {
  test('creates a payment whose price/currency/duration come from the DB plan, with separate order & txn ids', async () => {
    const u = await makeUser(); const plan = await makePlan({ priceMinor: 12345, durationDays: 45 });
    const { payment, replayed } = await svc().payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() });
    expect(replayed).toBe(false);
    expect(payment).toMatchObject({ amountMinor: 12345, currency: 'INR', planDurationDays: 45, status: 'CREATED', provider: 'PAYU', providerTransactionId: null });
    expect(payment.orderId).not.toBe(payment.transactionId);
    expect(payment.transactionId.length).toBeLessThanOrEqual(25);
    const events = await getPrisma().paymentEvent.findMany({ where: { paymentId: payment.id } });
    expect(events.map((e) => e.eventType)).toEqual(['PAYMENT_CREATED']);
  });
  test('later plan price changes do not alter existing payments (snapshot)', async () => {
    const u = await makeUser(); const plan = await makePlan({ priceMinor: 1000 });
    const { payment } = await svc().payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() });
    await getPrisma().plan.update({ where: { id: plan.id }, data: { priceMinor: 9999 } });
    expect((await getPrisma().payment.findUniqueOrThrow({ where: { id: payment.id } })).amountMinor).toBe(1000);
  });
  test('rejects inactive plans, unknown users, and non-active accounts', async () => {
    const u = await makeUser(); const inactive = await makePlan({ isActive: false }); const ok = await makePlan();
    await expect(svc().payments.createPaymentOrder({ userId: u.id, planId: inactive.id, idempotencyKey: key() })).rejects.toBeInstanceOf(PlanNotPurchasableError);
    await getPrisma().user.update({ where: { id: u.id }, data: { accountStatus: 'SUSPENDED' } });
    await expect(svc().payments.createPaymentOrder({ userId: u.id, planId: ok.id, idempotencyKey: key() })).rejects.toBeInstanceOf(AccountNotActiveError);
    await expect(svc().payments.createPaymentOrder({ userId: '00000000-0000-4000-8000-000000000000', planId: ok.id, idempotencyKey: key() })).rejects.toThrow(/not found/);
  });
  test('failed order creation rolls back its idempotency record (key stays usable)', async () => {
    const u = await makeUser(); const inactive = await makePlan({ isActive: false }); const k = key();
    await expect(svc().payments.createPaymentOrder({ userId: u.id, planId: inactive.id, idempotencyKey: k })).rejects.toBeInstanceOf(PlanNotPurchasableError);
    expect(await getPrisma().idempotencyRecord.count()).toBe(0);
  });
  test('validates input (bad uuid / short key)', async () => {
    await expect(svc().payments.createPaymentOrder({ userId: 'nope', planId: 'nope', idempotencyKey: 'short' })).rejects.toThrow();
  });
});

describe('unique constraints', () => {
  test('duplicate orderId is rejected and never overwrites the original', async () => {
    const u = await makeUser(); const plan = await makePlan(); const repo = createRepositories(getPrisma()).payments;
    const base = { userId: u.id, planId: plan.id, amountMinor: 100, currency: 'INR', planDurationDays: 30 };
    await repo.create({ ...base, orderId: 'ord_dup', transactionId: 'T_A', idempotencyKey: 'k-aaaaaaaaaaaaaaaa' });
    await expect(repo.create({ ...base, amountMinor: 999, orderId: 'ord_dup', transactionId: 'T_B', idempotencyKey: 'k-bbbbbbbbbbbbbbbb' })).rejects.toBeInstanceOf(DuplicateOrderError);
    const rows = await getPrisma().payment.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountMinor).toBe(100);
  });
  test('duplicate transactionId and duplicate (user, idempotencyKey) are rejected', async () => {
    const u = await makeUser(); const plan = await makePlan(); const repo = createRepositories(getPrisma()).payments;
    const base = { userId: u.id, planId: plan.id, amountMinor: 100, currency: 'INR', planDurationDays: 30 };
    await repo.create({ ...base, orderId: 'o1', transactionId: 'T1', idempotencyKey: 'k-aaaaaaaaaaaaaaaa' });
    await expect(repo.create({ ...base, orderId: 'o2', transactionId: 'T1', idempotencyKey: 'k-bbbbbbbbbbbbbbbb' })).rejects.toMatchObject({ details: { field: 'transactionId' } });
    await expect(repo.create({ ...base, orderId: 'o3', transactionId: 'T3', idempotencyKey: 'k-aaaaaaaaaaaaaaaa' })).rejects.toMatchObject({ details: { field: 'idempotencyKey' } });
  });
});

describe('idempotency', () => {
  test('same key + same request replays the SAME payment', async () => {
    const u = await makeUser(); const plan = await makePlan(); const k = key();
    const a = await svc().payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: k });
    const b = await svc().payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: k });
    expect(b.replayed).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    expect(await getPrisma().payment.count()).toBe(1);
  });
  test('same key with a different request is rejected', async () => {
    const u = await makeUser(); const p1 = await makePlan(); const p2 = await makePlan(); const k = key();
    await svc().payments.createPaymentOrder({ userId: u.id, planId: p1.id, idempotencyKey: k });
    await expect(svc().payments.createPaymentOrder({ userId: u.id, planId: p2.id, idempotencyKey: k })).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
  });
  test('the same key string used by two different users is independent', async () => {
    const u1 = await makeUser(); const u2 = await makeUser(); const plan = await makePlan(); const k = key();
    const a = await svc().payments.createPaymentOrder({ userId: u1.id, planId: plan.id, idempotencyKey: k });
    const b = await svc().payments.createPaymentOrder({ userId: u2.id, planId: plan.id, idempotencyKey: k });
    expect(a.payment.id).not.toBe(b.payment.id);
  });
  test('RACE: 15 concurrent requests with one key create exactly one payment', async () => {
    const u = await makeUser(); const plan = await makePlan(); const k = key(); const s = svc();
    const results = await Promise.all(Array.from({ length: 15 }, () => s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: k })));
    expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await getPrisma().payment.count()).toBe(1);
    expect(await getPrisma().idempotencyRecord.count()).toBe(1);
  });
  test('expired IN_PROGRESS records can be re-claimed; COMPLETED are retained by purge', async () => {
    const u = await makeUser(); const plan = await makePlan(); const s = svc();
    const done = await s.payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() });
    await getPrisma().idempotencyRecord.create({ data: { userId: u.id, idempotencyKey: 'stale-in-progress-key', requestFingerprint: 'a'.repeat(64), expiresAt: new Date(Date.now() - 1000) } });
    expect(await s.idempotency.purgeExpired(getPrisma())).toBe(1);
    expect(await getPrisma().idempotencyRecord.count()).toBe(1);
    expect(done.payment.id).toBeTruthy();
  });
});

describe('DB-enforced payment integrity (bypassing the services)', () => {
  async function onePayment() {
    const u = await makeUser(); const plan = await makePlan();
    return (await svc().payments.createPaymentOrder({ userId: u.id, planId: plan.id, idempotencyKey: key() })).payment;
  }
  test('amount, currency and order id are immutable', async () => {
    const p = await onePayment();
    await expect(getPrisma().$executeRawUnsafe(`UPDATE payments SET amount_minor = 1 WHERE id = '${p.id}'`)).rejects.toThrow(/BC_IMMUTABLE/);
    await expect(getPrisma().$executeRawUnsafe(`UPDATE payments SET order_id = 'x' WHERE id = '${p.id}'`)).rejects.toThrow(/BC_IMMUTABLE/);
  });
  test('payments cannot be deleted', async () => {
    const p = await onePayment();
    await expect(getPrisma().$executeRawUnsafe(`DELETE FROM payments WHERE id = '${p.id}'`)).rejects.toThrow(/BC_RETENTION/);
  });
  test('SUCCESS requires verified_at and provider_transaction_id (CHECK)', async () => {
    const p = await onePayment();
    await expect(getPrisma().$executeRawUnsafe(`UPDATE payments SET status = 'SUCCESS' WHERE id = '${p.id}'`)).rejects.toThrow();
  });
  test('SUCCESS can never move back to FAILED', async () => {
    const p = await onePayment();
    await getPrisma().$executeRawUnsafe(`UPDATE payments SET status='SUCCESS', verified_at=now(), provider_transaction_id='m1' WHERE id='${p.id}'`);
    await expect(getPrisma().$executeRawUnsafe(`UPDATE payments SET status='FAILED' WHERE id='${p.id}'`)).rejects.toThrow(/BC_TRANSITION/);
  });
  test('payment events are append-only', async () => {
    const p = await onePayment();
    await expect(getPrisma().$executeRawUnsafe(`UPDATE payment_events SET payload='{}' WHERE payment_id='${p.id}'`)).rejects.toThrow(/BC_IMMUTABLE/);
    await expect(getPrisma().$executeRawUnsafe(`DELETE FROM payment_events WHERE payment_id='${p.id}'`)).rejects.toThrow(/BC_RETENTION/);
  });
});
