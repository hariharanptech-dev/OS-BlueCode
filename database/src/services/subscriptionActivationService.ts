import type { Payment, Subscription } from '../generated/prisma/client';
import type { PrismaClient, DbClient } from '../db/client';
import { runInTransaction } from '../db/transaction';
import { createRepositories } from '../repositories';
import { NotFoundError, uniqueViolationTarget } from '../shared/errors';
import { addDaysUtc, systemClock, type Clock } from '../shared/time';
import { verifiedPayUTransactionSchema, type VerifiedPayUTransaction } from '../validation/schemas';
import { expireAndPromote } from './subscriptionExpiryService';

export type ActivationOutcome = 'ACTIVATED' | 'ALREADY_ACTIVATED' | 'REJECTED';
export type RejectionReason =
  | 'TRANSACTION_ID_MISMATCH' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH'
  | 'PAYMENT_NOT_ACTIVATABLE' | 'PROVIDER_TRANSACTION_ALREADY_USED' | 'PROVIDER_TRANSACTION_ID_MISMATCH';
export interface ActivationResult {
  outcome: ActivationOutcome;
  reason?: RejectionReason;
  payment: Payment;
  subscription: Subscription | null;
}
export interface ActivationOptions {
  clock?: Clock;
  /** TEST SEAM ONLY: runs inside the transaction just before commit (used to prove rollback atomicity). */
  beforeCommitHook?: (tx: DbClient) => Promise<void>;
}

/**
 * Turns a BACKEND-VERIFIED successful PayU transaction into exactly one subscription.
 *
 * Concurrency design (see DATABASE_ARCHITECTURE.md):
 *   lock order  payment row -> user row -> subscription rows (always the same order => no deadlocks)
 *   + UNIQUE(subscriptions.payment_id)  => a payment can never produce two subscriptions
 *   + EXCLUDE overlap + one-ACTIVE index => a user can never have overlapping live windows
 * Repeated/concurrent callbacks therefore serialise on the payment lock and the later ones become no-ops.
 */
export class SubscriptionActivationService {
  private readonly clock: Clock;
  constructor(private readonly prisma: PrismaClient, private readonly opts: ActivationOptions = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  async activateFromVerifiedPayment(input: VerifiedPayUTransaction): Promise<ActivationResult> {
    const v = verifiedPayUTransactionSchema.parse(input);
    try {
      return await this.run(v);
    } catch (e) {
      // Defensive: a unique violation on payment_id means another transaction won; replay as no-op.
      if (uniqueViolationTarget(e)?.includes('payment_id')) return this.run(v);
      throw e;
    }
  }

  private run(v: ReturnType<typeof verifiedPayUTransactionSchema.parse>): Promise<ActivationResult> {
    return runInTransaction(this.prisma, async (tx) => {
      const repos = createRepositories(tx);
      const now = this.clock();

      const found = await repos.payments.findByOrderId(v.orderId);
      if (!found) throw new NotFoundError('Payment', v.orderId);
      let payment = await repos.payments.lockById(found.id); // (1) payment lock

      const reject = async (reason: RejectionReason): Promise<ActivationResult> => {
        await repos.paymentEvents.record({
          paymentId: payment.id, eventType: reason.endsWith('MISMATCH') ? 'VERIFICATION_MISMATCH' : 'VERIFICATION_FAILED',
          providerReference: v.providerTransactionId, processingStatus: 'FAILED', receivedAt: now,
          payload: { ...v.payload, reason, expected_amount_minor: payment.amountMinor, received_amount_minor: v.amountMinor, expected_currency: payment.currency, received_currency: v.currency },
        });
        return { outcome: 'REJECTED', reason, payment, subscription: null };
      };

      // Repeat / concurrent callback: already activated => idempotent no-op.
      const existing = await repos.subscriptions.findByPaymentId(payment.id);
      if (existing) {
        await repos.paymentEvents.record({ paymentId: payment.id, eventType: 'VERIFICATION_SUCCEEDED', providerReference: v.providerTransactionId, processingStatus: 'IGNORED', receivedAt: now, payload: { ...v.payload, reason: 'DUPLICATE_CALLBACK' } });
        return { outcome: 'ALREADY_ACTIVATED', payment, subscription: existing };
      }

      // Never trust the caller's numbers over what we stored at order time.
      if (v.transactionId !== payment.transactionId) return reject('TRANSACTION_ID_MISMATCH');
      if (v.currency !== payment.currency) return reject('CURRENCY_MISMATCH');
      if (v.amountMinor !== payment.amountMinor) return reject('AMOUNT_MISMATCH');
      if (payment.providerTransactionId && payment.providerTransactionId !== v.providerTransactionId) return reject('PROVIDER_TRANSACTION_ID_MISMATCH');
      // FAILED/CANCELLED may only be revived by reconciliation re-verifying with PayU.
      if ((payment.status === 'FAILED' || payment.status === 'CANCELLED') && v.source !== 'RECONCILIATION') return reject('PAYMENT_NOT_ACTIVATABLE');
      const clash = await repos.payments.findByProviderTransactionId(v.providerTransactionId);
      if (clash && clash.id !== payment.id) return reject('PROVIDER_TRANSACTION_ALREADY_USED');

      if (payment.status !== 'SUCCESS') {
        const from = payment.status;
        const ok = await repos.payments.transition(payment.id, ['CREATED', 'PENDING', 'FAILED', 'CANCELLED'], 'SUCCESS', {
          providerTransactionId: v.providerTransactionId, verifiedAt: v.verifiedAt, failureReason: null,
        });
        if (!ok) return reject('PAYMENT_NOT_ACTIVATABLE');
        payment = await repos.payments.findByIdOrThrow(payment.id);
        await repos.paymentEvents.record({ paymentId: payment.id, eventType: 'PAYMENT_STATUS_CHANGED', providerReference: v.providerTransactionId, processingStatus: 'PROCESSED', receivedAt: now, payload: { ...v.payload, from, to: 'SUCCESS', verification_source: v.source } });
      }

      await repos.users.lock(payment.userId); // (2) user lock
      await expireAndPromote(tx, now, { userId: payment.userId, actor: 'PAYMENT_ACTIVATION' });

      // Renewal / stacking: start now, or right after the user's latest live window ends. Duration is the
      // snapshot taken at order time, so later plan edits cannot change what the customer paid for.
      const latestEnd = await repos.subscriptions.maxLiveEndDate(payment.userId);
      const startDate = latestEnd && latestEnd > now ? latestEnd : now;
      const endDate = addDaysUtc(startDate, payment.planDurationDays);
      const startsNow = startDate.getTime() <= now.getTime();

      const subscription = await repos.subscriptions.create({
        userId: payment.userId, planId: payment.planId, paymentId: payment.id,
        status: startsNow ? 'ACTIVE' : 'PENDING', startDate, endDate, activatedAt: startsNow ? now : null,
      });
      await repos.subscriptions.addEvent({ subscriptionId: subscription.id, fromStatus: null, toStatus: subscription.status, reason: 'PAYMENT_VERIFIED', actor: 'PAYMENT_ACTIVATION', at: now });
      await repos.paymentEvents.record({
        paymentId: payment.id, eventType: 'SUBSCRIPTION_ACTIVATED', providerReference: v.providerTransactionId, processingStatus: 'PROCESSED', receivedAt: now,
        payload: { subscriptionId: subscription.id, startDate: startDate.toISOString(), endDate: endDate.toISOString(), status: subscription.status },
      });

      if (this.opts.beforeCommitHook) await this.opts.beforeCommitHook(tx);
      return { outcome: 'ACTIVATED', payment, subscription };
    });
  }
}
