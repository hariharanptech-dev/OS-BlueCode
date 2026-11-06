import { createPrismaClient, type PrismaClient } from '../../src/db/client';
import { createServices, type ServiceOptions } from '../../src/services';

export const FAKE_ARGON2 = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$ZmFrZWhhc2hmb3J0ZXN0c29ubHk';
let prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL missing');
  return (prisma ??= createPrismaClient(url, { poolMax: 30 }));
}
export async function closePrisma() { await prisma?.$disconnect(); prisma = undefined; }

export async function truncateAll() {
  // TRUNCATE is not blocked by the row-level no-delete triggers; intended for tests only.
  await getPrisma().$executeRawUnsafe('TRUNCATE payment_events, subscription_events, subscriptions, payments, idempotency_records, plans, users RESTART IDENTITY CASCADE');
}

let n = 0;
export async function makeUser(email = `user${++n}-${Date.now()}@example.test`) {
  return getPrisma().user.create({ data: { name: 'Test User', email, passwordHash: FAKE_ARGON2 } });
}
export async function makePlan(over: Partial<{ code: string; priceMinor: number; durationDays: number; isActive: boolean }> = {}) {
  return getPrisma().plan.create({
    data: { code: over.code ?? `TEST_PLAN_${++n}`, name: 'SAMPLE test plan', priceMinor: over.priceMinor ?? 49900, currency: 'INR', billingInterval: 'MONTHLY', durationDays: over.durationDays ?? 30, isActive: over.isActive ?? true },
  });
}
export const svc = (o: ServiceOptions = {}) => createServices(getPrisma(), o);
export const key = () => `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}-padpadpad`;

/** Builds a "backend-verified" PayU result matching a stored payment (what the integration module would produce). */
export function verifiedFor(p: { orderId: string; transactionId: string; amountMinor: number; currency: string }, over: Record<string, unknown> = {}) {
  return {
    orderId: p.orderId, transactionId: p.transactionId, providerTransactionId: `mih${Math.random().toString(36).slice(2, 12)}`,
    amountMinor: p.amountMinor, currency: p.currency, verifiedAt: new Date(), source: 'PAYU_VERIFY_API' as const,
    payload: { status: 'success', mihpayid: 'x', hash: 'MUST-NOT-BE-STORED', cardnum: '4111111111111111', cvv: '123' }, ...over,
  };
}
