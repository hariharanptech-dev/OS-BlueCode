export type PaymentStatus = 'pending' | 'success' | 'failed' | 'cancelled' | 'expired';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  planId: string;
  txnid: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  idempotencyKey: string | null;
  customer: { firstname: string; email: string; phone: string };
  mihpayid: string | null;
  needsReview: boolean;
  renewal: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface PaymentEvent {
  id: string;
  orderId: string;
  txnid: string;
  source: 'redirect' | 'webhook' | 'refresh' | 'reconcile';
  reportedStatus: string;
  outcome: string;
  digest: string;
  receivedAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  paymentId: string; // UNIQUE: DB-level backstop against double activation
  startsAt: string;
  expiresAt: string;
  createdAt: string;
}

export type SubscriptionView = Subscription & { status: 'active' | 'scheduled' | 'expired' };
