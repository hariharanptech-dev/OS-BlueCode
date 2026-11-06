import { Prisma, PrismaClient } from '@prisma/client';
import { EventInput, PaymentRepository, PaymentRow, PaymentStatus } from '../types';
import { IdempotencyRace } from '../services/paymentService';
import { computeWindow } from '../services/subscriptionService';

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private db: PrismaClient) {}

  listPlans() { return this.db.plan.findMany({ where: { isActive: true }, orderBy: { priceInPaise: 'asc' } }); }
  getPlan(id: string) { return this.db.plan.findUnique({ where: { id } }); }
  getUser(id: string) { return this.db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, phone: true } }); }
  findIdempotency(userId: string, key: string) {
    return this.db.idempotencyRecord.findUnique({ where: { userId_key: { userId, key } }, select: { requestHash: true, orderId: true } });
  }

  async createPaymentWithIdempotency(p: any, idem: { userId: string; key: string; requestHash: string }): Promise<PaymentRow> {
    try {
      return await this.db.$transaction(async (tx) => {
        const row = await tx.payment.create({ data: p });
        await tx.idempotencyRecord.create({ data: { ...idem, orderId: row.orderId } });
        return row as PaymentRow;
      });
    } catch (e) { if (isUnique(e)) throw new IdempotencyRace(); throw e; }
  }

  findByOrderId(orderId: string) { return this.db.payment.findUnique({ where: { orderId } }) as Promise<PaymentRow | null>; }
  findByTxnid(txnid: string) { return this.db.payment.findUnique({ where: { txnid } }) as Promise<PaymentRow | null>; }
  listByUser(userId: string, take: number, skip: number) {
    return this.db.payment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take, skip }) as Promise<PaymentRow[]>;
  }

  async recordEvent(e: EventInput): Promise<boolean> {
    try { await this.db.paymentEvent.create({ data: { ...e, payload: e.payload as Prisma.InputJsonValue } }); return true; }
    catch (err) { if (isUnique(err)) return false; throw err; }
  }

  async transition(paymentId: string, from: PaymentStatus[], to: PaymentStatus,
    extra: { payuMihpayid?: string; failureReason?: string; verified?: boolean }) {
    const r = await this.db.payment.updateMany({ where: { id: paymentId, status: { in: from } },
      data: { status: to, ...(extra.payuMihpayid && { payuMihpayid: extra.payuMihpayid }),
              ...(extra.failureReason && { failureReason: extra.failureReason }), ...(extra.verified && { verifiedAt: new Date() }) } });
    return r.count === 1 ? ((await this.db.payment.findUnique({ where: { id: paymentId } })) as PaymentRow) : null;
  }

  async succeedAndActivate(paymentId: string, from: PaymentStatus[], mihpayid?: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        const r = await tx.payment.updateMany({ where: { id: paymentId, status: { in: from } },
          data: { status: 'SUCCESS', verifiedAt: new Date(), ...(mihpayid && { payuMihpayid: mihpayid }) } });
        if (r.count !== 1) return null; // someone else already settled it
        const payment = (await tx.payment.findUnique({ where: { id: paymentId } }))!;
        const plan = (await tx.plan.findUnique({ where: { id: payment.planId } }))!;
        const current = await tx.subscription.findFirst({ where: { userId: payment.userId, status: 'ACTIVE' }, orderBy: { expiresAt: 'desc' } });
        const { startsAt, expiresAt } = computeWindow(new Date(), current?.expiresAt ?? null, plan.durationDays);
        // Subscription.paymentId is UNIQUE: a second activation for the same payment cannot commit.
        const subscription = await tx.subscription.create({ data: { userId: payment.userId, planId: plan.id, paymentId, startsAt, expiresAt } });
        return { payment: payment as PaymentRow, subscription };
      });
    } catch (e) { if (isUnique(e)) return null; throw e; }
  }

  async getActiveSubscription(userId: string) {
    const s = await this.db.subscription.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { expiresAt: 'desc' }, include: { plan: true } });
    return s ? { ...s, planName: s.plan.name } : null;
  }
}
