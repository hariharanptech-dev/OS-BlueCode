// Backend API response types (matching the API contract)
export type BackendPlan = { id: string; code: string; name: string; price: string; currency: string; durationDays: number };
export type BackendInitiateResponse = { orderId: string; status: string; replayed: boolean; payment: { action: string; method: 'POST'; fields: Record<string, string> } | null };
export type BackendStatusResponse = { orderId: string; status: string; amountInPaise: number; currency: string; createdAt: string };
export type BackendSubscription = { id: string; userId: string; planId: string; paymentId: string; status: string; startsAt: string; expiresAt: string; planName: string } | null;
export type BackendTxn = { orderId: string; status: string; amountInPaise: number; currency: string; planId: string; createdAt: string };
export type BackendHistory = { payments: BackendTxn[] };

// Frontend UI types (transformed from backend)
export type Plan = { id: string; name: string; description: string; features: string[]; recommended?: boolean; amountLabel: string };
export type PaymentStatus = 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PENDING' | 'CREATED' | 'EXPIRED' | 'VERIFICATION_PENDING';
export type InitiateResponse = { orderId: string; amount: string; currency: string; tax?: string; total: string; redirect: { url: string; method: 'POST'; fields: Record<string, string> } };
export type StatusResponse = { orderId: string; status: PaymentStatus; txnRef?: string };
export type User = { id: string; name: string; email: string };
export type SubStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'NONE';
export type Subscription = { planName: string; status: SubStatus; startsAt?: string; expiresAt?: string; renews?: boolean };
export type Txn = { orderId: string; txnRef?: string; amount: string; currency: string; paidAt: string; status: PaymentStatus };
export type History = { items: Txn[]; page: number; pageCount: number };
