import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^[0-9+\- ]{7,15}$/).optional(),
  password: z.string().min(10).max(128),
});

export const loginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(10).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
});

export const initiateSchema = z
  .object({
    planId: z.string().uuid(),
    idempotencyKey: z.string().optional(),
  })
  .strict();

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const orderIdParam = z.string().regex(/^ORD-[A-Z0-9]+-[A-F0-9]{8}$/);

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).optional(),
});
