// Updated error handling – now uses structured errors from the cybersecurity module
import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, toErrorResponse } from '../security/errors';
import { logger } from '../utils/logger';

export const notFoundHandler = (_req: Request, res: Response) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // Generate a requestId for tracing (fallback to a random string)
  const requestId = (req.headers['x-request-id'] as string) || Math.random().toString(36).substring(2, 15);

  // Preserve Zod validation handling – it will be wrapped into AppError by toErrorResponse
  if (err instanceof ZodError) {
    err = new AppError('VALIDATION_FAILED', { internal: { issues: err.issues } });
  }

  const { status, headers, body } = toErrorResponse(err, requestId);

  // Log the original error (including stack) with correlation ID
  logger.error({ requestId, err: (err as Error)?.message, stack: (err as Error)?.stack, path: req.path }, 'error handler');

  // Apply any additional response headers (e.g., Retry‑After)
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  res.status(status).json(body);
}
