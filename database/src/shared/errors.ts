export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
  }
}
export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) { super('NOT_FOUND', `${entity} not found`, { entity, id }); }
}
export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) { super('VALIDATION_ERROR', message, details); }
}
export class DuplicateEmailError extends DomainError {
  constructor() { super('DUPLICATE_EMAIL', 'A user with this email already exists'); }
}
export class DuplicateOrderError extends DomainError {
  constructor(field: string) { super('DUPLICATE_ORDER', `Payment ${field} already exists`, { field }); }
}
export class InvalidTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super('INVALID_TRANSITION', `${entity} transition ${from} -> ${to} is not permitted`, { entity, from, to });
  }
}
export class IdempotencyKeyReuseError extends DomainError {
  constructor() { super('IDEMPOTENCY_KEY_REUSE', 'Idempotency key was already used with a different request'); }
}
export class IdempotencyInProgressError extends DomainError {
  constructor() { super('IDEMPOTENCY_IN_PROGRESS', 'A request with this idempotency key is still being processed'); }
}
export class PlanNotPurchasableError extends DomainError {
  constructor(planId: string) { super('PLAN_NOT_PURCHASABLE', 'Plan is not available for purchase', { planId }); }
}
export class AccountNotActiveError extends DomainError {
  constructor(userId: string) { super('ACCOUNT_NOT_ACTIVE', 'User account is not active', { userId }); }
}

/** If `e` is a Prisma unique-constraint violation, returns the violated target text (lower-cased); else null. */
export function uniqueViolationTarget(e: unknown): string | null {
  const err = e as { code?: string; meta?: unknown; message?: string };
  if (err?.code !== 'P2002') return null;
  return (JSON.stringify(err.meta ?? {}) + ' ' + String(err.message ?? '')).toLowerCase();
}
