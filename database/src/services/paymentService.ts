import { runInTransaction } from '../db/transaction';
import type { PrismaClient } from '../db/client';
import type { PaymentEventType } from '../generated/prisma/client';
import { createRepositories } from '../repositories';
import {
  AccountNotActiveError, InvalidTransitionError, NotFoundError, PlanNotPurchasableError,
} from '../shared/errors';
import { generateOrderId, generateTransactionId } from '../shared/ids';
import { systemClock, type Clock } from '../shared/time';
import {
  createPaymentOrderSchema, recordFailureSchema, type CreatePaymentOrderInput, type RecordFailureInput,
} from '../validation/schemas';
import { IdempotencyService } from './idempotencyService';

export type RecordFailureOutcome = 'RECORDED' | 'ALREADY_TERMINAL' | 'IGNORED_ALREADY_SUCCESS';

export class PaymentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly idempotency: IdempotencyService,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Creates a payment order. Price/currency/duration are READ FROM THE DATABASE plan (never from the caller) and
   * snapshotted onto the payment. The user id must come from authenticated backend context.
   * Same (user, key, request) => same payment, `replayed: true`. Everything is one transaction.
   */
  async createPaymentOrder(input: CreatePaymentOrderInput) {
    const { userId, planId, idempotencyKey } = createPaymentOrderSchema.parse(input);
    return runInTransaction(this.prisma, async (tx) => {
      const repos = createRepositories(tx);
      const user = await repos.users.getByIdOrThrow(userId);
      if (user.accountStatus !== 'ACTIVE') throw new AccountNotActiveError(userId);

      const idem = await this.idempotency.begin(tx, { userId, key: idempotencyKey, request: { op: 'CREATE_PAYMENT_ORDER', planId, provider: 'PAYU' } });
      if (idem.kind === 'REPLAY') {
        const payment = await repos.payments.findById(idem.responseReference);
        if (!payment) throw new NotFoundError('Payment', idem.responseReference);
        return { payment, replayed: true as const };
      }

      const plan = await repos.plans.getByIdOrThrow(planId);
      if (!plan.isActive) throw new PlanNotPurchasableError(planId);

      const payment = await repos.payments.create({
        userId, planId, orderId: generateOrderId(), transactionId: generateTransactionId(),
        amountMinor: plan.priceMinor, currency: plan.currency, planDurationDays: plan.durationDays,
        idempotencyKey, initiatedAt: this.clock(),
      });
      await repos.paymentEvents.record({
        paymentId: payment.id, eventType: 'PAYMENT_CREATED', processingStatus: 'PROCESSED', receivedAt: this.clock(),
        payload: { planCode: plan.code, amountMinor: payment.amountMinor, currency: payment.currency, orderId: payment.orderId },
      });
      await this.idempotency.complete(tx, idem.recordId, payment.id);
      return { payment, replayed: false as const };
    });
  }

  /** CREATED -> PENDING when the user is redirected to PayU. Idempotent for PENDING. */
  async markRedirected(orderId: string) {
    return runInTransaction(this.prisma, async (tx) => {
      const repos = createRepositories(tx);
      const found = await repos.payments.getByOrderIdOrThrow(orderId);
      const p = await repos.payments.lockById(found.id);
      if (p.status === 'PENDING') return p;
      if (p.status !== 'CREATED') throw new InvalidTransitionError('Payment', p.status, 'PENDING');
      await repos.payments.transition(p.id, ['CREATED'], 'PENDING');
      await repos.paymentEvents.record({ paymentId: p.id, eventType: 'REDIRECTED_TO_PROVIDER', processingStatus: 'PROCESSED', receivedAt: this.clock(), payload: { orderId } });
      return repos.payments.findByIdOrThrow(p.id);
    });
  }

  /** Audit-log any callback/webhook/verification receipt. Payload is allow-list sanitized by the repository. */
  async recordProviderEvent(a: { orderId: string; eventType: PaymentEventType; providerReference?: string; payload?: unknown }) {
    const p = await createRepositories(this.prisma).payments.getByOrderIdOrThrow(a.orderId);
    return createRepositories(this.prisma).paymentEvents.record({
      paymentId: p.id, eventType: a.eventType, providerReference: a.providerReference, payload: a.payload, receivedAt: this.clock(),
    });
  }

  /**
   * Records a FAILED / CANCELLED outcome. Can NEVER create or alter a subscription. A late failure callback after a
   * successful payment is ignored (and audited), never downgrading a SUCCESS.
   */
  async recordFailure(input: RecordFailureInput): Promise<{ outcome: RecordFailureOutcome; paymentId: string }> {
    const v = recordFailureSchema.parse(input);
    return runInTransaction(this.prisma, async (tx) => {
      const repos = createRepositories(tx);
      const found = await repos.payments.getByOrderIdOrThrow(v.orderId);
      const p = await repos.payments.lockById(found.id);
      const now = this.clock();
      const evt = { paymentId: p.id, providerReference: v.providerTransactionId, receivedAt: now };

      if (p.status === 'SUCCESS') {
        await repos.paymentEvents.record({ ...evt, eventType: 'VERIFICATION_FAILED', processingStatus: 'IGNORED', payload: { ...v.payload, reason: 'LATE_FAILURE_AFTER_SUCCESS', status: v.status } });
        return { outcome: 'IGNORED_ALREADY_SUCCESS' as const, paymentId: p.id };
      }
      if (p.status === 'FAILED' || p.status === 'CANCELLED') {
        await repos.paymentEvents.record({ ...evt, eventType: 'VERIFICATION_FAILED', processingStatus: 'IGNORED', payload: { ...v.payload, status: v.status, reason: 'ALREADY_TERMINAL' } });
        return { outcome: 'ALREADY_TERMINAL' as const, paymentId: p.id };
      }
      const ok = await repos.payments.transition(p.id, ['CREATED', 'PENDING'], v.status, { failureReason: v.reason ?? null });
      if (!ok) throw new InvalidTransitionError('Payment', p.status, v.status);
      if (v.providerTransactionId && !p.providerTransactionId) {
        const clash = await repos.payments.findByProviderTransactionId(v.providerTransactionId);
        if (!clash) await repos.payments.setProviderTransactionId(p.id, v.providerTransactionId);
      }
      await repos.paymentEvents.record({ ...evt, eventType: 'PAYMENT_STATUS_CHANGED', processingStatus: 'PROCESSED', payload: { ...v.payload, from: p.status, to: v.status, reason: v.reason } });
      return { outcome: 'RECORDED' as const, paymentId: p.id };
    });
  }

  getByOrderId(orderId: string) {
    return createRepositories(this.prisma).payments.findByOrderId(orderId);
  }
}
