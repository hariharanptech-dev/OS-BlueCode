import { EventInput, PaymentRepository, PaymentRow, PaymentStatus, PlanRow, SubscriptionRow, UserRow } from '../../src/types';
import { IdempotencyRace } from '../../src/services/paymentService';
import { computeWindow } from '../../src/services/subscriptionService';
import { randomUUID } from 'crypto';

/** In-memory stand-in for Prisma. Mirrors the CAS + unique-constraint semantics the Prisma repo relies on. */
export class MemoryRepo implements PaymentRepository {
  plans = new Map<string, PlanRow>(); users = new Map<string, UserRow>();
  payments = new Map<string, PaymentRow>(); subs: SubscriptionRow[] = [];
  events: EventInput[] = []; idem = new Map<string, { requestHash: string; orderId: string | null }>();
  async getPlan(id: string) { return this.plans.get(id) ?? null; }
  async getUser(id: string) { return this.users.get(id) ?? null; }
  async findIdempotency(u: string, k: string) { return this.idem.get(`${u}:${k}`) ?? null; }
  async createPaymentWithIdempotency(p: any, i: { userId: string; key: string; requestHash: string }) {
    if (this.idem.has(`${i.userId}:${i.key}`)) throw new IdempotencyRace();
    const row: PaymentRow = { ...p, id: randomUUID(), createdAt: new Date(), verifiedAt: null, payuMihpayid: null, failureReason: null };
    this.payments.set(row.id, row); this.idem.set(`${i.userId}:${i.key}`, { requestHash: i.requestHash, orderId: row.orderId });
    return { ...row };
  }
  private find(f: (p: PaymentRow) => boolean) { const p = [...this.payments.values()].find(f); return p ? { ...p } : null; }
  async findByOrderId(o: string) { return this.find((p) => p.orderId === o); }
  async findByTxnid(t: string) { return this.find((p) => p.txnid === t); }
  async listByUser(u: string, l: number, o: number) { return [...this.payments.values()].filter((p) => p.userId === u).slice(o, o + l); }
  async recordEvent(e: EventInput) {
    if (this.events.some((x) => x.txnid === e.txnid && x.payloadHash === e.payloadHash)) return false;
    this.events.push(e); return true;
  }
  async transition(id: string, from: PaymentStatus[], to: PaymentStatus, x: { payuMihpayid?: string; failureReason?: string }) {
    const p = this.payments.get(id); if (!p || !from.includes(p.status)) return null;
    p.status = to; if (x.payuMihpayid) p.payuMihpayid = x.payuMihpayid; if (x.failureReason) p.failureReason = x.failureReason;
    return { ...p };
  }
  async succeedAndActivate(id: string, from: PaymentStatus[], mihpayid?: string) {
    const p = this.payments.get(id); if (!p || !from.includes(p.status)) return null;
    if (this.subs.some((s) => s.paymentId === id)) return null;
    p.status = 'SUCCESS'; p.verifiedAt = new Date(); if (mihpayid) p.payuMihpayid = mihpayid;
    const plan = this.plans.get(p.planId)!;
    const cur = this.subs.filter((s) => s.userId === p.userId).sort((a, b) => +b.expiresAt - +a.expiresAt)[0];
    const w = computeWindow(new Date(), cur?.expiresAt ?? null, plan.durationDays);
    const subscription: SubscriptionRow = { id: randomUUID(), userId: p.userId, planId: plan.id, paymentId: id, status: 'ACTIVE', ...w };
    this.subs.push(subscription); return { payment: { ...p }, subscription };
  }
  async getActiveSubscription(u: string) { const s = this.subs.find((x) => x.userId === u); return s ? { ...s, planName: 'x' } : null; }
}
