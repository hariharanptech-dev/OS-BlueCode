"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callbackLimiter = exports.paymentLimiter = exports.authLimiter = exports.globalLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const base = { standardHeaders: true, legacyHeaders: false };
exports.globalLimiter = (0, express_rate_limit_1.default)({ ...base, windowMs: 60_000, limit: 120 });
exports.authLimiter = (0, express_rate_limit_1.default)({ ...base, windowMs: 15 * 60_000, limit: 20 });
exports.paymentLimiter = (0, express_rate_limit_1.default)({ ...base, windowMs: 60_000, limit: 15 });
exports.callbackLimiter = (0, express_rate_limit_1.default)({ ...base, windowMs: 60_000, limit: 120 });
