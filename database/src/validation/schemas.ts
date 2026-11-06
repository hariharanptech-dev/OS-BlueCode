import { z } from 'zod';

const ARGON_OR_BCRYPT = /^\$(argon2(id|i|d)\$|2[aby]\$)/;
export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  // Guards against persisting a plain-text password: only argon2/bcrypt hash strings are accepted.
  passwordHash: z.string().regex(ARGON_OR_BCRYPT, 'passwordHash must be an argon2 or bcrypt hash').max(512),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

const currency = z.string().regex(/^[A-Z]{3}$/);
export const createPlanSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,64}$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  priceMinor: z.number().int().positive().max(2_000_000_000),
  currency,
  billingInterval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM']),
  durationDays: z.number().int().positive().max(3660),
  features: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
});
export type CreatePlanInput = z.input<typeof createPlanSchema>;

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_\-:.]{16,128}$/, 'idempotency key must be 16-128 chars of [A-Za-z0-9_-:.]');
export const createPaymentOrderSchema = z.object({
  userId: z.uuid(), // MUST come from the authenticated backend context, never from a request body
  planId: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
});
export type CreatePaymentOrderInput = z.input<typeof createPaymentOrderSchema>;

/**
 * Evidence that the BACKEND confirmed the transaction with PayU (server-to-server verify API / hash-validated
 * response). This module cannot talk to PayU; the payment-integration module must build this object ONLY from an
 * authenticated PayU verification result whose status is success.
 */
export const verifiedPayUTransactionSchema = z.object({
  orderId: z.string().min(1).max(64),
  transactionId: z.string().min(1).max(64), // merchant txnid
  providerTransactionId: z.string().min(1).max(128), // PayU mihpayid
  amountMinor: z.number().int().positive(),
  currency,
  verifiedAt: z.date(),
  source: z.enum(['PAYU_VERIFY_API', 'RECONCILIATION']),
  payload: z.record(z.string(), z.unknown()).default({}), // sanitized (allow-list) before storage
});
export type VerifiedPayUTransaction = z.input<typeof verifiedPayUTransactionSchema>;

export const recordFailureSchema = z.object({
  orderId: z.string().min(1).max(64),
  status: z.enum(['FAILED', 'CANCELLED']),
  reason: z.string().max(255).optional(),
  providerTransactionId: z.string().min(1).max(128).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type RecordFailureInput = z.input<typeof recordFailureSchema>;

export const listPaymentsSchema = z.object({
  userId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
  status: z.enum(['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED']).optional(),
});
export type ListPaymentsInput = z.input<typeof listPaymentsSchema>;
