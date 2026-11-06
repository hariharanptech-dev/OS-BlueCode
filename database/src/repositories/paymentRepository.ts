import type { DbClient } from '../db/client';
import { Prisma, PaymentStatus } from '../generated/prisma/client';
import { DuplicateOrderError, NotFoundError, uniqueViolationTarget } from '../shared/errors';

export interface NewPayment {
  userId: string; planId: string; orderId: string; transactionId: string;
  amountMinor: number; currency: string; planDurationDays: number; idempotencyKey: string; initiatedAt?: Date;
}

export function paymentRepository(db: DbClient) {
  return {
    /** INSERT-only. An existing payment is never overwritten; duplicates surface as DuplicateOrderError. */
    async create(p: NewPayment) {
      try {
        return await db.payment.create({ data: { ...p, provider: 'PAYU', status: 'CREATED' } });
      } catch (e) {
        const t = uniqueViolationTarget(e);
        if (t) {
          const field = t.includes('order_id') ? 'orderId' : t.includes('idempotency') ? 'idempotencyKey' : 'transactionId';
          throw new DuplicateOrderError(field);
        }
        throw e;
      }
    },
    findById: (id: string) => db.payment.findUnique({ where: { id } }),
    findByIdOrThrow: (id: string) => db.payment.findUniqueOrThrow({ where: { id } }),
    findByOrderId: (orderId: string) => db.payment.findUnique({ where: { orderId } }),
    findByUserAndKey: (userId: string, idempotencyKey: string) =>
      db.payment.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } }),
    findByProviderTransactionId: (providerTransactionId: string) =>
      db.payment.findFirst({ where: { provider: 'PAYU', providerTransactionId } }),
    async getByOrderIdOrThrow(orderId: string) {
      const p = await db.payment.findUnique({ where: { orderId } });
      if (!p) throw new NotFoundError('Payment', orderId);
      return p;
    },
    /** SELECT ... FOR UPDATE on the payment row; returns the fresh row. Lock order: payment -> user -> subscriptions. */
    async lockById(id: string) {
      const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('Payment', id);
      return db.payment.findUniqueOrThrow({ where: { id } });
    },
    /**
     * Compare-and-set status change. Returns true only if the row was still in one of `from`.
     * The caller must already hold the row lock; the DB trigger additionally rejects illegal transitions.
     */
    async transition(id: string, from: PaymentStatus[], to: PaymentStatus, extra: Prisma.PaymentUpdateManyMutationInput = {}) {
      const r = await db.payment.updateMany({ where: { id, status: { in: from } }, data: { ...extra, status: to } });
      return r.count === 1;
    },
    setProviderTransactionId: (id: string, providerTransactionId: string) =>
      db.payment.update({ where: { id }, data: { providerTransactionId } }),
    async listByUser(userId: string, opts: { limit: number; status?: PaymentStatus; before?: { createdAt: Date; id: string } }) {
      const where: Prisma.PaymentWhereInput = { userId };
      if (opts.status) where.status = opts.status;
      if (opts.before) {
        where.OR = [
          { createdAt: { lt: opts.before.createdAt } },
          { createdAt: opts.before.createdAt, id: { lt: opts.before.id } },
        ];
      }
      return db.payment.findMany({
        where, include: { plan: { select: { code: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: opts.limit,
      });
    },
    findStale: (olderThan: Date, limit = 100) =>
      db.payment.findMany({ where: { status: { in: ['CREATED', 'PENDING'] }, initiatedAt: { lt: olderThan } }, orderBy: { initiatedAt: 'asc' }, take: limit }),
  };
}
