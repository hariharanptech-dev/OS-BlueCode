import { Request, Response } from 'express';
import { PaymentService } from '../services/paymentService';
import { SubscriptionService } from '../services/subscriptionService';
import { PaymentRepository } from '../types';
import { historyQuery, idempotencyKeySchema, initiateSchema, orderIdParam } from '../validators/schemas';
import { badRequest, notFound } from '../utils/errors';
import { paiseToRupees } from '../utils/money';
import { AppConfig } from '../config';

const planDto = (p: any) => ({ id: p.id, code: p.code, name: p.name, price: paiseToRupees(p.priceInPaise), currency: p.currency, durationDays: p.durationDays });

export const planController = (repo: PaymentRepository & { listPlans(): Promise<any[]> }) => ({
  list: async (_q: Request, res: Response) => res.json({ plans: (await repo.listPlans()).map(planDto) }),
  get: async (req: Request, res: Response) => {
    const p = await repo.getPlan(req.params.planId);
    if (!p || !p.isActive) throw notFound('Plan not found');
    res.json({ plan: planDto(p) });
  },
});

export const subscriptionController = (svc: SubscriptionService) => ({
  mine: async (req: Request, res: Response) => res.json({ subscription: await svc.getMine(req.session.userId!) }),
});

export const paymentController = (svc: PaymentService, cfg: AppConfig) => ({
  initiate: async (req: Request, res: Response) => {
    const key = idempotencyKeySchema.safeParse(req.header('idempotency-key'));
    if (!key.success) throw badRequest('Idempotency-Key header (16-64 chars) is required', 'IDEMPOTENCY_KEY_REQUIRED');
    const { planId } = initiateSchema.parse(req.body); // price/user are never read from the client
    res.status(201).json(await svc.initiate(req.session.userId!, planId, key.data));
  },
  status: async (req: Request, res: Response) => res.json(await svc.status(req.session.userId!, orderIdParam.parse(req.params.orderId))),
  history: async (req: Request, res: Response) => {
    const q = historyQuery.parse(req.query);
    res.json({ payments: await svc.history(req.session.userId!, q.limit, q.offset) });
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
