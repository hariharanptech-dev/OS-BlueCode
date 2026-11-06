"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conflict = exports.notFound = exports.unauthorized = exports.badRequest = exports.AppError = void 0;
class AppError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
exports.AppError = AppError;
const badRequest = (m, c = 'BAD_REQUEST') => new AppError(400, c, m);
exports.badRequest = badRequest;
const unauthorized = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
exports.unauthorized = unauthorized;
const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
exports.notFound = notFound;
const conflict = (m, c = 'CONFLICT') => new AppError(409, c, m);
exports.conflict = conflict;
