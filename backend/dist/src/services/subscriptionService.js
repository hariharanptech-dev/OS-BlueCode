"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionService = void 0;
exports.computeWindow = computeWindow;
class SubscriptionService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    async getMine(userId) {
        const s = await this.repo.getActiveSubscription(userId);
        return s && s.expiresAt > new Date() ? s : null;
    }
}
exports.SubscriptionService = SubscriptionService;
/** Plan rule used by the repository inside the activation transaction:
 *  start = max(now, expiry of the user's current active subscription); expiry = start + durationDays. */
function computeWindow(now, currentExpiry, durationDays) {
    const startsAt = currentExpiry && currentExpiry > now ? currentExpiry : now;
    const expiresAt = new Date(startsAt.getTime() + durationDays * 86_400_000);
    return { startsAt, expiresAt };
}
