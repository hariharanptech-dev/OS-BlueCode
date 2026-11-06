import { z } from 'zod';
import { AppError } from './errors.ts';

/** Throws AppError(VALIDATION_FAILED) listing field paths + generic reasons only (never echoes input). */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data as z.infer<S>;
  const fieldErrors = r.error.issues.slice(0, 10).map((i) => ({
    path: i.path.join('.') || '(body)',
    reason: i.code === 'unrecognized_keys' ? 'unexpected field' : i.code === 'invalid_type' ? 'wrong type or missing' : 'invalid value',
  }));
  throw new AppError('VALIDATION_FAILED', { fieldErrors });
}

const personName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[\p{L}][\p{L}\p{M} .'-]*$/u, 'name has unsupported characters');

const email = z.string().trim().toLowerCase().max(254).email();
const phone = z.string().trim().regex(/^\+?[0-9]{10,13}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const planId = z.string().regex(/^[a-z0-9_]{1,40}$/);

export const registerSchema = z.object({ name: personName, email, password: z.string().min(1).max(128) }).strict();
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const checkoutSchema = z
  .object({
    planId,
    customer: z.object({ firstname: personName, email, phone }).strict(),
  })
  .strict();
export const orderIdSchema = uuid;

export const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const cb = z.string().max(500);
/** PayU callback (form-encoded). Unknown extra PayU fields are tolerated but never trusted. */
export const callbackSchema = z
  .object({
    key: cb.min(1),
    txnid: cb.min(1).max(40),
    amount: cb.min(1).max(20),
    productinfo: cb.min(1),
    firstname: cb.min(1),
    email: cb.min(1),
    status: cb.min(1).max(30),
    hash: cb.min(32).max(256),
    mihpayid: cb.optional(),
    udf1: cb.optional(),
    udf2: cb.optional(),
    udf3: cb.optional(),
    udf4: cb.optional(),
    udf5: cb.optional(),
    additionalCharges: cb.optional(),
    currency: cb.optional(),
  })
  .passthrough();
export type CallbackPayload = z.infer<typeof callbackSchema>;

export interface PasswordPolicyContext {
  email?: string;
  name?: string;
}
const COMMON = new Set(['password', 'password1', 'password123', '1234567890', 'qwertyuiop', 'letmein123', 'iloveyou12', 'welcome123', 'admin12345', 'bluecode123']);

/** Returns a list of generic policy violations (empty = acceptable). */
export function passwordPolicyViolations(pw: string, ctx: PasswordPolicyContext = {}): string[] {
  const v: string[] = [];
  if (pw.length < 10) v.push('at least 10 characters');
  if (pw.length > 128) v.push('at most 128 characters');
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) v.push('a mix of letters and numbers');
  if (COMMON.has(pw.toLowerCase())) v.push('not a commonly used password');
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) v.push('must not contain your email name');
  if (/^(.)\1+$/.test(pw)) v.push('not a repeated character');
  return v;
}
