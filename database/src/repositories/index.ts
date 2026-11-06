import type { DbClient } from '../db/client';
import { idempotencyRepository } from './idempotencyRepository';
import { paymentEventRepository } from './paymentEventRepository';
import { paymentRepository } from './paymentRepository';
import { planRepository } from './planRepository';
import { subscriptionRepository } from './subscriptionRepository';
import { userRepository } from './userRepository';

export * from './idempotencyRepository';
export * from './paymentEventRepository';
export * from './paymentRepository';
export * from './planRepository';
export * from './subscriptionRepository';
export * from './userRepository';

/** Bind every repository to one client; pass a transaction client to make them transactional. */
export function createRepositories(db: DbClient) {
  return {
    users: userRepository(db), plans: planRepository(db), payments: paymentRepository(db),
    subscriptions: subscriptionRepository(db), paymentEvents: paymentEventRepository(db), idempotency: idempotencyRepository(db),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
