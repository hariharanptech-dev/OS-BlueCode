import { PaymentStatus } from '../types';

export const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ['PENDING', 'FAILED', 'CANCELLED', 'EXPIRED', 'VERIFICATION_PENDING', 'SUCCESS'],
  PENDING: ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'VERIFICATION_PENDING'],
  VERIFICATION_PENDING: ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  SUCCESS: [], FAILED: [], CANCELLED: [], EXPIRED: [],
};
export const TERMINAL: PaymentStatus[] = ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'];
export const isTerminal = (s: PaymentStatus) => TERMINAL.includes(s);
export const canTransition = (from: PaymentStatus, to: PaymentStatus) => TRANSITIONS[from].includes(to);
/** Statuses from which `to` may be reached; used as the compare-and-set guard. */
export const allowedFrom = (to: PaymentStatus): PaymentStatus[] =>
  (Object.keys(TRANSITIONS) as PaymentStatus[]).filter((f) => canTransition(f, to));
