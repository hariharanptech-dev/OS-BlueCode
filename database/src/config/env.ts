import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
});
export type AppEnv = z.infer<typeof schema>;

/** Parsed on demand so importing the module never throws; call when you need config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return schema.parse(source);
}
