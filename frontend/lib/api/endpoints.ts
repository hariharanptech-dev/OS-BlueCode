import { api } from './client';
import type { Plan, InitiateResponse, StatusResponse, User, Subscription, History } from '@/types';

export const getPlans = () =>
  api<any>('/plans').then((r) => {
    const arr = Array.isArray(r) ? r : (r?.plans ?? []);
    return arr.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      features: Array.isArray(p.features)
        ? p.features
        : (p.features && typeof p.features === 'object'
          ? (Array.isArray(p.features.list) ? p.features.list : Object.keys(p.features))
          : []),
      recommended: p.recommended ?? (typeof p.code === 'string' && p.code.includes('PRO')) ?? false,
      price: p.price ?? (p.priceInPaise ? (p.priceInPaise / 100).toFixed(2) : (p.priceMinor ? (p.priceMinor / 100).toFixed(2) : undefined)),
      currency: p.currency ?? 'INR',
      durationDays: p.durationDays,
      amountLabel: p.amountLabel ?? (p.price ? `${p.currency ?? 'INR'} ${p.price}` : (p.priceInPaise ? `${p.currency ?? 'INR'} ${(p.priceInPaise / 100).toFixed(2)}` : (p.priceMinor ? `${p.currency ?? 'INR'} ${(p.priceMinor / 100).toFixed(2)}` : 'Contact us'))),
    })) as Plan[];
  });

export const login = (b: { email: string; password: string }) =>
  api<any>('/auth/login', { method: 'POST', body: JSON.stringify(b) }).then((r) => {
    const u = r?.user ?? r;
    return { id: u?.id, email: u?.email, name: u?.name, user: u, csrfToken: r?.csrfToken };
  });

export const register = (b: { name: string; email: string; password: string }) =>
  api<any>('/auth/register', { method: 'POST', body: JSON.stringify(b) }).then((r) => {
    const u = r?.user ?? r;
    return { id: u?.id, email: u?.email, name: u?.name, user: u };
  });

export const initiatePayment = (b: { planId: string; idempotencyKey: string }) =>
  api<any>('/payments/initiate', {
    method: 'POST',
    headers: { 'Idempotency-Key': b.idempotencyKey },
    body: JSON.stringify({ planId: b.planId }),
  }).then((r) => {
    const action = r.payment?.action ?? r.redirect?.url ?? '';
    const fields = r.payment?.fields ?? r.redirect?.fields ?? {};
    const method = (r.payment?.method ?? r.redirect?.method ?? 'POST') as 'POST';
    return {
      orderId: r.orderId,
      amount: r.amount ?? (r.payment?.fields?.amount ?? '0'),
      currency: r.currency ?? 'INR',
      total: r.total ?? r.amount ?? (r.payment?.fields?.amount ?? '0'),
      redirect: { url: action, method, fields },
      payment: { action, method, fields },
    } as InitiateResponse;
  });

export const getPaymentStatus = (orderId: string) =>
  api<any>(`/payments/${encodeURIComponent(orderId)}/status`).then((r) => ({
    orderId: r.orderId,
    status: r.status,
    txnRef: r.txnRef ?? r.providerTransactionId ?? r.payuMihpayid ?? undefined,
    amount: r.amount,
    currency: r.currency,
    planName: r.planName,
  } as StatusResponse));

export const getMe = () =>
  api<any>('/auth/me').then((r) => {
    const u = r?.user ?? r;
    return {
      id: u?.id ?? '',
      name: u?.name ?? '',
      email: u?.email ?? '',
      user: u,
      csrfToken: r?.csrfToken,
    } as User;
  });

export const logout = () => api<{ ok: true }>('/auth/logout', { method: 'POST' });

export const getSubscription = () =>
  api<any>('/subscriptions/me').then((r) => {
    const s = r?.subscription ?? r;
    if (!s || s.status === 'NONE') {
      return { planName: 'None', status: 'NONE' as const };
    }
    return {
      planName: s.planName ?? s.plan?.name ?? 'Standard',
      status: s.status as any,
      startsAt: s.startsAt ?? s.startDate,
      expiresAt: s.expiresAt ?? s.endDate,
      renews: s.renews ?? false,
    } as Subscription;
  });

export const getHistory = (page: number) =>
  api<any>(`/payments/history?page=${page}`).then((r) => {
    const items = r?.items ?? (Array.isArray(r?.payments) ? r.payments.map((p: any) => ({
      orderId: p.orderId,
      txnRef: p.txnRef ?? p.providerTransactionId ?? p.payuMihpayid ?? undefined,
      amount: p.amount ?? (p.amountInPaise ? (p.amountInPaise / 100).toFixed(2) : (p.amountMinor ? (p.amountMinor / 100).toFixed(2) : '0.00')),
      currency: p.currency ?? 'INR',
      paidAt: p.paidAt ?? p.verifiedAt ?? p.createdAt,
      status: p.status,
    })) : []);
    const pageNum = r?.page ?? page;
    const pageCount = r?.pageCount ?? Math.max(1, Math.ceil(items.length / 10));
    return { items, page: pageNum, pageCount } as History;
  });

export const forgotPassword = (b: { email: string }) =>
  api<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(b) });

export const resetPassword = (b: { token: string; password: string }) =>
  api<{ ok: true }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(b) });

export const changePassword = (b: { currentPassword: string; newPassword: string }) =>
  api<{ ok: true }>('/auth/change-password', { method: 'POST', body: JSON.stringify(b) });
