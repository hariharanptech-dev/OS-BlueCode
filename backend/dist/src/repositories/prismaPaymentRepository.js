"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaPaymentRepository = void 0;
const client_1 = require("@prisma/client");
const paymentService_1 = require("../services/paymentService");
const subscriptionService_1 = require("../services/subscriptionService");
const isUnique = (e) => e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
class PrismaPaymentRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    listPlans() { return this.db.plan.findMany({ where: { isActive: true }, orderBy: { priceInPaise: 'asc' } }); }
    getPlan(id) { return this.db.plan.findUnique({ where: { id } }); }
    getUser(id) { return this.db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, phone: true } }); }
    findIdempotency(userId, key) {
        return this.db.idempotencyRecord.findUnique({ where: { userId_key: { userId, key } }, select: { requestHash: true, orderId: true } });
    }
    async createPaymentWithIdempotency(p, idem) {
        try {
            return await this.db.$transaction(async (tx) => {
                const row = await tx.payment.create({ data: p });
                await tx.idempotencyRecord.create({ data: { ...idem, orderId: row.orderId } });
                return row;
            });
        }
        catch (e) {
            if (isUnique(e))
                throw new paymentService_1.IdempotencyRace();
            throw e;
        }
    }
    findByOrderId(orderId) { return this.db.payment.findUnique({ where: { orderId } }); }
    findByTxnid(txnid) { return this.db.payment.findUnique({ where: { txnid } }); }
    listByUser(userId, take, skip) {
        return this.db.payment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take, skip });
    }
    async recordEvent(e) {
        try {
            await this.db.paymentEvent.create({ data: { ...e, payload: e.payload } });
            return true;
        }
        catch (err) {
            if (isUnique(err))
                return false;
            throw err;
        }
    }
    async transition(paymentId, from, to, extra) {
        const r = await this.db.payment.updateMany({ where: { id: paymentId, status: { in: from } },
            data: { status: to, ...(extra.payuMihpayid && { payuMihpayid: extra.payuMihpayid }),
                ...(extra.failureReason && { failureReason: extra.failureReason }), ...(extra.verified && { verifiedAt: new Date() }) } });
        return r.count === 1 ? (await this.db.payment.findUnique({ where: { id: paymentId } })) : null;
    }
    async succeedAndActivate(paymentId, from, mihpayid) {
        try {
            return await this.db.$transaction(async (tx) => {
                const r = await tx.payment.updateMany({ where: { id: paymentId, status: { in: from } },
                    data: { status: 'SUCCESS', verifiedAt: new Date(), ...(mihpayid && { payuMihpayid: mihpayid }) } });
                if (r.count !== 1)
                    return null; // someone else already settled it
                const payment = (await tx.payment.findUnique({ where: { id: paymentId } }));
                const plan = (await tx.plan.findUnique({ where: { id: payment.planId } }));
                const current = await tx.subscription.findFirst({ where: { userId: payment.userId, status: 'ACTIVE' }, orderBy: { expiresAt: 'desc' } });
                const { startsAt, expiresAt } = (0, subscriptionService_1.computeWindow)(new Date(), current?.expiresAt ?? null, plan.durationDays);
                // Subscription.paymentId is UNIQUE: a second activation for the same payment cannot commit.
                const subscription = await tx.subscription.create({ data: { userId: payment.userId, planId: plan.id, paymentId, startsAt, expiresAt } });
                return { payment: payment, subscription };
            });
        }
        catch (e) {
            if (isUnique(e))
                return null;
            throw e;
        }
    }
    async getActiveSubscription(userId) {
        const s = await this.db.subscription.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { expiresAt: 'desc' }, include: { plan: true } });
        return s ? { ...s, planName: s.plan.name } : null;
    }
}
exports.PrismaPaymentRepository = PrismaPaymentRepository;
