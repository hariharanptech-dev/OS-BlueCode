import rateLimit from 'express-rate-limit';
const base = { standardHeaders: true, legacyHeaders: false };
export const globalLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 120 });
export const authLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 20 });
export const paymentLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 15 });
export const callbackLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 120 });
