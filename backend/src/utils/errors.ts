/**
 * Backward-compatibility re-export.
 * All existing imports of `../utils/errors` continue to work without modification.
 * The real implementation lives in appError.ts → ../security/errors.
 */
export { AppError, toErrorResponse, ERROR_CATALOG, badRequest, unauthorized, notFound, conflict } from './appError';
export type { ErrorCode, ErrorResponse } from './appError';
