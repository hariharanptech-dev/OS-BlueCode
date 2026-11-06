import type { DbClient } from '../db/client';

export function idempotencyRepository(db: DbClient) {
  return {
    /** Atomic claim. Concurrent callers block on the unique index until the first commits/aborts. */
    async insertIfAbsent(a: { userId: string; key: string; fingerprint: string; now: Date; expiresAt: Date }): Promise<string | null> {
      const rows = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO idempotency_records (id, user_id, idempotency_key, request_fingerprint, status, created_at, expires_at)
        VALUES (gen_random_uuid(), ${a.userId}::uuid, ${a.key}, ${a.fingerprint}, 'IN_PROGRESS', ${a.now}::timestamptz, ${a.expiresAt}::timestamptz)
        ON CONFLICT (user_id, idempotency_key) DO NOTHING
        RETURNING id`;
      return rows[0]?.id ?? null;
    },
    find: (userId: string, key: string) => db.idempotencyRecord.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } }),
    /** Re-claim an expired IN_PROGRESS or a FAILED record (compare-and-set). */
    async reclaim(id: string, now: Date, expiresAt: Date): Promise<boolean> {
      const r = await db.idempotencyRecord.updateMany({
        where: { id, OR: [{ status: 'FAILED' }, { status: 'IN_PROGRESS', expiresAt: { lt: now } }] },
        data: { status: 'IN_PROGRESS', createdAt: now, expiresAt, responseReference: null },
      });
      return r.count === 1;
    },
    complete: (id: string, responseReference: string) =>
      db.idempotencyRecord.update({ where: { id }, data: { status: 'COMPLETED', responseReference } }),
    fail: (id: string) => db.idempotencyRecord.update({ where: { id }, data: { status: 'FAILED' } }),
    /** Housekeeping: only non-COMPLETED records are purged; COMPLETED ones stay as long as their payment does. */
    async purgeExpired(now: Date): Promise<number> {
      const r = await db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now }, status: { not: 'COMPLETED' } } });
      return r.count;
    },
  };
}
