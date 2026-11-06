import { PayuGateway } from '../integrations/payu/client';
import { PayuConfig } from '../integrations/payu/client';
import { buildPaymentForm } from '../integrations/payu/paymentForm';
import { responseHash, safeEqualHex } from '../integrations/payu/hash';
import { PaymentRepository, PaymentRow, PaymentStatus } from '../types';
import { allowedFrom, isTerminal } from './paymentStateMachine';
import { paiseToRupees, rupeesToPaise } from '../utils/money';
import { newOrderId, newTxnid, stableHash } from '../utils/ids';
import { AppError, badRequest, conflict, notFound } from '../utils/errors';
import { logger } from '../utils/logger';

export class IdempotencyRace extends Error {}

export interface CallbackResult {
  outcome: 'processed' | 'duplicate' | 'rejected' | 'conflict';
  orderId?: string; status?: PaymentStatus; reason?: string;
}

const EXPIRE_AFTER_MS = 30 * 60_000;

export class PaymentService {
  constructor(private repo: PaymentRepository, private gateway: PayuGateway,
              private payu: PayuConfig, private urls: { backendUrl: string }) {}

  private form(p: PaymentRow, plan: { name: string }, user: { name: string; email: string; phone: string | null }) {
    const cb = `${this.urls.backendUrl}/api/v1/payments/payu/callback?src=browser`;
    return buildPaymentForm(this.payu, {
      txnid: p.txnid, amountInRupees: paiseToRupees(p.amountInPaise), productinfo: plan.name,
      firstname: user.name, email: user.email, phone: user.phone ?? undefined,
      orderId: p.orderId, successUrl: cb, failureUrl: cb,
    });
  }

  async initiate(userId: string, planId: string, idempotencyKey: string) {
    const requestHash = stableHash({ planId });
    const user = await this.repo.getUser(userId);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

    const replay = async () => {
      const rec = await this.repo.findIdempotency(userId, idempotencyKey);
      if (!rec) return null;
      if (rec.requestHash !== requestHash) throw conflict('Idempotency-Key reused with a different request', 'IDEMPOTENCY_MISMATCH');
      const p = rec.orderId ? await this.repo.findByOrderId(rec.orderId) : null;
      if (!p) return null;
      const plan = await this.repo.getPlan(p.planId);
      const open = p.status === 'PENDING' || p.status === 'CREATED';
      return { orderId: p.orderId, status: p.status, replayed: true, payment: open && plan ? this.form(p, plan, user) : null };
    };

    const existing = await replay();
    if (existing) return existing;

    const plan = await this.repo.getPlan(planId); // authoritative price comes from DB only
    if (!plan || !plan.isActive) throw badRequest('Invalid plan', 'INVALID_PLAN');
    if (plan.currency !== 'INR') throw badRequest('Unsupported currency', 'INVALID_PLAN');

    let created: PaymentRow;
    try {
      created = await this.repo.createPaymentWithIdempotency(
        { orderId: newOrderId(), txnid: newTxnid(), userId, planId: plan.id,
          amountInPaise: plan.priceInPaise, currency: plan.currency, status: 'CREATED' },
        { userId, key: idempotencyKey, requestHash });
    } catch (e) {
      if (e instanceof IdempotencyRace) { const r = await replay(); if (r) return r; }
      throw e;
    }
    const pending = (await this.repo.transition(created.id, ['CREATED'], 'PENDING', {})) ?? created;
    await this.repo.recordEvent({ paymentId: created.id, txnid: created.txnid, source: 'api', eventType: 'INITIATED',
      fromStatus: 'CREATED', toStatus: 'PENDING', payloadHash: stableHash({ e: 'init', id: created.id }),
      payload: { orderId: created.orderId, planId: plan.id, amountInPaise: plan.priceInPaise } });
    return { orderId: pending.orderId, status: pending.status, replayed: false, payment: this.form(pending, plan, user) };
  }

