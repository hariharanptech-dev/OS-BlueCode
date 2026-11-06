"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * HTTP-level Jest tests (supertest). NOT EXECUTED in the authoring sandbox (no npm registry access).
 * Run with `npm test` after `npm install`. They mount the real router with stubbed controllers' dependencies.
 */
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const supertest_1 = __importDefault(require("supertest"));
const routes_1 = require("../src/routes");
const errorHandler_1 = require("../src/middleware/errorHandler");
const paymentController_1 = require("../src/controllers/paymentController");
const cfg = { frontendUrl: 'http://localhost:5173' };
const fakeSvc = { initiate: jest.fn(), status: jest.fn(), history: jest.fn(),
    processCallback: jest.fn().mockResolvedValue({ outcome: 'rejected', reason: 'INVALID_HASH' }) };
const noop = { register: jest.fn(), login: jest.fn(), logout: jest.fn(), me: jest.fn() };
function app(userId) {
    const a = (0, express_1.default)();
    a.use(express_1.default.json());
    a.use((0, express_session_1.default)({ secret: 'x'.repeat(32), resave: false, saveUninitialized: true }));
    a.use((req, _r, n) => { if (userId) {
        req.session.userId = userId;
        req.session.csrf = 'tok';
    } n(); });
    a.use('/api/v1', (0, routes_1.buildRoutes)({ auth: noop, plans: { list: jest.fn(), get: jest.fn() },
        subs: { mine: jest.fn() }, pay: (0, paymentController_1.paymentController)(fakeSvc, cfg) }));
    a.use(errorHandler_1.errorHandler);
    return a;
}
describe('payments HTTP layer', () => {
    it('rejects unauthenticated initiate with 401', async () => {
        await (0, supertest_1.default)(app()).post('/api/v1/payments/initiate').send({ planId: 'x' }).expect(401);
    });
    it('rejects authenticated initiate without CSRF token with 403', async () => {
        await (0, supertest_1.default)(app('u1')).post('/api/v1/payments/initiate').send({}).expect(403);
    });
    it('requires Idempotency-Key', async () => {
        const r = await (0, supertest_1.default)(app('u1')).post('/api/v1/payments/initiate').set('x-csrf-token', 'tok')
            .send({ planId: '11111111-1111-4111-8111-111111111111' }).expect(400);
        expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });
    it('ignores client-supplied amount (strict schema rejects extra fields)', async () => {
        await (0, supertest_1.default)(app('u1')).post('/api/v1/payments/initiate').set('x-csrf-token', 'tok').set('idempotency-key', 'k'.repeat(20))
            .send({ planId: '11111111-1111-4111-8111-111111111111', amount: 1 }).expect(400);
    });
    it('webhook with a bad hash gets 400 and needs no session', async () => {
        await (0, supertest_1.default)(app()).post('/api/v1/payments/payu/callback').type('form').send({ txnid: 't', status: 'success', hash: 'bad' }).expect(400);
    });
    it('browser callback redirects (303) to the frontend result page', async () => {
        fakeSvc.processCallback.mockResolvedValueOnce({ outcome: 'processed', orderId: 'ORD-A-00000000', status: 'SUCCESS' });
        const r = await (0, supertest_1.default)(app()).post('/api/v1/payments/payu/callback?src=browser').type('form').send({ txnid: 't' }).expect(303);
        expect(r.headers.location).toContain('/payment/result?orderId=ORD-A-00000000');
    });
});
