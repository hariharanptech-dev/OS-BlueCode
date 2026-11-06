import type { PrismaClient } from '../db/client';
import { createRepositories } from '../repositories';
import { systemClock, type Clock } from '../shared/time';
import type { VerifiedPayUTransaction } from '../validation/schemas';
import type { PaymentService } from './paymentService';
import type { SubscriptionActivationService } from './subscriptionActivationService';

export type ReconciliationVerdict =
  | { outcome: 'SUCCESS'; verified: Omit<VerifiedPayUTransaction, 'source'> }
  | { outcome: 'FAILED' | 'CANCELLED'; orderId: string; reason?: string; providerTransactionId?: string; payload?: Record<string, unknown> }
  | { outcome: 'STILL_PENDING'; orderId: string; payload?: Record<string, unknown> };

/**
 * Support for the periodic job that asks PayU (verify API, done by the payment-integration module) about payments
 * stuck in CREATED/PENDING, then applies the verdict here. This module never contacts PayU.
 */
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly activation: SubscriptionActivationService,
    private readonly payments: PaymentService,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Payments initiated more than `olderThanMs` ago that never reached a terminal state. */
  findStalePayments(olderThanMs: number, limit = 100) {
    return createRepositories(this.prisma).payments.findStale(new Date(this.clock().getTime() - olderThanMs), limit);
  }

  /** Integrity report. Every list should be empty in a healthy system. */
  async findAnomalies() {
    const now = this.clock();
    const successWithoutSubscription = await this.prisma.$queryRaw<{ id: string; order_id: string }[]>`
      SELECT p.id, p.order_id FROM payments p LEFT JOIN subscriptions s ON s.payment_id = p.id
      WHERE p.status = 'SUCCESS' AND s.id IS NULL`;
    const subscriptionsWithoutSuccessPayment = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM subscriptions s JOIN payments p ON p.id = s.payment_id WHERE p.status <> 'SUCCESS'`;
    const liveButPastEnd = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM subscriptions WHERE status IN ('ACTIVE','PENDING','SUSPENDED') AND end_date <= ${now}::timestamptz`;
    const rejectedVerifications = await this.prisma.$queryRaw<{ payment_id: string; event_type: string }[]>`
      SELECT DISTINCT e.payment_id, e.event_type::text FROM payment_events e JOIN payments p ON p.id = e.payment_id
      WHERE e.event_type IN ('VERIFICATION_MISMATCH') AND p.status <> 'SUCCESS'`;
    return { successWithoutSubscription, subscriptionsWithoutSuccessPayment, liveButPastEnd, rejectedVerifications };
  }

  /** Apply one PayU verification verdict. Idempotent: safe to re-run the same verdict. */
  async applyVerdict(verdict: ReconciliationVerdict) {
    if (verdict.outcome === 'SUCCESS') {
      return this.activation.activateFromVerifiedPayment({ ...verdict.verified, source: 'RECONCILIATION' });
    }
    if (verdict.outcome === 'STILL_PENDING') {
      const e = await this.payments.recordProviderEvent({ orderId: verdict.orderId, eventType: 'RECONCILIATION_CHECKED', payload: { ...verdict.payload, outcome: 'STILL_PENDING' } });
      return { outcome: 'STILL_PENDING' as const, eventId: e.id };
    }
    return this.payments.recordFailure({ orderId: verdict.orderId, status: verdict.outcome, reason: verdict.reason ?? 'RECONCILIATION', providerTransactionId: verdict.providerTransactionId, payload: verdict.payload });
  }
}
