export type PaymentStatus = 'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'VERIFICATION_PENDING';

export interface PlanRow { id: string; code: string; name: string; priceInPaise: number; currency: string; durationDays: number; isActive: boolean }
export interface UserRow { id: string; email: string; name: string; phone: string | null }
export interface PaymentRow {
  id: string; orderId: string; txnid: string; userId: string; planId: string;
  amountInPaise: number; currency: string; status: PaymentStatus;
  payuMihpayid: string | null; failureReason: string | null; verifiedAt: Date | null; createdAt: Date;
}
export interface SubscriptionRow { id: string; userId: string; planId: string; paymentId: string; status: string; startsAt: Date; expiresAt: Date }
export interface EventInput {
  paymentId?: string | null; txnid?: string | null; source: string; eventType: string;
  fromStatus?: string | null; toStatus?: string | null; payloadHash: string; payload: unknown;
}

/** Persistence boundary. PrismaPaymentRepository implements it; tests use an in-memory version. */
export interface PaymentRepository {
  getPlan(planId: string): Promise<PlanRow | null>;
  getUser(userId: string): Promise<UserRow | null>;
  findIdempotency(userId: string, key: string): Promise<{ requestHash: string; orderId: string | null } | null>;
  createPaymentWithIdempotency(p: Omit<PaymentRow, 'id' | 'createdAt' | 'verifiedAt' | 'payuMihpayid' | 'failureReason'>,
    idem: { userId: string; key: string; requestHash: string }): Promise<PaymentRow>;
  findByOrderId(orderId: string): Promise<PaymentRow | null>;
  findByTxnid(txnid: string): Promise<PaymentRow | null>;
  listByUser(userId: string, limit: number, offset: number): Promise<PaymentRow[]>;
  /** Returns false if the event (txnid + payloadHash) was already recorded. */
  recordEvent(e: EventInput): Promise<boolean>;
  /** Compare-and-set status change. Returns updated row or null if current status was not in `from`. */
  transition(paymentId: string, from: PaymentStatus[], to: PaymentStatus,
    extra: { payuMihpayid?: string; failureReason?: string; verified?: boolean }): Promise<PaymentRow | null>;
  /** Atomic: CAS to SUCCESS + create subscription exactly once (unique paymentId). */
  succeedAndActivate(paymentId: string, from: PaymentStatus[], mihpayid: string | undefined): Promise<{ payment: PaymentRow; subscription: SubscriptionRow } | null>;
  getActiveSubscription(userId: string): Promise<(SubscriptionRow & { planName: string }) | null>;
}
