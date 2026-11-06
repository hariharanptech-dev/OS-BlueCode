import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError, amountsEqual, requestHash, responseHash, safeEqual, callbackSchema, type Clock, type Logger } from '../security/index.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { PayUGateway, VerifyResult } from './gateway.ts';
import { addInterval, getPlan } from './plans.ts';
import type { Order, PaymentStatus, Subscription, SubscriptionView, User } from './types.ts';

// ---------------------------------------------------------------- state machine
export const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['success', 'failed', 'cancelled', 'expired'],
  // A later gateway-VERIFIED success may rescue a failed/cancelled/expired order: money taken => entitlement.
  failed: ['success'],
  cancelled: ['success'],
  expired: ['success'],
  success: [], // terminal and immutable
};
export const canTransition = (from: PaymentStatus, to: PaymentStatus): boolean => ALLOWED_TRANSITIONS[from].includes(to);

const OPEN_ORDER_WINDOW_MS = 30 * 60_000;
const RENEWAL_WINDOW_MS = 7 * 86_400_000;
const CLOSED_LOOKBACK_MS = 24 * 3_600_000;
const MAX_CLOSED_PER_RUN = 200;

export interface CheckoutResult {
  orderId: string;
  txnid: string;
  amount: string;
  currency: string;
  plan: { id: string; name: string };
  payu: { action: string; method: 'POST'; fields: Record<string, string> };
  reused: boolean;
}

export type CallbackKind = 'applied' | 'duplicate' | 'pending' | 'conflict' | 'unverified';
export interface CallbackOutcome {
  kind: CallbackKind;
  orderId: string;
  status: PaymentStatus;
  reason?: string;
}

export interface OrderView {
  id: string;
  reference: string;
  planId: string;
  planName: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  completedAt: string | null;
  renewal: boolean;
}

type Reported = 'success' | 'failed' | 'cancelled' | 'pending';
function mapStatus(s: string): Reported | null {
  switch (s.toLowerCase()) {
    case 'success': return 'success';
    case 'failure': case 'failed': return 'failed';
    case 'usercancelled': case 'cancelled': case 'cancel': return 'cancelled';
    case 'pending': return 'pending';
    default: return null;
  }
}

interface Deps { db: Db; gateway: PayUGateway; clock: Clock; config: Config; logger: Logger }

export class PaymentService {
  private readonly d: Deps;
  constructor(deps: Deps) {
    this.d = deps;
  }

  private has(defect: Parameters<Set<string>['has']>[0]): boolean {
    return this.d.config.defects.has(defect as never);
  }

  // ------------------------------------------------------------ checkout
  async checkout(user: User, input: { planId: string; customer: { firstname: string; email: string; phone: string } }, idemKey: string | null, clientAmountForDefect?: string): Promise<CheckoutResult> {
    const plan = getPlan(input.planId);
    if (!plan) throw new AppError('PLAN_INVALID');
    const now = this.d.clock.now();
    const { db } = this.d;

    const { order, reused } = await db.transaction(() => {
      if (idemKey) {
        const ex = db.findByIdempotencyKey(user.id, idemKey);
        if (ex) {
          if (ex.planId !== plan.id) throw new AppError('VALIDATION_FAILED', { fieldErrors: [{ path: 'Idempotency-Key', reason: 'reused with a different plan' }] });
          if (ex.status !== 'pending') throw new AppError('IDEMPOTENCY_KEY_USED'); // DEF-004: never re-issue a PayU form for a closed order
          return { order: ex, reused: true };
        }
      }
      if (!this.has('no-idempotency')) {
        const open = db.findOpenOrder(user.id, plan.id, new Date(now.getTime() - OPEN_ORDER_WINDOW_MS));
        if (open) return { order: open, reused: true };
      }
      const live = db.subscriptionsFor(user.id).filter((s) => new Date(s.expiresAt) > now);
      let renewal = false;
      if (live.length) {
        const latest = live.reduce((a, b) => (new Date(a.expiresAt) > new Date(b.expiresAt) ? a : b));
        const within = new Date(latest.expiresAt).getTime() - now.getTime() <= RENEWAL_WINDOW_MS;
        if (latest.planId === plan.id && within && live.every((s) => new Date(s.startsAt) <= now)) renewal = true;
        else throw new AppError('SUBSCRIPTION_ACTIVE');
      }
      const amount = this.has('trust-client-amount') && clientAmountForDefect ? clientAmountForDefect : plan.amount;
      const o: Order = {
        id: randomUUID(), userId: user.id, planId: plan.id,
        txnid: 'BC' + randomBytes(10).toString('hex'),
        amount, currency: plan.currency, status: 'pending', idempotencyKey: idemKey,
        customer: { ...input.customer }, mihpayid: null, needsReview: false, renewal,
        createdAt: now.toISOString(), updatedAt: now.toISOString(), completedAt: null,
      };
      return { order: db.insertOrder(o), reused: false };
    });

    const fields = this.buildForm(order, plan.name);
    this.d.logger.info('payment.checkout', { orderId: order.id, txnid: order.txnid, planId: plan.id, reused });
    return { orderId: order.id, txnid: order.txnid, amount: order.amount, currency: order.currency, plan: { id: plan.id, name: plan.name }, payu: { action: this.d.config.payuBaseUrl, method: 'POST', fields }, reused };
  }

