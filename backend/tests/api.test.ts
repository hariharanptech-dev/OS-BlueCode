/**
 * HTTP-level Jest tests (supertest). NOT EXECUTED in the authoring sandbox (no npm registry access).
 * Run with `npm test` after `npm install`. They mount the real router with stubbed controllers' dependencies.
 */
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { buildRoutes } from '../src/routes';
import { errorHandler } from '../src/middleware/errorHandler';
import { paymentController } from '../src/controllers/paymentController';

const cfg: any = { frontendUrl: 'http://localhost:5173' };
const fakeSvc: any = { initiate: jest.fn(), status: jest.fn(), history: jest.fn(),
  processCallback: jest.fn().mockResolvedValue({ outcome: 'rejected', reason: 'INVALID_HASH' }) };
const noop = { register: jest.fn(), login: jest.fn(), logout: jest.fn(), me: jest.fn() } as any;

function app(userId?: string) {
  const a = express();
  a.use(express.json());
  a.use(session({ secret: 'x'.repeat(32), resave: false, saveUninitialized: true }));
  a.use((req, _r, n) => { if (userId) { req.session.userId = userId; req.session.csrf = 'tok'; } n(); });
  a.use('/api/v1', buildRoutes({ auth: noop, plans: { list: jest.fn(), get: jest.fn() } as any,
    subs: { mine: jest.fn() } as any, pay: paymentController(fakeSvc, cfg) }));
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
    const r = await request(app('u1')).post('/api/v1/payments/initiate').set('x-csrf-token', 'tok')
      .send({ planId: '11111111-1111-4111-8111-111111111111' }).expect(400);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('ignores client-supplied amount (strict schema rejects extra fields)', async () => {
    await request(app('u1')).post('/api/v1/payments/initiate').set('x-csrf-token', 'tok').set('idempotency-key', 'k'.repeat(20))
      .send({ planId: '11111111-1111-4111-8111-111111111111', amount: 1 }).expect(400);
  });
  it('webhook with a bad hash gets 400 and needs no session', async () => {
    await request(app()).post('/api/v1/payments/payu/callback').type('form').send({ txnid: 't', status: 'success', hash: 'bad' }).expect(400);
  });
  it('browser callback redirects (303) to the frontend result page', async () => {
    fakeSvc.processCallback.mockResolvedValueOnce({ outcome: 'processed', orderId: 'ORD-A-00000000', status: 'SUCCESS' });
    const r = await request(app()).post('/api/v1/payments/payu/callback?src=browser').type('form').send({ txnid: 't' }).expect(303);
    expect(r.headers.location).toContain('/payment/result?orderId=ORD-A-00000000');
  });
});
