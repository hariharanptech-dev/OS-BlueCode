"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.csrfProtect = exports.ensureCsrfToken = exports.requireAuth = void 0;
const crypto_1 = require("crypto");
const errors_1 = require("../utils/errors");
const requireAuth = (req, _res, next) => req.session.userId ? next() : next((0, errors_1.unauthorized)());
exports.requireAuth = requireAuth;
const ensureCsrfToken = (req) => (req.session.csrf ??= (0, crypto_1.randomBytes)(32).toString('hex'));
exports.ensureCsrfToken = ensureCsrfToken;
/** Synchronizer-token CSRF for session-authenticated, state-changing routes. PayU callback is exempt (no session; hash-authenticated). */
const csrfProtect = (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
        return next();
    const a = Buffer.from(String(req.header('x-csrf-token') ?? ''));
    const b = Buffer.from(req.session.csrf ?? '');
    if (!b.length || a.length !== b.length || !(0, crypto_1.timingSafeEqual)(a, b))
        return next(new errors_1.AppError(403, 'CSRF', 'Invalid CSRF token'));
    next();
};
exports.csrfProtect = csrfProtect;
