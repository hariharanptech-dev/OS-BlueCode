/** Dependency-free structured JSON logger with secret redaction. */
const SECRET_KEYS = new Set(['password', 'hash', 'salt', 'cardnum', 'card_no', 'name_on_card', 'cookie', 'authorization', 'merchant_salt']);
const redact = (v: unknown, depth = 0): unknown => {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(x, depth + 1)]));
};
const emit = (level: string, ctx: unknown, msg: string) => {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...(redact(ctx) as object) });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
};
export const logger = {
  info: (ctx: object, msg: string) => emit('info', ctx, msg),
  warn: (ctx: object, msg: string) => emit('warn', ctx, msg),
  error: (ctx: object, msg: string) => emit('error', ctx, msg),
};
