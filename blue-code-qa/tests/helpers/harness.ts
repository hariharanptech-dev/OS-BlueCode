import { FakeClock, MemorySink } from '../../src/security/index.ts';
import { testConfig, type Config } from '../../src/reference/config.ts';
import { MockPayUGateway, type Outcome, type CallbackOptions } from '../../src/reference/gateway.ts';
import { createApp, HIGH_LIMITS, type App, type Limits } from '../../src/reference/server.ts';
import type { CheckoutResult } from '../../src/reference/payments.ts';

export const STRONG_PW = 'Correct-Horse-42';
let counter = 0;
export const uniqueEmail = (tag = 'user'): string => `${tag}${Date.now().toString(36)}${++counter}@example.test`;

export interface TestApp {
  app: App;
  url: string;
  clock: FakeClock;
  gateway: MockPayUGateway;
  sink: MemorySink;
  config: Config;
  stop(): Promise<void>;
}

/** Starts an isolated app on an ephemeral port. Rate limits are lifted unless `limits` is supplied. */
export async function startApp(o: { config?: Partial<Config>; limits?: Partial<Limits> | 'default'; start?: string } = {}): Promise<TestApp> {
  const clock = new FakeClock(o.start ?? '2026-01-15T10:00:00.000Z');
  const sink = new MemorySink();
  const config = testConfig(o.config);
  const gateway = new MockPayUGateway(config.payuKey, config.payuSalt);
  const app = createApp({ config, clock, gateway, sink, ...(o.limits === 'default' ? {} : { limits: { ...HIGH_LIMITS, ...(o.limits ?? {}) } }) });
  const url = await app.start();
  return { app, url, clock, gateway, sink, config: app.config, stop: () => app.stop() };
}

export interface Res {
  status: number;
  headers: Headers;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  location: string | null;
}

export interface ReqOpts {
  json?: unknown;
  rawBody?: string;
  form?: Record<string, string>;
  headers?: Record<string, string>;
  origin?: string | null; // null = omit header
  csrf?: string | null; // undefined = use stored token, null = omit
  cookies?: boolean;
  contentType?: string;
}

/** Minimal Supertest replacement: cookie jar + CSRF token + redirect:'manual'. */
export class Client {
  readonly base: string;
  readonly jar = new Map<string, string>();
  csrfToken: string | null = null;
  userId: string | null = null;
  email: string | null = null;
  constructor(base: string) {
    this.base = base;
  }

  async request(method: string, path: string, o: ReqOpts = {}): Promise<Res> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.origin !== null) headers['Origin'] = o.origin ?? this.base;
    if (o.cookies !== false && this.jar.size) headers['Cookie'] = [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    const token = o.csrf === undefined ? this.csrfToken : o.csrf;
    if (token && method !== 'GET') headers['X-CSRF-Token'] = token;
    let body: string | undefined;
    if (o.rawBody !== undefined) { body = o.rawBody; headers['Content-Type'] = o.contentType ?? 'application/json'; }
    else if (o.json !== undefined) { body = JSON.stringify(o.json); headers['Content-Type'] = o.contentType ?? 'application/json'; }
    else if (o.form) { body = new URLSearchParams(o.form).toString(); headers['Content-Type'] = o.contentType ?? 'application/x-www-form-urlencoded'; }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i);
      const val = decodeURIComponent(pair!.slice(i + 1));
      if (/Max-Age=0/i.test(sc) || val === '') this.jar.delete(name);
      else this.jar.set(name, val);
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, headers: res.headers, text, json, location: res.headers.get('location') };
  }
  get = (p: string, o?: ReqOpts): Promise<Res> => this.request('GET', p, o);
  post = (p: string, o?: ReqOpts): Promise<Res> => this.request('POST', p, o);

  async register(email: string, name = 'Asha Rao', password = STRONG_PW): Promise<Res> {
    return this.post('/api/auth/register', { json: { name, email, password } });
  }
  async login(email: string, password = STRONG_PW): Promise<Res> {
    const r = await this.post('/api/auth/login', { json: { email, password } });
    if (r.status === 200) { this.csrfToken = r.json.csrfToken; this.userId = r.json.user.id; this.email = email; }
    return r;
  }
  /** Sign in again (e.g. after the fake clock moved past session expiry). */
  async relogin(password = STRONG_PW): Promise<void> {
    this.jar.clear();
    const r = await this.login(this.email!, password);
    if (r.status !== 200) throw new Error(`relogin failed ${r.status}`);
  }
  async checkout(planId: string, o: { idem?: string; customer?: Record<string, string>; extra?: Record<string, unknown> } = {}): Promise<Res> {
    return this.post('/api/payments/checkout', {
      headers: o.idem ? { 'Idempotency-Key': o.idem } : {},
      json: { planId, customer: o.customer ?? { firstname: 'Asha', email: this.email ?? 'asha@example.test', phone: '9876543210' }, ...(o.extra ?? {}) },
    });
  }
}

export async function signedInClient(t: TestApp, tag = 'user', name = 'Asha Rao'): Promise<Client> {
  const c = new Client(t.url);
  const email = uniqueEmail(tag);
  const r = await c.register(email, name);
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${r.text}`);
  const l = await c.login(email);
  if (l.status !== 200) throw new Error(`login failed: ${l.status} ${l.text}`);
  return c;
}

/** POST a PayU-style callback with NO cookies (as PayU's servers / the customer's cross-site POST would). */
export async function postCallback(t: TestApp, payload: Record<string, string>, o: { path?: string; json?: boolean; origin?: string | null } = {}): Promise<Res> {
  const anon = new Client(t.url);
  const path = o.path ?? '/api/payments/payu/callback';
  return anon.request('POST', path, o.json ? { json: payload, cookies: false, origin: o.origin ?? 'https://secure.payu.in' } : { form: payload, cookies: false, origin: o.origin ?? 'https://secure.payu.in' });
}

export interface Started { res: Res; checkout: CheckoutResult; txnid: string; orderId: string }

/** Customer selects a plan and their browser posts the form to (mock) PayU, which validates the request hash. */
export async function startPayment(t: TestApp, c: Client, planId = 'starter_monthly', idem?: string): Promise<Started> {
  const res = await c.checkout(planId, idem ? { idem } : {});
  if (res.status !== 200 && res.status !== 201) throw new Error(`checkout failed ${res.status} ${res.text}`);
  const co = res.json as CheckoutResult;
  if (!t.gateway.txns.has(co.txnid)) t.gateway.registerInitiation(co.payu.fields);
  return { res, checkout: co, txnid: co.txnid, orderId: co.orderId };
}

/** Full path: start → customer acts at PayU → PayU calls back. */
export async function completePayment(t: TestApp, c: Client, outcome: Outcome, planId = 'starter_monthly', cbOpts: CallbackOptions = {}): Promise<Started & { cb: Res }> {
  const s = await startPayment(t, c, planId);
  t.gateway.settle(s.txnid, outcome);
  const cb = await postCallback(t, t.gateway.callbackFor(s.txnid, outcome, cbOpts));
  return { ...s, cb };
}

export const subsOf = (t: TestApp) => t.app.db.allSubscriptions();
export const orderOf = (t: TestApp, id: string) => t.app.db.getOrder(id)!;
