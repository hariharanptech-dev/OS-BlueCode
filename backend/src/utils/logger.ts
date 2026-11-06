import { Logger, consoleSink } from '../security/logger';

const secrets = [
  process.env.PAYU_MERCHANT_SALT,
  process.env.SESSION_SECRET,
  process.env.PAYU_MERCHANT_KEY,
].filter((s): s is string => typeof s === 'string' && s.length >= 6);

const baseLogger = new Logger(consoleSink, { secrets });

export const logger = {
  info: (ctxOrEvent: string | Record<string, unknown>, msgOrFields?: string | Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS) return;
    if (typeof ctxOrEvent === 'string') {
      baseLogger.info(ctxOrEvent, (msgOrFields as Record<string, unknown>) ?? {});
    } else {
      baseLogger.info(typeof msgOrFields === 'string' ? msgOrFields : 'info', ctxOrEvent);
    }
  },
  warn: (ctxOrEvent: string | Record<string, unknown>, msgOrFields?: string | Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS) return;
    if (typeof ctxOrEvent === 'string') {
      baseLogger.warn(ctxOrEvent, (msgOrFields as Record<string, unknown>) ?? {});
    } else {
      baseLogger.warn(typeof msgOrFields === 'string' ? msgOrFields : 'warn', ctxOrEvent);
    }
  },
  error: (ctxOrEvent: string | Record<string, unknown>, msgOrFields?: string | Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS) return;
    if (typeof ctxOrEvent === 'string') {
      baseLogger.error(ctxOrEvent, (msgOrFields as Record<string, unknown>) ?? {});
    } else {
      baseLogger.error(typeof msgOrFields === 'string' ? msgOrFields : 'error', ctxOrEvent);
    }
  },
  security: (event: string, fields: Record<string, unknown> = {}) => {
    baseLogger.security(event, fields);
  },
};
