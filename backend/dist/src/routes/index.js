"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRoutes = buildRoutes;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function buildRoutes(d) {
    const r = (0, express_1.Router)();
    r.post('/auth/register', rateLimit_1.authLimiter, wrap(d.auth.register));
    r.post('/auth/login', rateLimit_1.authLimiter, wrap(d.auth.login));
    r.post('/auth/logout', auth_1.requireAuth, auth_1.csrfProtect, d.auth.logout);
    r.get('/auth/me', wrap(d.auth.me));
    r.get('/plans', wrap(d.plans.list));
    r.get('/plans/:planId', wrap(d.plans.get));
    r.get('/subscriptions/me', auth_1.requireAuth, wrap(d.subs.mine));
    r.post('/payments/initiate', rateLimit_1.paymentLimiter, auth_1.requireAuth, auth_1.csrfProtect, wrap(d.pay.initiate));
    r.get('/payments/history', auth_1.requireAuth, wrap(d.pay.history));
    r.get('/payments/:orderId/status', rateLimit_1.paymentLimiter, auth_1.requireAuth, wrap(d.pay.status));
    // Session-less on purpose: PayU posts cross-site; authenticity = reverse hash + server-side verify.
    r.post('/payments/payu/callback', rateLimit_1.callbackLimiter, (0, express_1.urlencoded)({ extended: false, limit: '32kb' }), wrap(d.pay.callback));
    return r;
}
