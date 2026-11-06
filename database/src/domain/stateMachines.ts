import { PaymentStatus, SubscriptionStatus } from '../generated/prisma/client';
import { InvalidTransitionError } from '../shared/errors';

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  CREATED: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'],
  PENDING: ['SUCCESS', 'FAILED', 'CANCELLED'],
  SUCCESS: [],
  FAILED: ['SUCCESS'], // ONLY via reconciliation with a server-verified success (guarded in ActivationService)
  CANCELLED: ['SUCCESS'], // idem
};

export const SUBSCRIPTION_TRANSITIONS: Readonly<Record<SubscriptionStatus, readonly SubscriptionStatus[]>> = {
  PENDING: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['EXPIRED', 'CANCELLED', 'SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  EXPIRED: [],
  CANCELLED: [],
};

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!PAYMENT_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError('Payment', from, to);
}
export function assertSubscriptionTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!SUBSCRIPTION_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError('Subscription', from, to);
}
export const LIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'PENDING', 'SUSPENDED'];
