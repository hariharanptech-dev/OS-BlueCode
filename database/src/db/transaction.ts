import { Prisma, PrismaClient } from './client';

export interface TxOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxRetries?: number;
  timeoutMs?: number;
}

function isRetryable(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const msg = String(err?.message ?? '');
  return err?.code === 'P2034' || /deadlock detected|could not serialize access|40001|40P01/.test(msg);
}

/**
 * Runs `fn` in ONE database transaction (READ COMMITTED + explicit row locks; see DATABASE_ARCHITECTURE.md).
 * Retries only on deadlock / serialization failure; business errors are never retried.
 */
export async function runInTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const max = opts.maxRetries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: opts.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: opts.timeoutMs ?? 15000,
        maxWait: 10000,
      });
    } catch (e) {
      if (attempt < max && isRetryable(e)) {
        await new Promise((r) => setTimeout(r, 25 * 2 ** attempt + Math.random() * 25));
        continue;
      }
      throw e;
    }
  }
}
