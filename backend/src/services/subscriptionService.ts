import { PaymentRepository } from '../types';

export class SubscriptionService {
  constructor(private repo: PaymentRepository) {}
  async getMine(userId: string) {
    const s = await this.repo.getActiveSubscription(userId);
    return s && s.expiresAt > new Date() ? s : null;
  }
}

/** Plan rule used by the repository inside the activation transaction:
 *  start = max(now, expiry of the user's current active subscription); expiry = start + durationDays. */
export function computeWindow(now: Date, currentExpiry: Date | null, durationDays: number) {
  const startsAt = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const expiresAt = new Date(startsAt.getTime() + durationDays * 86_400_000);
  return { startsAt, expiresAt };
}
