import type { DbClient, PrismaClient } from '../db/client';
import { runInTransaction } from '../db/transaction';
import { createRepositories } from '../repositories';
import { systemClock, type Clock } from '../shared/time';

export interface SweepResult { expired: number; promoted: number }

/**
 * Expire live subscriptions whose window ended, then promote queued PENDING ones whose window began.
 * Order matters (expire first) so the one-ACTIVE-per-user index is never violated. Usable inside any transaction.
 */
export async function expireAndPromote(db: DbClient, now: Date, opts: { userId?: string; actor?: string } = {}): Promise<SweepResult> {
  const repos = createRepositories(db);
  const actor = opts.actor ?? 'EXPIRY_JOB';
  const expired = await repos.subscriptions.expireDue(now, opts.userId);
  if (expired.length) {
    await db.subscriptionEvent.createMany({
      data: expired.map((r) => ({ subscriptionId: r.id, fromStatus: r.from_status, toStatus: 'EXPIRED' as const, reason: 'END_DATE_REACHED', actor, createdAt: now })),
    });
  }
  const promoted = await repos.subscriptions.promoteDue(now, opts.userId);
  if (promoted.length) {
    await db.subscriptionEvent.createMany({
      data: promoted.map((r) => ({ subscriptionId: r.id, fromStatus: 'PENDING' as const, toStatus: 'ACTIVE' as const, reason: 'START_DATE_REACHED', actor, createdAt: now })),
    });
  }
  return { expired: expired.length, promoted: promoted.length };
}

export class SubscriptionExpiryService {
  constructor(private readonly prisma: PrismaClient, private readonly clock: Clock = systemClock) {}

  /** Idempotent and safe to run from several workers at once (SKIP LOCKED). Schedule it (e.g. every minute). */
  run(): Promise<SweepResult> {
    return runInTransaction(this.prisma, (tx) => expireAndPromote(tx, this.clock()));
  }

  /**
   * The authoritative "does this user have access right now" check. Uses dates, not only the status column,
   * so a delayed sweep can never extend access.
   */
  async getCurrentEntitlement(userId: string, at: Date = this.clock()) {
    const sub = await createRepositories(this.prisma).subscriptions.findCurrentActive(userId, at);
    return sub ? { active: true as const, subscription: sub } : { active: false as const, subscription: null };
  }
}
