import { NextFunction, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { unauthorized, AppError } from '../utils/errors';

declare module 'express-session' { interface SessionData { userId?: string; csrf?: string } }

export const requireAuth = (req: Request, _res: Response, next: NextFunction) =>
  req.session.userId ? next() : next(unauthorized());

export const ensureCsrfToken = (req: Request) => (req.session.csrf ??= randomBytes(32).toString('hex'));

/** Synchronizer-token CSRF for session-authenticated, state-changing routes. PayU callback is exempt (no session; hash-authenticated). */
export const csrfProtect = (req: Request, _res: Response, next: NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const a = Buffer.from(String(req.header('x-csrf-token') ?? ''));
  const b = Buffer.from(req.session.csrf ?? '');
  if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) return next(new AppError('CSRF_FAILED'));
  next();
};
