import { Router, urlencoded } from 'express';
import { authController } from '../controllers/authController';
import { paymentController, planController, subscriptionController } from '../controllers/paymentController';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { authLimiter, callbackLimiter, paymentLimiter } from '../middleware/rateLimit';

const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

export function buildRoutes(d: { auth: ReturnType<typeof authController>; plans: ReturnType<typeof planController>;
  subs: ReturnType<typeof subscriptionController>; pay: ReturnType<typeof paymentController> }) {
  const r = Router();
  r.post('/auth/register', authLimiter, wrap(d.auth.register));
  r.post('/auth/login', authLimiter, wrap(d.auth.login));
  r.post('/auth/logout', requireAuth, csrfProtect, d.auth.logout);
  r.get('/auth/me', wrap(d.auth.me));

  r.get('/plans', wrap(d.plans.list));
  r.get('/plans/:planId', wrap(d.plans.get));
  r.get('/subscriptions/me', requireAuth, wrap(d.subs.mine));

  r.post('/payments/initiate', paymentLimiter, requireAuth, csrfProtect, wrap(d.pay.initiate));
  r.get('/payments/history', requireAuth, wrap(d.pay.history));
  r.get('/payments/:orderId/status', paymentLimiter, requireAuth, wrap(d.pay.status));

  // Session-less on purpose: PayU posts cross-site; authenticity = reverse hash + server-side verify.
  r.post('/payments/payu/callback', callbackLimiter, urlencoded({ extended: false, limit: '32kb' }), wrap(d.pay.callback));
  return r;
}
