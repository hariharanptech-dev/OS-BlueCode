import { z } from 'zod';

export const AUTHORIZED_PAYU_MID = '13844503';
// Test MID can be different - get from PayU test dashboard
export const TEST_PAYU_MID = 'test';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  FRONTEND_URL: z.string().url(),
  BACKEND_URL: z.string().url(),
  PAYU_MERCHANT_ID: z.string().default('13844503'),
  PAYU_MERCHANT_KEY: z.string().min(1),
  PAYU_MERCHANT_SALT: z.string().min(1),
  PAYU_BASE_URL: z.string().url(),
  PAYU_VERIFY_URL: z.string().url(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = schema.parse(env);
  
  // In production, enforce the authorized MID
  if (e.NODE_ENV === 'production') {
    if (e.PAYU_MERCHANT_ID !== AUTHORIZED_PAYU_MID) {
      throw new Error(`Unauthorized PayU Merchant ID '${e.PAYU_MERCHANT_ID}'. Only MID ${AUTHORIZED_PAYU_MID} is authorized in production.`);
    }
    if (!e.PAYU_BASE_URL.startsWith('https://secure.payu.in')) throw new Error('Production must use https://secure.payu.in/_payment');
    if (!e.PAYU_VERIFY_URL.startsWith('https://info.payu.in')) throw new Error('Production must use https://info.payu.in verify URL');
    if (!e.BACKEND_URL.startsWith('https://')) throw new Error('BACKEND_URL must be https in production');
  } else {
    // In development/test, allow test MID but warn if using production MID with test URLs
    if (e.PAYU_MERCHANT_ID === AUTHORIZED_PAYU_MID && e.PAYU_BASE_URL.includes('test.payu.in')) {
      console.warn('WARNING: Using production MID with test environment URL. This will fail. Get test credentials from PayU test dashboard.');
    }
  }
  
  return {
    env: e.NODE_ENV, isProd: e.NODE_ENV === 'production', port: e.PORT, databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET, frontendUrl: e.FRONTEND_URL, backendUrl: e.BACKEND_URL,
    payu: { merchantId: e.PAYU_MERCHANT_ID, key: e.PAYU_MERCHANT_KEY, salt: e.PAYU_MERCHANT_SALT, baseUrl: e.PAYU_BASE_URL, verifyUrl: e.PAYU_VERIFY_URL },
  };
}
export type AppConfig = ReturnType<typeof loadConfig>;