  private buildForm(order: Order, productinfo: string): Record<string, string> {
    const cb = `${this.d.config.appBaseUrl}/api/payments/payu/callback`;
    const base = {
      key: this.d.config.payuKey, txnid: order.txnid, amount: order.amount, productinfo,
      firstname: order.customer.firstname, email: order.customer.email, udf1: order.planId, udf2: '', udf3: '', udf4: '', udf5: '',
    };
    return { ...base, phone: order.customer.phone, surl: cb, furl: cb, curl: cb, hash: requestHash(base, this.d.config.payuSalt) };
  }

  // ------------------------------------------------------------ callbacks
  async handleCallback(raw: Record<string, unknown>, source: 'redirect' | 'webhook'): Promise<CallbackOutcome> {
    const parsed = callbackSchema.safeParse(raw);
    if (!parsed.success) {
      this.d.logger.security('callback.malformed', { source });
      throw new AppError('INVALID_CALLBACK', { internal: { reason: 'schema' } });
    }
    const cb = parsed.data;

    if (!this.has('skip-hash-verify')) {
      const expected = responseHash(
        { key: cb.key, txnid: cb.txnid, amount: cb.amount, productinfo: cb.productinfo, firstname: cb.firstname, email: cb.email, udf1: cb.udf1, udf2: cb.udf2, udf3: cb.udf3, udf4: cb.udf4, udf5: cb.udf5, status: cb.status, additionalCharges: cb.additionalCharges },
        this.d.config.payuSalt,
      );
      if (!safeEqual(cb.hash.toLowerCase(), expected)) {
        this.d.logger.security('callback.invalid_hash', { txnid: cb.txnid, source });
        throw new AppError('INVALID_CALLBACK', { internal: { reason: 'hash' } });
      }
    }

    const order = this.d.db.getOrderByTxnid(cb.txnid);
    if (!order) {
      this.d.logger.security('callback.unknown_txn', { txnid: cb.txnid, source });
      throw new AppError('INVALID_CALLBACK', { internal: { reason: 'unknown_txn' } });
    }

    const mismatches: string[] = [];
    if (!this.has('no-key-check') && cb.key !== this.d.config.payuKey) mismatches.push('key');
    if (!this.has('no-amount-check') && !amountsEqual(cb.amount, order.amount)) mismatches.push('amount');
    if ((cb.udf1 ?? '') !== order.planId) mismatches.push('udf1');
    if (cb.currency !== undefined && cb.currency !== order.currency) mismatches.push('currency');
    if (mismatches.length) {
      this.d.logger.security('callback.mismatch', { txnid: cb.txnid, orderId: order.id, mismatches, source });
      throw new AppError('INVALID_CALLBACK', { internal: { reason: 'mismatch', mismatches } });
    }

    const reported = mapStatus(cb.status);
    if (!reported) throw new AppError('INVALID_CALLBACK', { internal: { reason: 'status' } });
    return this.apply(order, reported, { source, rawStatus: cb.status, mihpayid: cb.mihpayid ?? null, preVerified: null });
  }