  /** Handles both the browser redirect (surl/furl) and the S2S webhook. Never trusts the callback for success. */
  async processCallback(raw: Record<string, unknown>, source: 'browser' | 'webhook'): Promise<CallbackResult> {
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') body[k] = v;
    const received = body.hash;
    if (!received || !body.txnid || !body.status) return { outcome: 'rejected', reason: 'MISSING_FIELDS' };

    if (!safeEqualHex(responseHash(body, this.payu.salt), received)) {
      logger.warn({ txnid: body.txnid, source }, 'payu callback hash mismatch');
      return { outcome: 'rejected', reason: 'INVALID_HASH' };
    }
    if (body.key !== this.payu.key) return { outcome: 'rejected', reason: 'MERCHANT_MISMATCH' };

    const payment = await this.repo.findByTxnid(body.txnid);
    if (!payment) { logger.warn({ txnid: body.txnid }, 'callback for unknown txnid'); return { outcome: 'rejected', reason: 'UNKNOWN_TXN' }; }
    if (body.udf1 !== payment.orderId) return { outcome: 'rejected', reason: 'ORDER_MISMATCH', orderId: payment.orderId };
    if (rupeesToPaise(body.amount ?? '') !== payment.amountInPaise) {
      logger.error({ orderId: payment.orderId }, 'callback amount mismatch');
      return { outcome: 'rejected', reason: 'AMOUNT_MISMATCH', orderId: payment.orderId };
    }

    const payloadHash = stableHash({ ...body, hash: undefined });
    const isNew = await this.repo.recordEvent({ paymentId: payment.id, txnid: payment.txnid, source,
      eventType: 'CALLBACK_' + body.status.toUpperCase(), fromStatus: payment.status, payloadHash,
      payload: sanitize(body) });
    if (!isNew) return { outcome: 'duplicate', orderId: payment.orderId, status: (await this.repo.findByTxnid(body.txnid))!.status };

    const claimed = body.status.toLowerCase();
    if (claimed === 'success') return this.verifyAndSettle(payment, body.mihpayid);

    const target: PaymentStatus =
      claimed === 'pending' ? 'PENDING'
      : body.unmappedstatus === 'userCancelled' ? 'CANCELLED' // assumption: confirm value in PayU sandbox (see PAYU_INTEGRATION.md)
      : 'FAILED';
    return this.applyNonSuccess(payment, target, body.error_Message || body.error || undefined, body.mihpayid);
  }

  private async applyNonSuccess(p: PaymentRow, target: PaymentStatus, reason: string | undefined, mihpayid?: string): Promise<CallbackResult> {
    if (p.status === target) return { outcome: 'duplicate', orderId: p.orderId, status: p.status };
    if (target === 'PENDING' && p.status !== 'CREATED') return { outcome: 'duplicate', orderId: p.orderId, status: p.status };
    const updated = await this.repo.transition(p.id, allowedFrom(target), target, { failureReason: reason, payuMihpayid: mihpayid });
    if (updated) return { outcome: 'processed', orderId: p.orderId, status: updated.status };
    const latest = (await this.repo.findByTxnid(p.txnid))!;
    return this.flagConflict(latest, target);
  }

  private async flagConflict(p: PaymentRow, claimed: PaymentStatus): Promise<CallbackResult> {
    logger.error({ orderId: p.orderId, current: p.status, claimed }, 'CONFLICTING payment callback - manual reconciliation required');
    await this.repo.recordEvent({ paymentId: p.id, txnid: p.txnid, source: 'system', eventType: 'CONFLICT',
      fromStatus: p.status, toStatus: claimed, payloadHash: stableHash({ c: p.id, s: p.status, claimed }),
      payload: { current: p.status, claimed } });
    return { outcome: 'conflict', orderId: p.orderId, status: p.status, reason: 'CONFLICTING_STATE' };
  }

