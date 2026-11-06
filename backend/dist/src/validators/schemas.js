"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.historyQuery = exports.orderIdParam = exports.idempotencyKeySchema = exports.initiateSchema = exports.loginSchema = exports.registerSchema = void 0;
const zod_1 = require("zod");
exports.registerSchema = zod_1.z.object({
    email: zod_1.z.string().email().max(254).transform((s) => s.toLowerCase()),
    name: zod_1.z.string().trim().min(1).max(80),
    phone: zod_1.z.string().regex(/^[0-9+\- ]{7,15}$/).optional(),
    password: zod_1.z.string().min(10).max(128),
});
exports.loginSchema = zod_1.z.object({ email: zod_1.z.string().email().transform((s) => s.toLowerCase()), password: zod_1.z.string().min(1).max(128) });
exports.initiateSchema = zod_1.z.object({ planId: zod_1.z.string().uuid() }).strict();
exports.idempotencyKeySchema = zod_1.z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/);
exports.orderIdParam = zod_1.z.string().regex(/^ORD-[A-Z0-9]+-[A-F0-9]{8}$/);
exports.historyQuery = zod_1.z.object({ limit: zod_1.z.coerce.number().int().min(1).max(50).default(20), offset: zod_1.z.coerce.number().int().min(0).default(0) });
