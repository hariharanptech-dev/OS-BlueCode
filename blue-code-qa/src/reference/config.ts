import { z } from 'zod';

export type Defect =
  | 'skip-hash-verify' | 'trust-client-amount' | 'no-gateway-verify' | 'no-idempotency' | 'idor-payments'
  | 'no-amount-check' | 'no-login-throttle' | 'leak-stack' | 'logout-keeps-session' | 'no-csrf'
  | 'cancel-activates' | 'log-secrets' | 'trust-xff' | 'no-key-check' | 'allow-any-origin'
  | 'no-state-guard';

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  appBaseUrl: string;
  allowedOrigins: string[];
  payuKey: string;
  payuSalt: string;
  payuBaseUrl: string;
  payuVerifyUrl: string;
  cookieSecure: boolean;
  trustProxyHops: number;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  mockPayuUi: boolean;
  defects: ReadonlySet<Defect>;
}

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid configuration: ${issues.join('; ')}`); // names only, never values
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  ALLOWED_ORIGINS: z.string().default(''),
  PAYU_KEY: z.string().min(1),
  PAYU_SALT: z.string().min(1),
  PAYU_BASE_URL: z.string().default('https://test.payu.in/_payment'),
  PAYU_VERIFY_URL: z.string().default('https://test.payu.in/merchant/postservice.php?form=2'),
  COOKIE_SECURE: bool.default('false'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_IDLE_MINUTES: z.coerce.number().min(1).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().min(1).default(8),
  MOCK_PAYU_UI: bool.default('false'),
  SUT_DEFECT: z.string().default(''),
});

export function loadConfig(env: Record<string, string | undefined>): Config {
  const r = envSchema.safeParse(env);
  if (!r.success) throw new ConfigError(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const e = r.data;
  const cfg: Config = {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    appBaseUrl: e.APP_BASE_URL.replace(/\/$/, ''),
    allowedOrigins: e.ALLOWED_ORIGINS ? e.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : [new URL(e.APP_BASE_URL).origin],
    payuKey: e.PAYU_KEY,
    payuSalt: e.PAYU_SALT,
    payuBaseUrl: e.PAYU_BASE_URL,
    payuVerifyUrl: e.PAYU_VERIFY_URL,
    cookieSecure: e.COOKIE_SECURE,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    sessionIdleMs: e.SESSION_IDLE_MINUTES * 60_000,
    sessionAbsoluteMs: e.SESSION_ABSOLUTE_HOURS * 3_600_000,
    mockPayuUi: e.MOCK_PAYU_UI,
    defects: new Set(e.SUT_DEFECT.split(',').map((s) => s.trim()).filter(Boolean) as Defect[]),
  };
  if (cfg.nodeEnv === 'production') assertProductionSafe(cfg);
  return cfg;
}

/** Fail-closed production checks. Messages name the setting, never its value. */
export function assertProductionSafe(c: Config): void {
  const issues: string[] = [];
  if (!c.appBaseUrl.startsWith('https://')) issues.push('APP_BASE_URL must be https');
  if (!c.cookieSecure) issues.push('COOKIE_SECURE must be true');
  if (c.mockPayuUi) issues.push('MOCK_PAYU_UI must be false');
  if (c.defects.size > 0) issues.push('SUT_DEFECT must be empty');
  if (c.allowedOrigins.some((o) => o === '*' || !o.startsWith('https://'))) issues.push('ALLOWED_ORIGINS must be https origins, no wildcard');
  if (c.payuSalt.length < 16 || /replace|change|example|placeholder|dummy|test|secret|salt/i.test(c.payuSalt)) issues.push('PAYU_SALT looks like a placeholder');
  if (/replace|change|example|placeholder|dummy|test/i.test(c.payuKey)) issues.push('PAYU_KEY looks like a placeholder');
  if (/test\.payu\.in/.test(c.payuBaseUrl) || /test\.payu\.in/.test(c.payuVerifyUrl)) issues.push('PAYU URLs point at the sandbox');
  if (issues.length) throw new ConfigError(issues);
}

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    appBaseUrl: 'http://127.0.0.1:0',
    allowedOrigins: [],
    payuKey: 'TESTKEY01',
    payuSalt: 'fake-salt-for-tests-only-0123456789',
    payuBaseUrl: '/__mock-payu/pay',
    payuVerifyUrl: 'http://mock.invalid/verify',
    cookieSecure: false,
    trustProxyHops: 0,
    sessionIdleMs: 30 * 60_000,
    sessionAbsoluteMs: 8 * 3_600_000,
    mockPayuUi: true,
    defects: new Set((process.env['SUT_DEFECT'] ?? '').split(',').map((s) => s.trim()).filter(Boolean) as Defect[]),
    ...over,
  };
}