  /** Server-side verification via PayU verify_payment. The only path to SUCCESS. */
  private async verifyAndSettle(p: PaymentRow, mihpayid?: string): Promise<CallbackResult> {
    if (isTerminal(p.status)) {
      return p.status === 'SUCCESS' ? { outcome: 'duplicate', orderId: p.orderId, status: p.status } : this.flagConflict(p, 'SUCCESS');
    }
    let v;
    try { v = await this.gateway.verifyTransaction(p.txnid); }
    catch (e) {
      logger.error({ orderId: p.orderId, err: (e as Error).message }, 'payu verify failed');
      const u = await this.repo.transition(p.id, ['CREATED', 'PENDING', 'VERIFICATION_PENDING'], 'VERIFICATION_PENDING', {});
      return { outcome: 'processed', orderId: p.orderId, status: (u ?? p).status, reason: 'VERIFICATION_UNAVAILABLE' };
    }
    if (!v.found || v.status === 'pending') {
      const u = await this.repo.transition(p.id, ['CREATED', 'PENDING', 'VERIFICATION_PENDING'], 'VERIFICATION_PENDING', {});
      return { outcome: 'processed', orderId: p.orderId, status: (u ?? p).status, reason: 'VERIFICATION_PENDING' };
    }
    if (v.status === 'success') {
      if (rupeesToPaise(v.amount ?? '') !== p.amountInPaise) {
        logger.error({ orderId: p.orderId }, 'verify amount mismatch');
        await this.repo.transition(p.id, ['CREATED', 'PENDING', 'VERIFICATION_PENDING'], 'FAILED', { failureReason: 'AMOUNT_MISMATCH_ON_VERIFY' });
        return { outcome: 'rejected', orderId: p.orderId, status: 'FAILED', reason: 'AMOUNT_MISMATCH' };
      }
      const done = await this.repo.succeedAndActivate(p.id, ['CREATED', 'PENDING', 'VERIFICATION_PENDING'], v.mihpayid ?? mihpayid);
      if (done) return { outcome: 'processed', orderId: p.orderId, status: 'SUCCESS' };
      const latest = (await this.repo.findByTxnid(p.txnid))!;
      return latest.status === 'SUCCESS' ? { outcome: 'duplicate', orderId: p.orderId, status: 'SUCCESS' } : this.flagConflict(latest, 'SUCCESS');
    }
    // verify says failure/other: PayU's own record wins over the callback's claim
    return this.applyNonSuccess(p, 'FAILED', 'VERIFY_REPORTED_' + v.status.toUpperCase(), v.mihpayid);
  }

  async status(userId: string, orderId: string) {
    let p = await this.repo.findByOrderId(orderId);
    if (!p || p.userId !== userId) throw notFound('Order not found');
    if (p.status === 'PENDING' || p.status === 'VERIFICATION_PENDING') p = await this.reconcile(p);
    return { orderId: p.orderId, status: p.status, amountInPaise: p.amountInPaise, currency: p.currency, createdAt: p.createdAt };
  }

  /** Pull-based reconciliation for delayed/missed callbacks. */
  async reconcile(p: PaymentRow): Promise<PaymentRow> {
    try {
      const v = await this.gateway.verifyTransaction(p.txnid);
      if (v.found && v.status === 'success') await this.verifyAndSettle(p, v.mihpayid);
      else if (v.found && v.status !== 'pending') await this.applyNonSuccess(p, 'FAILED', 'VERIFY_REPORTED_' + v.status.toUpperCase(), v.mihpayid);
      else if (!v.found && Date.now() - p.createdAt.getTime() > EXPIRE_AFTER_MS) await this.repo.transition(p.id, ['PENDING', 'VERIFICATION_PENDING'], 'EXPIRED', { failureReason: 'NO_PAYU_RECORD' });
    } catch (e) { logger.warn({ orderId: p.orderId, err: (e as Error).message }, 'reconcile skipped'); }
    return (await this.repo.findByOrderId(p.orderId)) ?? p;
  }

  async history(userId: string, limit = 20, offset = 0) {
    const rows = await this.repo.listByUser(userId, Math.min(limit, 50), offset);
    return rows.map((r) => ({ orderId: r.orderId, status: r.status, amountInPaise: r.amountInPaise, currency: r.currency, planId: r.planId, createdAt: r.createdAt }));
  }
}

/** Strip anything card-related and the hash before persisting a callback for audit. */
function sanitize(b: Record<string, string>) {
  const { hash: _h, cardnum: _c, card_no: _c2, name_on_card: _n, ...rest } = b as Record<string, string>;
  return rest;
}
