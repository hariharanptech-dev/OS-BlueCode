"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentController = exports.subscriptionController = exports.planController = void 0;
const schemas_1 = require("../validators/schemas");
const errors_1 = require("../utils/errors");
const money_1 = require("../utils/money");
const planDto = (p) => ({ id: p.id, code: p.code, name: p.name, price: (0, money_1.paiseToRupees)(p.priceInPaise), currency: p.currency, durationDays: p.durationDays });
const planController = (repo) => ({
    list: async (_q, res) => res.json({ plans: (await repo.listPlans()).map(planDto) }),
    get: async (req, res) => {
        const p = await repo.getPlan(req.params.planId);
        if (!p || !p.isActive)
            throw (0, errors_1.notFound)('Plan not found');
        res.json({ plan: planDto(p) });
    },
});
exports.planController = planController;
const subscriptionController = (svc) => ({
    mine: async (req, res) => res.json({ subscription: await svc.getMine(req.session.userId) }),
});
exports.subscriptionController = subscriptionController;
const paymentController = (svc, cfg) => ({
    initiate: async (req, res) => {
        const key = schemas_1.idempotencyKeySchema.safeParse(req.header('idempotency-key'));
        if (!key.success)
            throw (0, errors_1.badRequest)('Idempotency-Key header (16-64 chars) is required', 'IDEMPOTENCY_KEY_REQUIRED');
        const { planId } = schemas_1.initiateSchema.parse(req.body); // price/user are never read from the client
        res.status(201).json(await svc.initiate(req.session.userId, planId, key.data));
    },
    status: async (req, res) => res.json(await svc.status(req.session.userId, schemas_1.orderIdParam.parse(req.params.orderId))),
    history: async (req, res) => {
        const q = schemas_1.historyQuery.parse(req.query);
        res.json({ payments: await svc.history(req.session.userId, q.limit, q.offset) });
    },
    /** PayU posts form-urlencoded. Browser flow (src=browser) -> 303 to frontend; S2S webhook -> JSON. */
    callback: async (req, res) => {
        const browser = req.query.src === 'browser';
        const r = await svc.processCallback(req.body ?? {}, browser ? 'browser' : 'webhook');
        if (browser) {
            const u = new URL('/payment/result', cfg.frontendUrl);
            if (r.orderId)
                u.searchParams.set('orderId', r.orderId); // display hint only; the page must call /status
            return res.redirect(303, u.toString());
        }
        if (r.outcome === 'rejected')
            return res.status(400).json({ ok: false, reason: r.reason });
        res.status(200).json({ ok: true, outcome: r.outcome });
    },
});
exports.paymentController = paymentController;
