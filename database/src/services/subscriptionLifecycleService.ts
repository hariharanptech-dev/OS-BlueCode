import type { PrismaClient } from '../db/client';
import type { Subscription, SubscriptionStatus } from '../generated/prisma/client';
import { assertSubscriptionTransition } from '../domain/stateMachines';
import { runInTransaction } from '../db/transaction';
import { createRepositories } from '../repositories';
import { InvalidTransitionError, NotFoundError } from '../shared/errors';
import { systemClock, type Clock } from '../shared/time';

/**
 * Administrative lifecycle changes (suspend / resume / cancel). Cancel and suspend do not refund anything and do
 * not move dates: no refund or proration policy is implied. Lock order: user -> subscription.
 */
export class SubscriptionLifecycleService {
  constructor(private readonly prisma: PrismaClient, private readonly clock: Clock = systemClock) {}

  suspend(subscriptionId: string, reason: string, actor = 'SYSTEM') {
    return this.change(subscriptionId, 'SUSPENDED', reason, actor);
  }
  cancel(subscriptionId: string, reason: string, actor = 'SYSTEM') {
    return this.change(subscriptionId, 'CANCELLED', reason, actor);
  }
  /** Resume returns to ACTIVE only if the window is still open; otherwise the subscription is EXPIRED. */
  resume(subscriptionId: string, reason: string, actor = 'SYSTEM') {
    return this.change(subscriptionId, 'ACTIVE', reason, actor);
  }

  private change(subscriptionId: string, target: 'SUSPENDED' | 'CANCELLED' | 'ACTIVE', reason: string, actor: string): Promise<Subscription> {
    return runInTransaction(this.prisma, async (tx) => {
      const repos = createRepositories(tx);
      const peek = await repos.subscriptions.findById(subscriptionId);
      if (!peek) throw new NotFoundError('Subscription', subscriptionId);
      await repos.users.lock(peek.userId);
      const sub = (await repos.subscriptions.lockById(subscriptionId))!;
      const now = this.clock();

      let to: SubscriptionStatus = target;
      if (target === 'ACTIVE') {
        assertSubscriptionTransition(sub.status, 'ACTIVE');
        if (sub.endDate <= now) to = 'EXPIRED'; // window already over: resume is meaningless
      } else {
        assertSubscriptionTransition(sub.status, target);
      }
      const data =
        to === 'SUSPENDED' ? { suspendedAt: now, statusReason: reason }
        : to === 'CANCELLED' ? { cancelledAt: now, statusReason: reason }
        : to === 'ACTIVE' ? { activatedAt: sub.activatedAt ?? now, suspendedAt: null, statusReason: reason }
        : { statusReason: 'END_DATE_REACHED' };
      const ok = await repos.subscriptions.transition(sub.id, [sub.status], to, data);
      if (!ok) throw new InvalidTransitionError('Subscription', sub.status, to);
      await repos.subscriptions.addEvent({ subscriptionId: sub.id, fromStatus: sub.status, toStatus: to, reason, actor, at: now });
      return repos.subscriptions.findById(sub.id) as Promise<Subscription>;
    });
  }
}
