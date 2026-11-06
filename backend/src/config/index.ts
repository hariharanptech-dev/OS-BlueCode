import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  FRONTEND_URL: z.string().url(),
  BACKEND_URL: z.string().url(),
  PAYU_MERCHANT_KEY: z.string().min(1),
  PAYU_MERCHANT_SALT: z.string().min(1),
  PAYU_BASE_URL: z.string().url(),
  PAYU_VERIFY_URL: z.string().url(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = schema.parse(env);
  if (e.NODE_ENV === 'production') {
    if (!e.PAYU_BASE_URL.startsWith('https://secure.payu.in')) throw new Error('Production must use https://secure.payu.in/_payment');
    if (!e.PAYU_VERIFY_URL.startsWith('https://info.payu.in')) throw new Error('Production must use https://info.payu.in verify URL');
    if (!e.BACKEND_URL.startsWith('https://')) throw new Error('BACKEND_URL must be https in production');
  }
  return {
    env: e.NODE_ENV, isProd: e.NODE_ENV === 'production', port: e.PORT, databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET, frontendUrl: e.FRONTEND_URL, backendUrl: e.BACKEND_URL,
    payu: { key: e.PAYU_MERCHANT_KEY, salt: e.PAYU_MERCHANT_SALT, baseUrl: e.PAYU_BASE_URL, verifyUrl: e.PAYU_VERIFY_URL },
  };
}
export type AppConfig = ReturnType<typeof loadConfig>;
