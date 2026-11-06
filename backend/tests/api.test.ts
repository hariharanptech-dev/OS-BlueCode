/**
 * HTTP-level Jest tests (supertest).
 * Run with `npm test`. They mount the real router with stubbed controllers' dependencies.
 */
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { buildRoutes } from '../src/routes';
import { errorHandler } from '../src/middleware/errorHandler';
import { paymentController, planController, subscriptionController } from '../src/controllers/paymentController';

const cfg: any = { frontendUrl: 'http://localhost:5173' };
const fakeSvc: any = {
  initiate: jest.fn(),
  status: jest.fn(),
  history: jest.fn().mockResolvedValue([
    {
      orderId: 'ORD-123456-ABCDEF01',
      status: 'SUCCESS',
      amountInPaise: 49900,
      currency: 'INR',
      planId: 'plan-1',
      createdAt: new Date('2026-11-06T10:00:00Z'),
      verifiedAt: new Date('2026-11-06T10:05:00Z'),
      payuMihpayid: 'mih-999',
    },
  ]),
  processCallback: jest.fn().mockResolvedValue({ outcome: 'rejected', reason: 'INVALID_HASH' }),
};

const fakeAuth: any = {
  register: jest.fn().mockResolvedValue({ id: 'u1', email: 'test@example.com', name: 'Test User' }),
  login: jest.fn().mockResolvedValue({ id: 'u1', email: 'test@example.com', name: 'Test User' }),
  logout: jest.fn((req, res) => res.status(204).end()),
  me: jest.fn().mockResolvedValue({ id: 'u1', email: 'test@example.com', name: 'Test User' }),
  forgotPassword: jest.fn().mockResolvedValue({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' }),
  resetPassword: jest.fn().mockResolvedValue({ ok: true, message: 'Password updated successfully' }),
  changePassword: jest.fn().mockResolvedValue({ ok: true, message: 'Password updated successfully' }),
};

const fakeRepo: any = {
  listPlans: jest.fn().mockResolvedValue([
    {
      id: 'plan-1',
      code: 'PRO_MONTHLY',
      name: 'Pro Monthly',
      description: 'Full access',
      priceInPaise: 49900,
      currency: 'INR',
      durationDays: 30,
      isActive: true,
      features: ['Feature 1', 'Feature 2'],
    },
  ]),
  getPlan: jest.fn().mockResolvedValue({
    id: 'plan-1',
    code: 'PRO_MONTHLY',
    name: 'Pro Monthly',
    description: 'Full access',
    priceInPaise: 49900,
    currency: 'INR',
    durationDays: 30,
    isActive: true,
  }),
};

const fakeSubs: any = {
  getMine: jest.fn().mockResolvedValue({
    id: 'sub-1',
    planName: 'Pro Monthly',
    status: 'ACTIVE',
    startsAt: new Date('2026-11-06T00:00:00Z'),
    expiresAt: new Date('2026-12-06T00:00:00Z'),
  }),
};

function app(userId?: string) {
  const a = express();
  a.use(express.json());
  a.use(session({ secret: 'x'.repeat(32), resave: false, saveUninitialized: true }));
  a.use((req, _r, n) => {
    if (userId) {
      req.session.userId = userId;
      req.session.csrf = 'tok';
    }
    n();
  });
  a.use(
    '/api/v1',
    buildRoutes({
      auth: fakeAuth,
      plans: planController(fakeRepo),
      subs: subscriptionController(fakeSubs),
      pay: paymentController(fakeSvc, cfg),
    }),
  );
  a.use(errorHandler);
  return a;
}

describe('payments HTTP layer', () => {
  it('rejects unauthenticated initiate with 401', async () => {
    await request(app()).post('/api/v1/payments/initiate').send({ planId: 'x' }).expect(401);
  });
  it('rejects authenticated initiate without CSRF token with 403', async () => {
    await request(app('u1')).post('/api/v1/payments/initiate').send({}).expect(403);
  });
  it('requires Idempotency-Key', async () => {
    const r = await request(app('u1'))
      .post('/api/v1/payments/initiate')
      .set('x-csrf-token', 'tok')
      .send({ planId: '11111111-1111-4111-8111-111111111111' })
      .expect(400);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('ignores client-supplied amount (strict schema rejects extra fields)', async () => {
    await request(app('u1'))
      .post('/api/v1/payments/initiate')
      .set('x-csrf-token', 'tok')
      .set('idempotency-key', 'k'.repeat(20))
      .send({ planId: '11111111-1111-4111-8111-111111111111', amount: 1 })
      .expect(400);
  });
  it('webhook with a bad hash gets 400 and needs no session', async () => {
    await request(app()).post('/api/v1/payments/payu/callback').type('form').send({ txnid: 't', status: 'success', hash: 'bad' }).expect(400);
  });
  it('browser callback redirects (303) to the frontend result page', async () => {
    fakeSvc.processCallback.mockResolvedValueOnce({ outcome: 'processed', orderId: 'ORD-A-00000000', status: 'SUCCESS' });
    const r = await request(app()).post('/api/v1/payments/payu/callback?src=browser').type('form').send({ txnid: 't' }).expect(303);
    expect(r.headers.location).toContain('/payment/result?orderId=ORD-A-00000000');
  });
  it('serves plans list with descriptions and formatted prices', async () => {
    const r = await request(app()).get('/api/v1/plans').expect(200);
    expect(r.body.plans).toBeDefined();
    expect(r.body.plans.length).toBe(1);
    expect(r.body.plans[0].amountLabel).toBe('INR 499.00');
  });
  it('serves user current subscription details', async () => {
    const r = await request(app('u1')).get('/api/v1/subscriptions/me').expect(200);
    expect(r.body.status).toBe('ACTIVE');
    expect(r.body.planName).toBe('Pro Monthly');
  });
  it('serves paginated payment history with items and pagination details', async () => {
    const r = await request(app('u1')).get('/api/v1/payments/history?page=1').expect(200);
    expect(r.body.items).toBeDefined();
    expect(r.body.items.length).toBe(1);
    expect(r.body.items[0].orderId).toBe('ORD-123456-ABCDEF01');
    expect(r.body.page).toBe(1);
    expect(r.body.pageCount).toBe(1);
  });
  it('handles forgot-password route', async () => {
    const r = await request(app()).post('/api/v1/auth/forgot-password').send({ email: 'user@example.com' }).expect(200);
    expect(r.body.ok).toBe(true);
  });
});
