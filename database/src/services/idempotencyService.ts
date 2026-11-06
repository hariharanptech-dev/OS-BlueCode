import type { DbClient } from '../db/client';
import { idempotencyRepository } from '../repositories/idempotencyRepository';
import { IdempotencyInProgressError, IdempotencyKeyReuseError } from '../shared/errors';
import { requestFingerprint } from '../shared/fingerprint';
import { systemClock, type Clock } from '../shared/time';

export type IdempotencyBegin =
  | { kind: 'NEW'; recordId: string }
  | { kind: 'REPLAY'; recordId: string; responseReference: string };

/**
 * Prevents one logical request (same user + key) from being executed twice.
 * Call begin() and complete() with the SAME transaction client as the business write so the record and the
 * outcome commit (or roll back) together; there is then no "stuck IN_PROGRESS after a crash" state.
 */
export class IdempotencyService {
  constructor(private readonly ttlMs = 24 * 3600_000, private readonly clock: Clock = systemClock) {}

  async begin(db: DbClient, a: { userId: string; key: string; request: unknown }): Promise<IdempotencyBegin> {
    const repo = idempotencyRepository(db);
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const fingerprint = requestFingerprint(a.request);

    const claimed = await repo.insertIfAbsent({ userId: a.userId, key: a.key, fingerprint, now, expiresAt });
    if (claimed) return { kind: 'NEW', recordId: claimed };

    const existing = await repo.find(a.userId, a.key);
    if (!existing) return this.begin(db, a); // deleted between statements; retry the claim
    if (existing.requestFingerprint !== fingerprint) throw new IdempotencyKeyReuseError();
    if (existing.status === 'COMPLETED' && existing.responseReference) {
      return { kind: 'REPLAY', recordId: existing.id, responseReference: existing.responseReference };
    }
    if (await repo.reclaim(existing.id, now, expiresAt)) return { kind: 'NEW', recordId: existing.id };
    throw new IdempotencyInProgressError();
  }

  complete(db: DbClient, recordId: string, responseReference: string) {
    return idempotencyRepository(db).complete(recordId, responseReference);
  }
  purgeExpired(db: DbClient) {
    return idempotencyRepository(db).purgeExpired(this.clock());
  }
}
