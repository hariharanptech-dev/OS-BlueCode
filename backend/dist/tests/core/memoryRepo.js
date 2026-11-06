"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryRepo = void 0;
const paymentService_1 = require("../../src/services/paymentService");
const subscriptionService_1 = require("../../src/services/subscriptionService");
const crypto_1 = require("crypto");
/** In-memory stand-in for Prisma. Mirrors the CAS + unique-constraint semantics the Prisma repo relies on. */
class MemoryRepo {
    plans = new Map();
    users = new Map();
    payments = new Map();
    subs = [];
    events = [];
    idem = new Map();
    async getPlan(id) { return this.plans.get(id) ?? null; }
    async getUser(id) { return this.users.get(id) ?? null; }
    async findIdempotency(u, k) { return this.idem.get(`${u}:${k}`) ?? null; }
    async createPaymentWithIdempotency(p, i) {
        if (this.idem.has(`${i.userId}:${i.key}`))
            throw new paymentService_1.IdempotencyRace();
        const row = { ...p, id: (0, crypto_1.randomUUID)(), createdAt: new Date(), verifiedAt: null, payuMihpayid: null, failureReason: null };
        this.payments.set(row.id, row);
        this.idem.set(`${i.userId}:${i.key}`, { requestHash: i.requestHash, orderId: row.orderId });
        return { ...row };
    }
    find(f) { const p = [...this.payments.values()].find(f); return p ? { ...p } : null; }
    async findByOrderId(o) { return this.find((p) => p.orderId === o); }
    async findByTxnid(t) { return this.find((p) => p.txnid === t); }
    async listByUser(u, l, o) { return [...this.payments.values()].filter((p) => p.userId === u).slice(o, o + l); }
    async recordEvent(e) {
        if (this.events.some((x) => x.txnid === e.txnid && x.payloadHash === e.payloadHash))
            return false;
        this.events.push(e);
        return true;
    }
    async transition(id, from, to, x) {
        const p = this.payments.get(id);
        if (!p || !from.includes(p.status))
            return null;
        p.status = to;
        if (x.payuMihpayid)
            p.payuMihpayid = x.payuMihpayid;
        if (x.failureReason)
            p.failureReason = x.failureReason;
        return { ...p };
    }
    async succeedAndActivate(id, from, mihpayid) {
        const p = this.payments.get(id);
        if (!p || !from.includes(p.status))
            return null;
        if (this.subs.some((s) => s.paymentId === id))
            return null;
        p.status = 'SUCCESS';
        p.verifiedAt = new Date();
        if (mihpayid)
            p.payuMihpayid = mihpayid;
        const plan = this.plans.get(p.planId);
        const cur = this.subs.filter((s) => s.userId === p.userId).sort((a, b) => +b.expiresAt - +a.expiresAt)[0];
        const w = (0, subscriptionService_1.computeWindow)(new Date(), cur?.expiresAt ?? null, plan.durationDays);
        const subscription = { id: (0, crypto_1.randomUUID)(), userId: p.userId, planId: plan.id, paymentId: id, status: 'ACTIVE', ...w };
        this.subs.push(subscription);
        return { payment: { ...p }, subscription };
    }
    async getActiveSubscription(u) { const s = this.subs.find((x) => x.userId === u); return s ? { ...s, planName: 'x' } : null; }
}
exports.MemoryRepo = MemoryRepo;
