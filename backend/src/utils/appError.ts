/**
 * Compatibility shim: re-exports the structured AppError from the security module
 * and provides factory helpers supporting both new and legacy calling conventions.
 */
export { AppError, toErrorResponse, ERROR_CATALOG } from '../security/errors';
export type { ErrorCode, ErrorResponse } from '../security/errors';

import { AppError } from '../security/errors';

/** Maps to 400 Bad Request with specified code or VALIDATION_FAILED */
export const badRequest = (m: string, c = 'VALIDATION_FAILED') =>
  new AppError(400, c, m);

/** Maps to 401 Unauthorized */
export const unauthorized = () => new AppError('AUTH_REQUIRED');

/** Maps to 404 Not Found */
export const notFound = (m = 'Not found') =>
  new AppError(404, 'NOT_FOUND', m);

/** Maps to 409 Conflict with specified code or CONFLICT */
export const conflict = (m: string, c = 'CONFLICT') =>
  new AppError(409, c, m);
