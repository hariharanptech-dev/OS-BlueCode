import {api} from './client';
import type {Plan,InitiateResponse,StatusResponse,User,Subscription,History,BackendPlan,BackendInitiateResponse,BackendStatusResponse,BackendSubscription,BackendHistory,BackendTxn} from '@/types';

// Transform backend plan to frontend plan
function transformPlan(backend: BackendPlan): Plan {
  const priceInPaise = Math.round(parseFloat(backend.price) * 100);
  const amountLabel = `₹${(priceInPaise / 100).toFixed(2)} / ${backend.durationDays} days`;
  return {
    id: backend.id,
    name: backend.name,
    description: `${backend.durationDays}-day ${backend.name.toLowerCase()} plan`,
    features: [`${backend.durationDays} days access`, 'All features included'],
    recommended: backend.code.includes('pro'),
    amountLabel,
  };
}

// Transform backend initiate response to frontend initiate response
function transformInitiateResponse(backend: BackendInitiateResponse): InitiateResponse {
  const amount = backend.payment?.fields.amount ?? '0';
  const currency = backend.payment?.fields.key ? 'INR' : 'INR'; // default to INR
  const total = amount; // no tax for now
  return {
    orderId: backend.orderId,
    amount,
    currency,
    total,
    redirect: {
      url: backend.payment?.action ?? '',
      method: 'POST',
      fields: backend.payment?.fields ?? {},
    },
  };
}

// Transform backend status response to frontend status response
function transformStatusResponse(backend: BackendStatusResponse): StatusResponse {
  return {
    orderId: backend.orderId,
    status: backend.status as StatusResponse['status'],
    txnRef: undefined, // backend doesn't provide this
  };
}

// Transform backend subscription to frontend subscription
function transformSubscription(backend: BackendSubscription): Subscription | null {
  if (!backend) return null;
  return {
    planName: backend.planName,
    status: backend.status as Subscription['status'],
    startsAt: backend.startsAt,
    expiresAt: backend.expiresAt,
    renews: false, // not tracked in backend
  };
}

// Transform backend transaction to frontend transaction
function transformTxn(backend: BackendTxn): Txn {
  return {
    orderId: backend.orderId,
    txnRef: undefined,
    amount: (backend.amountInPaise / 100).toFixed(2),
    currency: backend.currency,
    paidAt: backend.createdAt,
    status: backend.status as Txn['status'],
  };
}

// Transform backend history to frontend history
function transformHistory(backend: BackendHistory, page: number): History {
  const items = backend.payments.map(transformTxn);
  return {
    items,
    page,
    pageCount: Math.ceil(items.length / 20), // approximate
  };
}

export const getPlans = async () => {
  const data = await api<{ plans: BackendPlan[] }>('/plans');
  return data.plans.map(transformPlan);
};

export const login = (b: { email: string; password: string }) => api<{ id: string; email: string }>('/auth/login', { method: 'POST', body: JSON.stringify(b) });
export const register = (b: { name: string; email: string; password: string }) => api<{ id: string; email: string }>('/auth/register', { method: 'POST', body: JSON.stringify(b) });

export const initiatePayment = async (b: { planId: string; idempotencyKey: string }) => {
  const data = await api<BackendInitiateResponse>('/payments/initiate', { method: 'POST', body: JSON.stringify(b) });
  return transformInitiateResponse(data);
};

export const getPaymentStatus = async (orderId: string) => {
  const data = await api<BackendStatusResponse>(`/payments/${encodeURIComponent(orderId)}/status`);
  return transformStatusResponse(data);
};

export const getMe = () => api<User>('/auth/me');
export const logout = () => api<{ ok: true }>('/auth/logout', { method: 'POST' });

export const getSubscription = async () => {
  const data = await api<{ subscription: BackendSubscription }>('/subscriptions/me');
  return transformSubscription(data.subscription);
};

export const getHistory = async (page: number) => {
  const data = await api<BackendHistory>(`/payments/history?limit=20&offset=${(page - 1) * 20}`);
  return transformHistory(data, page);
};

// Proposed endpoints, NOT in the agreed contract: backend team must confirm (see API_CONTRACT.md).
export const forgotPassword = (b: { email: string }) => api<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(b) });
export const resetPassword = (b: { token: string; password: string }) => api<{ ok: true }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(b) });
export const changePassword = (b: { currentPassword: string; newPassword: string }) => api<{ ok: true }>('/auth/change-password', { method: 'POST', body: JSON.stringify(b) });
