"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = exports.IdempotencyRace = void 0;
const paymentForm_1 = require("../integrations/payu/paymentForm");
const hash_1 = require("../integrations/payu/hash");
const paymentStateMachine_1 = require("./paymentStateMachine");
const money_1 = require("../utils/money");
const ids_1 = require("../utils/ids");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
class IdempotencyRace extends Error {
}
exports.IdempotencyRace = IdempotencyRace;
const EXPIRE_AFTER_MS = 30 * 60_000;
class PaymentService {
    repo;
    gateway;
    payu;
    urls;
    constructor(repo, gateway, payu, urls) {
        this.repo = repo;
        this.gateway = gateway;
        this.payu = payu;
        this.urls = urls;
    }
    form(p, plan, user) {
        const cb = `${this.urls.backendUrl}/api/v1/payments/payu/callback?src=browser`;
        return (0, paymentForm_1.buildPaymentForm)(this.payu, {
            txnid: p.txnid, amountInRupees: (0, money_1.paiseToRupees)(p.amountInPaise), productinfo: plan.name,
            firstname: user.name, email: user.email, phone: user.phone ?? undefined,
            orderId: p.orderId, successUrl: cb, failureUrl: cb,
        });
    }
    async initiate(userId, planId, idempotencyKey) {
        const requestHash = (0, ids_1.stableHash)({ planId });
        const user = await this.repo.getUser(userId);
        if (!user)
            throw new errors_1.AppError(401, 'UNAUTHENTICATED', 'Authentication required');
        const replay = async () => {
            const rec = await this.repo.findIdempotency(userId, idempotencyKey);
            if (!rec)
                return null;
            if (rec.requestHash !== requestHash)
                throw (0, errors_1.conflict)('Idempotency-Key reused with a different request', 'IDEMPOTENCY_MISMATCH');
            const p = rec.orderId ? await this.repo.findByOrderId(rec.orderId) : null;
            if (!p)
                return null;
            const plan = await this.repo.getPlan(p.planId);
            const open = p.status === 'PENDING' || p.status === 'CREATED';
            return { orderId: p.orderId, status: p.status, replayed: true, payment: open && plan ? this.form(p, plan, user) : null };
        };
        const existing = await replay();
        if (existing)
            return existing;
        const plan = await this.repo.getPlan(planId); // authoritative price comes from DB only
        if (!plan || !plan.isActive)
            throw (0, errors_1.badRequest)('Invalid plan', 'INVALID_PLAN');
        if (plan.currency !== 'INR')
            throw (0, errors_1.badRequest)('Unsupported currency', 'INVALID_PLAN');
        let created;
        try {
            created = await this.repo.createPaymentWithIdempotency({ orderId: (0, ids_1.newOrderId)(), txnid: (0, ids_1.newTxnid)(), userId, planId: plan.id,
                amountInPaise: plan.priceInPaise, currency: plan.currency, status: 'CREATED' }, { userId, key: idempotencyKey, requestHash });
        }
        catch (e) {
            if (e instanceof IdempotencyRace) {
                const r = await replay();
                if (r)
                    return r;
            }
            throw e;
        }
        const pending = (await this.repo.transition(created.id, ['CREATED'], 'PENDING', {})) ?? created;
        await this.repo.recordEvent({ paymentId: created.id, txnid: created.txnid, source: 'api', eventType: 'INITIATED',
            fromStatus: 'CREATED', toStatus: 'PENDING', payloadHash: (0, ids_1.stableHash)({ e: 'init', id: created.id }),
            payload: { orderId: created.orderId, planId: plan.id, amountInPaise: plan.priceInPaise } });
        return { orderId: pending.orderId, status: pending.status, replayed: false, payment: this.form(pending, plan, user) };
    }
    /** Handles both the browser redirect (surl/furl) and the S2S webhook. Never trusts the callback for success. */
    async processCallback(raw, source) {
        const body = {};
        for (const [k, v] of Object.entries(raw))
            if (typeof v === 'string')
                body[k] = v;
        const received = body.hash;
        if (!received || !body.txnid || !body.status)
            return { outcome: 'rejected', reason: 'MISSING_FIELDS' };
        if (!(0, hash_1.safeEqualHex)((0, hash_1.responseHash)(body, this.payu.salt), received)) {
            logger_1.logger.warn({ txnid: body.txnid, source }, 'payu callback hash mismatch');
            return { outcome: 'rejected', reason: 'INVALID_HASH' };
        }
        if (body.key !== this.payu.key)
            return { outcome: 'rejected', reason: 'MERCHANT_MISMATCH' };
        const payment = await this.repo.findByTxnid(body.txnid);
        if (!payment) {
            logger_1.logger.warn({ txnid: body.txnid }, 'callback for unknown txnid');
            return { outcome: 'rejected', reason: 'UNKNOWN_TXN' };
        }
        if (body.udf1 !== payment.orderId)
            return { outcome: 'rejected', reason: 'ORDER_MISMATCH', orderId: payment.orderId };
        if ((0, money_1.rupeesToPaise)(body.amount ?? '') !== payment.amountInPaise) {
            logger_1.logger.error({ orderId: payment.orderId }, 'callback amount mismatch');
            return { outcome: 'rejected', reason: 'AMOUNT_MISMATCH', orderId: payment.orderId };
        }
        const payloadHash = (0, ids_1.stableHash)({ ...body, hash: undefined });
        const isNew = await this.repo.recordEvent({ paymentId: payment.id, txnid: payment.txnid, source,
            eventType: 'CALLBACK_' + body.status.toUpperCase(), fromStatus: payment.status, payloadHash,
            payload: sanitize(body) });
        if (!isNew)
            return { outcome: 'duplicate', orderId: payment.orderId, status: (await this.repo.findByTxnid(body.txnid)).status };
        const claimed = body.status.toLowerCase();
        if (claimed === 'success')
            return this.verifyAndSettle(payment, body.mihpayid);
        const target = claimed === 'pending' ? 'PENDING'
            : body.unmappedstatus === 'userCancelled' ? 'CANCELLED' // assumption: confirm value in PayU sandbox (see PAYU_INTEGRATION.md)
                : 'FAILED';
        return this.applyNonSuccess(payment, target, body.error_Message || body.error || undefined, body.mihpayid);
    }
    async applyNonSuccess(p, target, reason, mihpayid) {
        if (p.status === target)
            return { outcome: 'duplicate', orderId: p.orderId, status: p.status };
        if (target === 'PENDING' && p.status !== 'CREATED')
            return { outcome: 'duplicate', orderId: p.orderId, status: p.status };
        const updated = await this.repo.transition(p.id, (0, paymentStateMachine_1.allowedFrom)(target), target, { failureReason: reason, payuMihpayid: mihpayid });
        if (updated)
            return { outcome: 'processed', orderId: p.orderId, status: updated.status };
        const latest = (await this.repo.findByTxnid(p.txnid));
        return this.flagConflict(latest, target);
    }
    async flagConflict(p, claimed) {
        logger_1.logger.error({ orderId: p.orderId, current: p.status, claimed }, 'CONFLICTING payment callback - manual reconciliation required');
        await this.repo.recordEvent({ paymentId: p.id, txnid: p.txnid, source: 'system', eventType: 'CONFLICT',
            fromStatus: p.status, toStatus: claimed, payloadHash: (0, ids_1.stableHash)({ c: p.id, s: p.status, claimed }),
            payload: { current: p.status, claimed } });
        return { outcome: 'conflict', orderId: p.orderId, status: p.status, reason: 'CONFLICTING_STATE' };
    }
    /** Server-side verification via PayU verify_payment. The only path to SUCCESS. */
    async verifyAndSettle(p, mihpayid) {
        if ((0, paymentStateMachine_1.isTerminal)(p.status)) {
            return p.status === 'SUCCESS' ? { outcome: 'duplicate', orderId: p.orderId, status: p.status } : this.flagConflict(p, 'SUCCESS');
        }
        let v;
        try {
            v = await this.gateway.verifyTransaction(p.txnid);
        }
        catch (e) {
            logger_1.logger.error({ orderId: p.orderId, err: e.message }, 'payu verify failed');
            const u = await this.repo.transition(p.id, ['CREATED', 'PENDING', 'VERIFICATION_PENDING'], 'VERIFICATION_PENDING', {});
            return { outcome: 'processed', orderId: p.orderId, status: (u ?? p).status, reason: 'VERIFICATION_UNAVAILABLE' };
        }
        if (!v.found || v.status === 'pending') {
            const u = await this.repo.transition(p.id, ['CREATED', 'PENDING', 'VERIFICATION_PENDING'], 'VERIFICATION_PENDING', {});
            return { outcome: 'processed', orderId: p.orderId, status: (u ?? p).status, reason: 'VERIFICATION_PENDING' };
        }
        if (v.status === 'success') {
            if ((0, money_1.rupeesToPaise)(v.amount ?? '') !== p.amountInPaise) {
                logger_1.logger.error({ orderId: p.orderId }, 'verify amount mismatch');
                await this.repo.transition(p.id, ['CREATED', 'PENDING', 'VERIFICATION_PENDING'], 'FAILED', { failureReason: 'AMOUNT_MISMATCH_ON_VERIFY' });
                return { outcome: 'rejected', orderId: p.orderId, status: 'FAILED', reason: 'AMOUNT_MISMATCH' };
            }
            const done = await this.repo.succeedAndActivate(p.id, ['CREATED', 'PENDING', 'VERIFICATION_PENDING'], v.mihpayid ?? mihpayid);
            if (done)
                return { outcome: 'processed', orderId: p.orderId, status: 'SUCCESS' };
            const latest = (await this.repo.findByTxnid(p.txnid));
            return latest.status === 'SUCCESS' ? { outcome: 'duplicate', orderId: p.orderId, status: 'SUCCESS' } : this.flagConflict(latest, 'SUCCESS');
        }
        // verify says failure/other: PayU's own record wins over the callback's claim
        return this.applyNonSuccess(p, 'FAILED', 'VERIFY_REPORTED_' + v.status.toUpperCase(), v.mihpayid);
    }
    async status(userId, orderId) {
        let p = await this.repo.findByOrderId(orderId);
        if (!p || p.userId !== userId)
            throw (0, errors_1.notFound)('Order not found');
        if (p.status === 'PENDING' || p.status === 'VERIFICATION_PENDING')
            p = await this.reconcile(p);
        return { orderId: p.orderId, status: p.status, amountInPaise: p.amountInPaise, currency: p.currency, createdAt: p.createdAt };
    }
    /** Pull-based reconciliation for delayed/missed callbacks. */
    async reconcile(p) {
        try {
            const v = await this.gateway.verifyTransaction(p.txnid);
            if (v.found && v.status === 'success')
                await this.verifyAndSettle(p, v.mihpayid);
            else if (v.found && v.status !== 'pending')
                await this.applyNonSuccess(p, 'FAILED', 'VERIFY_REPORTED_' + v.status.toUpperCase(), v.mihpayid);
            else if (!v.found && Date.now() - p.createdAt.getTime() > EXPIRE_AFTER_MS)
                await this.repo.transition(p.id, ['PENDING', 'VERIFICATION_PENDING'], 'EXPIRED', { failureReason: 'NO_PAYU_RECORD' });
        }
        catch (e) {
            logger_1.logger.warn({ orderId: p.orderId, err: e.message }, 'reconcile skipped');
        }
        return (await this.repo.findByOrderId(p.orderId)) ?? p;
    }
    async history(userId, limit = 20, offset = 0) {
        const rows = await this.repo.listByUser(userId, Math.min(limit, 50), offset);
        return rows.map((r) => ({ orderId: r.orderId, status: r.status, amountInPaise: r.amountInPaise, currency: r.currency, planId: r.planId, createdAt: r.createdAt }));
    }
}
exports.PaymentService = PaymentService;
/** Strip anything card-related and the hash before persisting a callback for audit. */
function sanitize(b) {
    const { hash: _h, cardnum: _c, card_no: _c2, name_on_card: _n, ...rest } = b;
    return rest;
}
