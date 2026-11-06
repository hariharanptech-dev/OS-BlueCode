import { Request, Response } from 'express';
import { PaymentService } from '../services/paymentService';
import { SubscriptionService } from '../services/subscriptionService';
import { PaymentRepository } from '../types';
import { historyQuery, idempotencyKeySchema, initiateSchema, orderIdParam } from '../validators/schemas';
import { badRequest, notFound } from '../utils/errors';
import { paiseToRupees } from '../utils/money';
import { AppConfig } from '../config';

const planDto = (p: any) => {
  const priceStr = p.price ?? paiseToRupees(p.priceInPaise ?? p.priceMinor ?? 0);
  const currency = p.currency ?? 'INR';
  const features = Array.isArray(p.features)
    ? p.features
    : p.features && typeof p.features === 'object'
    ? (Array.isArray(p.features.list) ? p.features.list : Object.keys(p.features))
    : [];
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description ?? '',
    price: priceStr,
    priceInPaise: p.priceInPaise ?? p.priceMinor ?? 0,
    currency,
    durationDays: p.durationDays,
    features,
    amountLabel: `${currency} ${priceStr}`,
    recommended: Boolean(p.recommended ?? (p.code && p.code.includes('PRO'))),
  };
};

export const planController = (repo: PaymentRepository & { listPlans(): Promise<any[]> }) => ({
  list: async (_q: Request, res: Response) => res.json({ plans: (await repo.listPlans()).map(planDto) }),
  get: async (req: Request, res: Response) => {
    const p = await repo.getPlan(req.params.planId);
    if (!p || !p.isActive) throw notFound('Plan not found');
    res.json({ plan: planDto(p) });
  },
});

export const subscriptionController = (svc: SubscriptionService) => ({
  mine: async (req: Request, res: Response) => {
    const s = await svc.getMine(req.session.userId!);
    if (!s) {
      return res.json({ subscription: null, planName: 'None', status: 'NONE' });
    }
    res.json({
      subscription: s,
      planName: s.planName,
      status: s.status,
      startsAt: s.startsAt?.toISOString?.() ?? String(s.startsAt),
      expiresAt: s.expiresAt?.toISOString?.() ?? String(s.expiresAt),
    });
  },
});

export const paymentController = (svc: PaymentService, cfg: AppConfig) => ({
  initiate: async (req: Request, res: Response) => {
    const keyHeader =
      req.header('idempotency-key') ??
      (req.body && typeof req.body === 'object' && typeof req.body.idempotencyKey === 'string'
        ? req.body.idempotencyKey
        : undefined);
    const key = idempotencyKeySchema.safeParse(keyHeader);
    if (!key.success) throw badRequest('Idempotency-Key header (16-64 chars) is required', 'IDEMPOTENCY_KEY_REQUIRED');
    const { planId } = initiateSchema.parse(req.body); // price/user are never read from the client
    const r = await svc.initiate(req.session.userId!, planId, key.data);
    const action = r.payment?.action ?? '';
    const fields = r.payment?.fields ?? {};
    const method = r.payment?.method ?? 'POST';
    const amount = fields.amount ?? '0';
    res.status(201).json({
      ...r,
      amount,
      currency: 'INR',
      total: amount,
      redirect: { url: action, method, fields },
    });
  },
  status: async (req: Request, res: Response) => res.json(await svc.status(req.session.userId!, orderIdParam.parse(req.params.orderId))),
  history: async (req: Request, res: Response) => {
    const q = historyQuery.parse(req.query);
    const page = q.page ?? (q.offset !== undefined && q.limit ? Math.floor(q.offset / q.limit) + 1 : 1);
    const limit = q.limit;
    const offset = q.page ? (page - 1) * limit : q.offset;
    const payments = await svc.history(req.session.userId!, limit, offset);
    const items = payments.map((p: any) => ({
      orderId: p.orderId,
      txnRef: p.payuMihpayid ?? p.providerTransactionId ?? undefined,
      amount: paiseToRupees(p.amountInPaise ?? p.amountMinor ?? 0),
      currency: p.currency,
      paidAt: (p.verifiedAt ?? p.createdAt)?.toISOString?.() ?? String(p.createdAt),
      status: p.status,
    }));
    const pageCount = Math.max(1, Math.ceil(items.length / limit));
    res.json({ payments, items, page, pageCount });
  },
  /** PayU posts form-urlencoded. Browser flow (src=browser) -> 303 to frontend; S2S webhook -> JSON. */
  callback: async (req: Request, res: Response) => {
    const browser = req.query.src === 'browser';
    const r = await svc.processCallback(req.body ?? {}, browser ? 'browser' : 'webhook');
    if (browser) {
      const u = new URL('/payment/result', cfg.frontendUrl);
      if (r.orderId) u.searchParams.set('orderId', r.orderId); // display hint only; the page must call /status
      return res.redirect(303, u.toString());
    }
    if (r.outcome === 'rejected') return res.status(400).json({ ok: false, reason: r.reason });
    res.status(200).json({ ok: true, outcome: r.outcome });
  },
});
