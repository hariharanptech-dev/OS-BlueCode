"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = void 0;
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
const notFoundHandler = (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
exports.notFoundHandler = notFoundHandler;
function errorHandler(err, req, res, _next) {
    if (err instanceof zod_1.ZodError)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid input', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    if (err instanceof errors_1.AppError)
        return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    logger_1.logger.error({ err: err?.message, stack: err?.stack, path: req.path }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }); // never leak internals
}
