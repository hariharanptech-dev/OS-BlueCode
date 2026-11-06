import { loadEnv } from '../config/env';
import { createPrismaClient, type PrismaClient } from '../db/client';
import type { Clock } from '../shared/time';
import { IdempotencyService } from './idempotencyService';
import { PaymentService } from './paymentService';
import { ReconciliationService } from './reconciliationService';
import { SubscriptionActivationService, type ActivationOptions } from './subscriptionActivationService';
import { SubscriptionExpiryService } from './subscriptionExpiryService';
import { SubscriptionLifecycleService } from './subscriptionLifecycleService';
import { TransactionHistoryService } from './transactionHistoryService';

export * from './idempotencyService';
export * from './paymentService';
export * from './reconciliationService';
export * from './subscriptionActivationService';
export * from './subscriptionExpiryService';
export * from './subscriptionLifecycleService';
export * from './transactionHistoryService';

export interface ServiceOptions { clock?: Clock; idempotencyTtlMs?: number; activation?: Pick<ActivationOptions, 'beforeCommitHook'> }

/** Composition root: wire all services around one PrismaClient (Express-compatible: build once at startup). */
export function createServices(prisma: PrismaClient, o: ServiceOptions = {}) {
  const idempotency = new IdempotencyService(o.idempotencyTtlMs, o.clock);
  const payments = new PaymentService(prisma, idempotency, o.clock);
  const activation = new SubscriptionActivationService(prisma, { clock: o.clock, ...o.activation });
  const expiry = new SubscriptionExpiryService(prisma, o.clock);
  const lifecycle = new SubscriptionLifecycleService(prisma, o.clock);
  const history = new TransactionHistoryService(prisma);
  const reconciliation = new ReconciliationService(prisma, activation, payments, o.clock);
  return { prisma, idempotency, payments, activation, expiry, lifecycle, history, reconciliation };
}
export type Services = ReturnType<typeof createServices>;

export function createServicesFromEnv(o: ServiceOptions = {}) {
  const env = loadEnv();
  return createServices(createPrismaClient(env.DATABASE_URL, { poolMax: env.DB_POOL_MAX }), { idempotencyTtlMs: env.IDEMPOTENCY_TTL_HOURS * 3600_000, ...o });
}
