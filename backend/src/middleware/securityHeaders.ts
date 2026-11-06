import { Request, Response, NextFunction } from 'express';
import { applySecurityHeaders } from '../security/http-guards';

/**
 * Production: CSP form-action allows only the live PayU endpoint (https://secure.payu.in).
 * Development/test: also permits https://test.payu.in for sandbox testing.
 * The list is derived from NODE_ENV so no manual toggle is needed — just set the env variable.
 */
export function securityHeaders(isProd: boolean) {
  const formOrigins = isProd
    ? ['https://secure.payu.in']
    : ['https://test.payu.in', 'https://secure.payu.in'];

  return (_req: Request, res: Response, next: NextFunction) => {
    applySecurityHeaders(res, {
      hsts: isProd,
      formActionOrigins: formOrigins,
    });
    next();
  };
}
