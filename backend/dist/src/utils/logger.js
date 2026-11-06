"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
/** Dependency-free structured JSON logger with secret redaction. */
const SECRET_KEYS = new Set(['password', 'hash', 'salt', 'cardnum', 'card_no', 'name_on_card', 'cookie', 'authorization', 'merchant_salt']);
const redact = (v, depth = 0) => {
    if (depth > 4 || v === null || typeof v !== 'object')
        return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(x, depth + 1)]));
};
const emit = (level, ctx, msg) => {
    if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS)
        return;
    const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...redact(ctx) });
    (level === 'error' || level === 'warn' ? console.error : console.log)(line);
};
exports.logger = {
    info: (ctx, msg) => emit('info', ctx, msg),
    warn: (ctx, msg) => emit('warn', ctx, msg),
    error: (ctx, msg) => emit('error', ctx, msg),
};