  // ------------------------------------------------------------ core transition logic
  private async apply(order: Order, reported: Reported, ctx: { source: 'redirect' | 'webhook' | 'refresh' | 'reconcile'; rawStatus: string; mihpayid: string | null; preVerified: VerifyResult | null }): Promise<CallbackOutcome> {
    const { db, logger } = this.d;
    const digest = createHash('sha256').update(`${order.txnid}|${reported}|${ctx.mihpayid ?? ''}|${order.amount}`).digest('hex');
    const record = (o: Order, outcome: string): void =>
      db.insertEvent({ orderId: o.id, txnid: o.txnid, source: ctx.source, reportedStatus: ctx.rawStatus, outcome, digest, receivedAt: this.d.clock.now().toISOString() });
    const out = (kind: CallbackKind, o: Order, reason?: string): CallbackOutcome => ({ kind, orderId: o.id, status: o.status, ...(reason ? { reason } : {}) });

    // Cheap pre-check: avoid gateway calls for already-settled orders.
    if (order.status === 'success' && !this.has('no-idempotency')) {
      return db.transaction(() => {
        const fresh = db.getOrder(order.id)!;
        if (reported === 'success') { record(fresh, 'duplicate'); return out('duplicate', fresh); }
        record(fresh, 'conflict_ignored');
        logger.security('callback.conflict', { txnid: fresh.txnid, reported });
        return out('conflict', fresh);
      });
    }

    if (reported === 'pending') {
      return db.transaction(() => { record(order, 'pending'); return out('pending', order); });
    }

    let verified: VerifyResult | null = null;
    if (reported === 'success' && !this.has('no-gateway-verify')) {
      try {
        verified = ctx.preVerified ?? (await this.d.gateway.verifyPayment(order.txnid));
      } catch (e) {
        logger.warn('payment.verify_unavailable', { txnid: order.txnid, source: ctx.source, err: e });
        await db.transaction(() => record(order, 'verify_unavailable')).catch(() => undefined);
        return out('unverified', order, 'gateway_unavailable');
      }
      const amountOk = amountsEqual(verified.amount, order.amount);
      const currencyOk = verified.currency === undefined || verified.currency === order.currency;
      const refOk = verified.mihpayid === null || ctx.mihpayid === null || verified.mihpayid === ctx.mihpayid;
      if (!(verified.found && verified.status === 'success' && amountOk && currencyOk && refOk)) {
        const disagree = verified.found && (verified.status === 'failure' || verified.status === 'userCancelled' || !amountOk || !currencyOk || !refOk);
        logger.security('payment.verification_rejected', { txnid: order.txnid, found: verified.found, gwStatus: verified.status, amountOk, currencyOk, refOk });
        return db.transaction(() => {
          const fresh = db.getOrder(order.id)!;
          if (disagree && fresh.status !== 'success') { fresh.needsReview = true; fresh.updatedAt = this.d.clock.now().toISOString(); db.updateOrder(fresh); }
          record(fresh, disagree ? 'verification_disagrees' : 'verification_not_confirmed');
          return out('unverified', fresh, disagree ? 'gateway_disagrees' : 'not_confirmed');
        });
      }
    }

    return db.transaction(() => {
      const fresh = db.getOrder(order.id)!;
      const now = this.d.clock.now().toISOString();
      const target: PaymentStatus = reported === 'success' ? 'success' : reported;

      const noIdem = this.has('no-idempotency');
      if (!noIdem && fresh.status === target) { record(fresh, 'duplicate'); return out('duplicate', fresh); }
      if (!noIdem && !this.has('no-state-guard') && !canTransition(fresh.status, target)) {
        record(fresh, 'conflict_ignored');
        logger.security('callback.conflict', { txnid: fresh.txnid, from: fresh.status, to: target });
        return out('conflict', fresh);
      }
      const prev = fresh.status;
      fresh.status = target;
      fresh.updatedAt = now;
      if (target === 'success' || target === 'failed' || target === 'cancelled') fresh.completedAt = now;
      if (ctx.mihpayid) fresh.mihpayid = ctx.mihpayid;
      db.updateOrder(fresh);
      if (target === 'success' || (this.has('cancel-activates') && target === 'cancelled')) this.activate(fresh, this.d.clock.now());
      record(fresh, prev === 'pending' ? 'applied' : 'late_success');
      logger.info('payment.applied', { orderId: fresh.id, txnid: fresh.txnid, from: prev, to: target, source: ctx.source });
      return out('applied', fresh);
    });
  }

  /** Must run inside a db transaction together with the order update. Idempotent per payment. */
  private activate(order: Order, now: Date): Subscription {
    const { db } = this.d;
    const existing = this.has('no-idempotency') ? undefined : db.subscriptionByPayment(order.id);
    if (existing) return existing;
    const plan = getPlan(order.planId)!;
    let start = now;
    for (const s of db.subscriptionsFor(order.userId)) if (new Date(s.expiresAt) > start) start = new Date(s.expiresAt);
    return db.insertSubscription({
      userId: order.userId, planId: order.planId, paymentId: order.id,
      startsAt: start.toISOString(), expiresAt: addInterval(start, plan.interval, plan.count).toISOString(), createdAt: now.toISOString(),
    });
  }

