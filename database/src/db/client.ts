import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client';

/** Prisma transaction client; PrismaClient is assignable to it. Every repository accepts this type. */
export type DbClient = Prisma.TransactionClient;
export { PrismaClient, Prisma };

/** Builds a client on the pg driver adapter. The Prisma-only `?schema=` param is handled separately. */
export function createPrismaClient(connectionString: string, opts: { poolMax?: number } = {}): PrismaClient {
  const url = new URL(connectionString);
  const schema = url.searchParams.get('schema') ?? 'public';
  url.searchParams.delete('schema');
  const adapter = new PrismaPg({ connectionString: url.toString(), max: opts.poolMax ?? 10 }, { schema });
  return new PrismaClient({ adapter });
}
