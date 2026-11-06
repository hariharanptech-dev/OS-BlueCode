import type { DbClient } from '../db/client';
import { Prisma, SubscriptionStatus } from '../generated/prisma/client';
import { LIVE_SUBSCRIPTION_STATUSES } from '../domain/stateMachines';

export interface DueRow { id: string; from_status: SubscriptionStatus }

export function subscriptionRepository(db: DbClient) {
  return {
    create: (data: Prisma.SubscriptionUncheckedCreateInput) => db.subscription.create({ data }),
    findById: (id: string) => db.subscription.findUnique({ where: { id } }),
    findByPaymentId: (paymentId: string) => db.subscription.findUnique({ where: { paymentId } }),
    /** SELECT ... FOR UPDATE on a subscription row. */
    async lockById(id: string) {
      await db.$queryRaw`SELECT id FROM subscriptions WHERE id = ${id}::uuid FOR UPDATE`;
      return db.subscription.findUnique({ where: { id } });
    },
    listByUser: (userId: string) =>
      db.subscription.findMany({ where: { userId }, include: { plan: { select: { code: true, name: true } } }, orderBy: [{ startDate: 'desc' }, { id: 'desc' }] }),
    /** Entitlement is computed from DATES + status, so a late expiry job can never extend access. */
    findCurrentActive: (userId: string, now: Date) =>
      db.subscription.findFirst({ where: { userId, status: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now } } }),
    async maxLiveEndDate(userId: string): Promise<Date | null> {
      const r = await db.subscription.aggregate({ where: { userId, status: { in: LIVE_SUBSCRIPTION_STATUSES } }, _max: { endDate: true } });
      return r._max.endDate;
    },
    async transition(id: string, from: SubscriptionStatus[], to: SubscriptionStatus, data: Prisma.SubscriptionUpdateManyMutationInput = {}) {
      const r = await db.subscription.updateMany({ where: { id, status: { in: from } }, data: { ...data, status: to } });
      return r.count === 1;
    },
    addEvent: (e: { subscriptionId: string; fromStatus: SubscriptionStatus | null; toStatus: SubscriptionStatus; reason?: string; actor: string; at?: Date }) =>
      db.subscriptionEvent.create({ data: { subscriptionId: e.subscriptionId, fromStatus: e.fromStatus, toStatus: e.toStatus, reason: e.reason ?? null, actor: e.actor, createdAt: e.at ?? new Date() } }),
    listEvents: (subscriptionId: string) => db.subscriptionEvent.findMany({ where: { subscriptionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),

    /** Live subscriptions whose window has ended -> EXPIRED. Optional per-user scope. SKIP LOCKED keeps sweeps non-blocking. */
    async expireDue(now: Date, userId?: string): Promise<DueRow[]> {
      const scope = userId ? Prisma.sql`AND user_id = ${userId}::uuid` : Prisma.empty;
      return db.$queryRaw<DueRow[]>`
        WITH due AS (
          SELECT id, status FROM subscriptions
          WHERE status IN ('ACTIVE','PENDING','SUSPENDED') AND end_date <= ${now}::timestamptz ${scope}
          FOR UPDATE SKIP LOCKED)
        UPDATE subscriptions s SET status = 'EXPIRED', updated_at = ${now}::timestamptz
        FROM due WHERE s.id = due.id
        RETURNING s.id, due.status AS from_status`;
    },
    /** PENDING whose window has started (and not ended) -> ACTIVE. Run AFTER expireDue. */
    async promoteDue(now: Date, userId?: string): Promise<{ id: string }[]> {
      const scope = userId ? Prisma.sql`AND user_id = ${userId}::uuid` : Prisma.empty;
      return db.$queryRaw<{ id: string }[]>`
        WITH due AS (
          SELECT id FROM subscriptions
          WHERE status = 'PENDING' AND start_date <= ${now}::timestamptz AND end_date > ${now}::timestamptz ${scope}
          FOR UPDATE SKIP LOCKED)
        UPDATE subscriptions s SET status = 'ACTIVE', activated_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        FROM due WHERE s.id = due.id RETURNING s.id`;
    },
  };
}
