/**
 * Structured error strategy.
 * - Every failure has a stable machine-readable `code`.
 * - `publicMessage` is the ONLY text ever sent to clients.
 * - `internal` carries diagnostic detail for logs and is never serialised to responses.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_THROTTLED'
  | 'RATE_LIMITED'
  | 'CSRF_FAILED'
  | 'FORBIDDEN_ORIGIN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'EMAIL_UNAVAILABLE'
  | 'PLAN_INVALID'
  | 'SUBSCRIPTION_ACTIVE'
  | 'IDEMPOTENCY_KEY_USED'
  | 'PAYMENT_INIT_FAILED'
  | 'INVALID_CALLBACK'
  | 'GATEWAY_UNAVAILABLE'
  | 'DB_UNAVAILABLE'
  | 'INTERNAL_ERROR';

interface CatalogEntry {
  status: number;
  message: string;
}

export const ERROR_CATALOG: Record<ErrorCode, CatalogEntry> = {
  VALIDATION_FAILED: { status: 400, message: 'Some of the information provided is not valid. Please check the highlighted fields.' },
  AUTH_REQUIRED: { status: 401, message: 'Please sign in to continue.' },
  SESSION_EXPIRED: { status: 401, message: 'Your session has expired. Please sign in again.' },
  INVALID_CREDENTIALS: { status: 401, message: 'The email or password is incorrect.' },
  ACCOUNT_THROTTLED: { status: 429, message: 'Too many sign-in attempts. Please wait a while and try again.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please slow down and try again shortly.' },
  CSRF_FAILED: { status: 403, message: 'Your request could not be verified. Please refresh the page and try again.' },
  FORBIDDEN_ORIGIN: { status: 403, message: 'This request is not allowed from this origin.' },
  NOT_FOUND: { status: 404, message: 'We could not find what you were looking for.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'This action is not supported.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The request is too large.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'The request format is not supported.' },
  EMAIL_UNAVAILABLE: { status: 409, message: 'We could not create an account with these details.' },
  PLAN_INVALID: { status: 400, message: 'The selected plan is not available.' },
  SUBSCRIPTION_ACTIVE: { status: 409, message: 'You already have an active subscription. You can renew shortly before it ends.' },
  IDEMPOTENCY_KEY_USED: { status: 409, message: 'This payment attempt has already been completed. Please start a new payment.' },
  PAYMENT_INIT_FAILED: { status: 502, message: 'We could not start your payment. You have not been charged. Please try again.' },
  INVALID_CALLBACK: { status: 400, message: 'The payment response could not be verified.' },
  GATEWAY_UNAVAILABLE: { status: 503, message: 'The payment service is temporarily unavailable. If you were charged, your subscription will be activated automatically once confirmed.' },
  DB_UNAVAILABLE: { status: 503, message: 'The service is temporarily unavailable. Please try again in a moment.' },
  INTERNAL_ERROR: { status: 500, message: 'Something went wrong on our side. Please try again later.' },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly internal: Record<string, unknown> | undefined;
  readonly retryAfterSec: number | undefined;
  readonly fieldErrors: Array<{ path: string; reason: string }> | undefined;

  constructor(
    codeOrStatus: ErrorCode | number,
    optsOrCode?: {
      internal?: Record<string, unknown>;
      retryAfterSec?: number;
      fieldErrors?: Array<{ path: string; reason: string }>;
      cause?: unknown;
      message?: string;
    } | string,
    legacyMessage?: string
  ) {
    if (typeof codeOrStatus === 'number') {
      const status = codeOrStatus;
      const code = (typeof optsOrCode === 'string' ? optsOrCode : 'INTERNAL_ERROR') as ErrorCode;
      const message = legacyMessage ?? (typeof optsOrCode === 'string' ? optsOrCode : 'An error occurred');
      super(message);
      this.name = 'AppError';
      this.code = code;
      this.status = status;
      this.publicMessage = message;
    } else {
      const code = codeOrStatus;
      const opts = (typeof optsOrCode === 'object' && optsOrCode !== null ? optsOrCode : {}) as {
        internal?: Record<string, unknown>;
        retryAfterSec?: number;
        fieldErrors?: Array<{ path: string; reason: string }>;
        cause?: unknown;
        message?: string;
      };
      super(code, opts.cause !== undefined ? { cause: opts.cause } : undefined);
      this.name = 'AppError';
      this.code = code;
      const catalog = ERROR_CATALOG[code];
      this.status = catalog ? catalog.status : 500;
      this.publicMessage = opts.message ?? (catalog ? catalog.message : 'An error occurred');
      this.internal = opts.internal;
      this.retryAfterSec = opts.retryAfterSec;
      this.fieldErrors = opts.fieldErrors;
    }
  }
}

export interface ErrorResponse {
  status: number;
  headers: Record<string, string>;
  body: { error: { code: ErrorCode; message: string; requestId: string; fields?: Array<{ path: string; reason: string }> } };
}

/** Converts ANY thrown value into a safe client response. Unknown errors collapse to INTERNAL_ERROR. */
export function toErrorResponse(err: unknown, requestId: string): ErrorResponse {
  const appErr = err instanceof AppError ? err : new AppError('INTERNAL_ERROR');
  const headers: Record<string, string> = {};
  if (appErr.retryAfterSec !== undefined) headers['Retry-After'] = String(Math.max(1, Math.ceil(appErr.retryAfterSec)));
  const error: ErrorResponse['body']['error'] = { code: appErr.code, message: appErr.publicMessage, requestId };
  if (appErr.fieldErrors?.length) error.fields = appErr.fieldErrors;
  return { status: appErr.status, headers, body: { error } };
}