  // ------------------------------------------------------------ reads / refresh / reconcile
  view(o: Order): OrderView {
    return { id: o.id, reference: o.txnid, planId: o.planId, planName: getPlan(o.planId)?.name ?? o.planId, amount: o.amount, currency: o.currency, status: o.status, createdAt: o.createdAt, completedAt: o.completedAt, renewal: o.renewal };
  }

  getForUser(userId: string, orderId: string): Order {
    const o = this.d.db.getOrder(orderId);
    if (!o || (o.userId !== userId && !this.has('idor-payments'))) throw new AppError('NOT_FOUND');
    return o;
  }

  async refresh(userId: string, orderId: string): Promise<{ order: OrderView; gatewayReachable: boolean }> {
    const o = this.getForUser(userId, orderId);
    if (o.status === 'success') return { order: this.view(o), gatewayReachable: true };
    const r = await this.reconcileOne(o, 'refresh'); // also re-checks failed/cancelled/expired: money may have moved after a lost callback
    return { order: this.view(this.d.db.getOrder(o.id)!), gatewayReachable: r };
  }

  /** Returns false when the gateway could not be reached. */
  private async reconcileOne(o: Order, source: 'refresh' | 'reconcile'): Promise<boolean> {
    let v: VerifyResult;
    try {
      v = await this.d.gateway.verifyPayment(o.txnid);
    } catch (e) {
      this.d.logger.warn('payment.reconcile_gateway_unavailable', { txnid: o.txnid, err: e });
      return false;
    }
    if (v.found && v.status === 'success') await this.apply(o, 'success', { source, rawStatus: 'success', mihpayid: v.mihpayid, preVerified: v });
    else if (o.status !== 'pending') return true; // closed orders are only ever re-opened by a verified success
    else if (v.found && v.status === 'failure') await this.apply(o, 'failed', { source, rawStatus: 'failure', mihpayid: v.mihpayid, preVerified: null });
    else if (v.found && v.status === 'userCancelled') await this.apply(o, 'cancelled', { source, rawStatus: 'userCancelled', mihpayid: v.mihpayid, preVerified: null });
    else if (this.d.clock.now().getTime() - new Date(o.createdAt).getTime() > OPEN_ORDER_WINDOW_MS) {
      await this.d.db.transaction(() => {
        const f = this.d.db.getOrder(o.id)!;
        if (f.status === 'pending') { f.status = 'expired'; f.updatedAt = this.d.clock.now().toISOString(); this.d.db.updateOrder(f); }
      });
    }
    return true;
  }

  /** Background job: settle orders whose callback never arrived. */
  async reconcilePending(minAgeMs = 2 * 60_000): Promise<{ checked: number }> {
    const now = this.d.clock.now().getTime();
    const pending = this.d.db.listPendingOlderThan(new Date(now - minAgeMs));
    // DEF-003: a customer can retry inside PayU after a failure callback; the later success callback may be lost.
    const closed = this.d.db.listClosedUnpaidSince(new Date(now - CLOSED_LOOKBACK_MS), MAX_CLOSED_PER_RUN);
    const rows = [...pending, ...closed];
    for (const o of rows) await this.reconcileOne(o, 'reconcile');
    return { checked: rows.length };
  }

  list(userId: string, page: number, pageSize: number): { items: OrderView[]; page: number; pageSize: number; total: number } {
    const { rows, total } = this.d.db.listOrdersByUser(userId, (page - 1) * pageSize, pageSize);
    return { items: rows.map((r) => this.view(r)), page, pageSize, total };
  }
}

export class SubscriptionService {
  private readonly d: Pick<Deps, 'db' | 'clock'>;
  constructor(deps: Pick<Deps, 'db' | 'clock'>) {
    this.d = deps;
  }
  overview(userId: string): { current: SubscriptionView | null; upcoming: SubscriptionView[]; history: SubscriptionView[] } {
    const now = this.d.clock.now().getTime();
    const history: SubscriptionView[] = this.d.db.subscriptionsFor(userId).map((s) => ({
      ...s,
      status: new Date(s.expiresAt).getTime() <= now ? 'expired' : new Date(s.startsAt).getTime() > now ? 'scheduled' : 'active',
    }));
    return { current: history.find((h) => h.status === 'active') ?? null, upcoming: history.filter((h) => h.status === 'scheduled'), history };
  }
}
