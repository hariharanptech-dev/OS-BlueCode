import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AppError, FailureThrottle, Logger, MemorySink, SessionStore, SlidingWindowLimiter, DUMMY_HASH_PROMISE,
  applyCors, applySecurityHeaders, assertCsrf, assertOriginAllowed, checkoutSchema, clientIp, escapeHtml, hashPassword, loginSchema,
  orderIdSchema, paginationSchema, parse, parseCookies, passwordPolicyViolations, readBody, registerSchema, serializeCookie,
  systemClock, toErrorResponse, verifyPassword, consoleSink, type Clock, type LogSink, type Session,
} from '../security/index.ts';
import type { Config } from './config.ts';
import { Db, UniqueViolation } from './db.ts';
import { MockPayUGateway, type PayUGateway } from './gateway.ts';
import { PaymentService, SubscriptionService } from './payments.ts';
import { PLANS } from './plans.ts';
import type { User } from './types.ts';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PAGES: Record<string, string> = {
  '/': 'index.html', '/register': 'register.html', '/login': 'login.html', '/pricing': 'pricing.html',
  '/checkout': 'checkout.html', '/payment/result': 'result.html', '/dashboard': 'dashboard.html',
};
const ASSETS: Record<string, [string, string]> = {
  '/static/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/static/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/static/mock-auto.js': ['mock-auto.js', 'text/javascript; charset=utf-8'],
};
const fileCache = new Map<string, string>();
const readPublic = (f: string): string => {
  let c = fileCache.get(f);
  if (c === undefined) { c = readFileSync(path.join(PUBLIC_DIR, f), 'utf8'); fileCache.set(f, c); }
  return c;
};

export interface Limits { global: number; auth: number; checkout: number; refresh: number; callback: number }
export const DEFAULT_LIMITS: Limits = { global: 300, auth: 20, checkout: 20, refresh: 30, callback: 120 };
export const HIGH_LIMITS: Limits = { global: 1e6, auth: 1e6, checkout: 1e6, refresh: 1e6, callback: 1e6 };

export interface AppOptions { config: Config; clock?: Clock; gateway?: PayUGateway; db?: Db; sink?: LogSink; limits?: Partial<Limits> }

export interface App {
  config: Config; db: Db; clock: Clock; gateway: PayUGateway; logger: Logger; sink: LogSink;
  payments: PaymentService; subscriptions: SubscriptionService; sessions: SessionStore; throttle: FailureThrottle;
  server: http.Server; url: string;
  start(port?: number): Promise<string>; stop(): Promise<void>;
}

type Handler = (c: Ctx) => Promise<void> | void;
interface Ctx {
  req: http.IncomingMessage; res: http.ServerResponse; url: URL; requestId: string; ip: string;
  body: unknown; user?: User; session?: Session; token?: string;
}
interface Route { method: 'GET' | 'POST'; match: RegExp; auth: boolean; csrf: boolean; body: 'none' | 'json' | 'form' | 'any'; limiter?: 'auth' | 'checkout' | 'refresh' | 'callback'; handler: Handler }

export function createApp(opts: AppOptions): App {
  const config: Config = { ...opts.config, allowedOrigins: [...opts.config.allowedOrigins] };
  const clock = opts.clock ?? systemClock;
  const sink = opts.sink ?? (config.nodeEnv === 'test' ? new MemorySink() : consoleSink);
  const secrets = config.defects.has('log-secrets') ? [] : [config.payuSalt];
  const logger = new Logger(sink, { secrets });
  const db = opts.db ?? new Db();
  const gateway: PayUGateway = opts.gateway ?? new MockPayUGateway(config.payuKey, config.payuSalt);
  const limits: Limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const sessions = new SessionStore({ clock, idleMs: config.sessionIdleMs, absoluteMs: config.sessionAbsoluteMs });
  const throttle = new FailureThrottle({ maxFailures: 5, lockMs: 15 * 60_000, clock });
  const payments = new PaymentService({ db, gateway, clock, config, logger });
  const subscriptions = new SubscriptionService({ db, clock });
  const mk = (limit: number, windowMs = 60_000): SlidingWindowLimiter => new SlidingWindowLimiter({ limit, windowMs, clock });
  const L = { global: mk(limits.global), auth: mk(limits.auth), checkout: mk(limits.checkout), refresh: mk(limits.refresh), callback: mk(limits.callback) };
  const cookieName = config.cookieSecure ? '__Host-bc_sid' : 'bc_sid';
  const has = (d: string): boolean => (config.defects as ReadonlySet<string>).has(d);
  const payuOrigin = (() => { try { return new URL(config.payuBaseUrl).origin; } catch { return ''; } })();

  const json = (c: Ctx, status: number, body: unknown, extra: Record<string, string | string[]> = {}): void => {
    const data = JSON.stringify(body);
    c.res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', ...extra });
    c.res.end(data);
  };
  const html = (c: Ctx, status: number, body: string): void => {
    c.res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    c.res.end(body);
  };
  const sessionCookie = (token: string): string => serializeCookie(cookieName, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'Lax', maxAgeSec: config.sessionAbsoluteMs / 1000 });
  const clearCookie = (): string => serializeCookie(cookieName, '', { httpOnly: true, secure: config.cookieSecure, sameSite: 'Lax', maxAgeSec: 0 });
  const limit = (l: SlidingWindowLimiter, key: string): void => {
    const r = l.hit(key);
    if (!r.allowed) throw new AppError('RATE_LIMITED', { retryAfterSec: r.retryAfterSec });
  };
  const queryObject = (u: URL): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of u.searchParams) {
      if (k in out) throw new AppError('VALIDATION_FAILED', { fieldErrors: [{ path: k, reason: 'repeated parameter' }] });
      out[k] = v;
    }
    return out;
  };
  const pubUser = (u: User) => ({ id: u.id, name: u.name, email: u.email });

  // ------------------------------------------------------------------ routes
  const routes: Route[] = [
    { method: 'GET', match: /^\/api\/health$/, auth: false, csrf: false, body: 'none', handler: (c) => json(c, 200, { status: 'ok' }) },
    { method: 'GET', match: /^\/api\/plans$/, auth: false, csrf: false, body: 'none', handler: (c) => json(c, 200, { plans: PLANS }) },

    {
      method: 'POST', match: /^\/api\/auth\/register$/, auth: false, csrf: false, body: 'json', limiter: 'auth',
      handler: async (c) => {
        assertOriginAllowed(c.req, config.allowedOrigins);
        const b = parse(registerSchema, c.body);
        const violations = passwordPolicyViolations(b.password, { email: b.email, name: b.name });
        if (violations.length) throw new AppError('VALIDATION_FAILED', { fieldErrors: [{ path: 'password', reason: 'must have ' + violations.join(', ') }] });
        const passwordHash = await hashPassword(b.password);
        let user: User;
        try {
          user = await db.transaction(() => db.insertUser({ name: b.name, email: b.email, passwordHash }, clock.now()));
        } catch (e) {
          if (e instanceof UniqueViolation) throw new AppError('EMAIL_UNAVAILABLE');
          throw e;
        }
        logger.info('auth.registered', { userId: user.id });
        json(c, 201, { user: pubUser(user) });
      },
    },
    {
      method: 'POST', match: /^\/api\/auth\/login$/, auth: false, csrf: false, body: 'json', limiter: 'auth',
      handler: async (c) => {
        assertOriginAllowed(c.req, config.allowedOrigins);
        const b = parse(loginSchema, c.body);
        const tKey = `${c.ip}|${b.email}`;
        const locked = has('no-login-throttle') ? 0 : throttle.lockedFor(tKey);
        if (locked > 0) {
          logger.security('auth.locked_out', { ip: c.ip });
          throw new AppError('ACCOUNT_THROTTLED', { retryAfterSec: locked });
        }
        const user = db.findUserByEmail(b.email);
        const ok = await verifyPassword(b.password, user?.passwordHash ?? (await DUMMY_HASH_PROMISE));
        if (!user || !ok) {
          throttle.recordFailure(tKey);
          logger.security('auth.login_failed', { ip: c.ip, emailDigest: createHash('sha256').update(b.email).digest('hex').slice(0, 12) });
          throw new AppError('INVALID_CREDENTIALS');
        }
        throttle.recordSuccess(tKey);
        sessions.destroy(parseCookies(c.req.headers.cookie)[cookieName]); // session-fixation defence: always issue a fresh token
        const { token, session } = sessions.create(user.id);
        logger.info('auth.login', { userId: user.id });
        json(c, 200, { user: pubUser(user), csrfToken: session.csrfToken }, { 'Set-Cookie': sessionCookie(token) });
      },
    },
    {
      method: 'POST', match: /^\/api\/auth\/logout$/, auth: true, csrf: true, body: 'none',
      handler: (c) => {
        if (!has('logout-keeps-session')) sessions.destroy(c.token);
        json(c, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
      },
    },
    { method: 'GET', match: /^\/api\/auth\/me$/, auth: true, csrf: false, body: 'none', handler: (c) => json(c, 200, { user: pubUser(c.user!), csrfToken: c.session!.csrfToken }) },

    {
      method: 'POST', match: /^\/api\/payments\/checkout$/, auth: true, csrf: true, body: 'json', limiter: 'checkout',
      handler: async (c) => {
        let clientAmount: string | undefined;
        let payload = c.body;
        if (has('trust-client-amount') && payload && typeof payload === 'object' && 'amount' in payload) {
          const { amount, ...rest } = payload as Record<string, unknown>; // DEFECT MODE ONLY: accepts client-chosen price
          clientAmount = typeof amount === 'string' ? amount : undefined;
          payload = rest;
        }
        const b = parse(checkoutSchema, payload);
        const idem = c.req.headers['idempotency-key'];
        if (idem !== undefined && (typeof idem !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(idem))) throw new AppError('VALIDATION_FAILED', { fieldErrors: [{ path: 'Idempotency-Key', reason: 'invalid value' }] });
        const r = await payments.checkout(c.user!, b, typeof idem === 'string' ? idem : null, clientAmount);
        json(c, r.reused ? 200 : 201, r);
      },
    },
    {
      method: 'GET', match: /^\/api\/payments$/, auth: true, csrf: false, body: 'none',
      handler: (c) => {
        const q = parse(paginationSchema, queryObject(c.url));
        json(c, 200, payments.list(c.user!.id, q.page, q.pageSize));
      },
    },
    {
      method: 'GET', match: /^\/api\/payments\/([^/]+)$/, auth: true, csrf: false, body: 'none',
      handler: (c) => {
        const id = idParam(c);
        const o = payments.getForUser(c.user!.id, id);
        json(c, 200, { order: payments.view(o) });
      },
    },
    {
      method: 'POST', match: /^\/api\/payments\/([^/]+)\/refresh$/, auth: true, csrf: true, body: 'none', limiter: 'refresh',
      handler: async (c) => json(c, 200, await payments.refresh(c.user!.id, idParam(c))),
    },
    { method: 'GET', match: /^\/api\/subscription$/, auth: true, csrf: false, body: 'none', handler: (c) => json(c, 200, subscriptions.overview(c.user!.id)) },

    {
      method: 'POST', match: /^\/api\/payments\/payu\/callback$/, auth: false, csrf: false, body: 'any', limiter: 'callback',
      handler: async (c) => {
        const r = await payments.handleCallback(c.body as Record<string, unknown>, 'redirect');
        c.res.writeHead(303, { Location: `/payment/result?order=${encodeURIComponent(r.orderId)}`, 'Cache-Control': 'no-store' });
        c.res.end();
      },
    },
    {
      method: 'POST', match: /^\/api\/payments\/payu\/webhook$/, auth: false, csrf: false, body: 'any', limiter: 'callback',
      handler: async (c) => {
        const r = await payments.handleCallback(c.body as Record<string, unknown>, 'webhook');
        json(c, 200, { ok: true, result: r.kind });
      },
    },
  ];

  function idParam(c: Ctx): string {
    const m = c.url.pathname.split('/');
    let raw: string;
    try { raw = decodeURIComponent(m[3] ?? ''); } catch { throw new AppError('NOT_FOUND'); } // DEF-001: bad %-escapes must not become a 500
    const r = orderIdSchema.safeParse(raw);
    if (!r.success) throw new AppError('NOT_FOUND'); // malformed ids are indistinguishable from missing ones
    return r.data;
  }

  // ---------------------------------------------------- mock PayU hosted pages (never mounted in production)
  const mockEnabled = config.mockPayuUi && config.nodeEnv !== 'production' && gateway instanceof MockPayUGateway;
  const mockRoutes: Route[] = mockEnabled ? [
    {
      method: 'POST', match: /^\/__mock-payu\/pay$/, auth: false, csrf: false, body: 'form',
      handler: (c) => {
        const f = c.body as Record<string, string>;
        let t;
        try { t = (gateway as MockPayUGateway).registerInitiation(f); } catch (e) { return html(c, 400, `<!doctype html><title>PayU (mock)</title><h1 data-testid="mock-error">Payment request rejected: ${escapeHtml((e as Error).message)}</h1>`); }
        html(c, 200, `<!doctype html><html lang="en"><meta charset="utf-8"><title>PayU (mock)</title><link rel="stylesheet" href="/static/styles.css">
<main class="card"><h1>PayU Sandbox (simulated)</h1><p data-testid="mock-amount">Pay INR ${escapeHtml(t.amount)}</p><p>Txn <code data-testid="mock-txnid">${escapeHtml(f['txnid'] ?? '')}</code></p>
<form method="post" action="/__mock-payu/complete"><input type="hidden" name="txnid" value="${escapeHtml(f['txnid'] ?? '')}">
<button name="outcome" value="success" data-testid="mock-pay-success">Pay successfully</button>
<button name="outcome" value="failure" data-testid="mock-pay-fail">Fail payment</button>
<button name="outcome" value="cancel" data-testid="mock-pay-cancel">Cancel</button></form></main>`);
      },
    },
    {
      method: 'POST', match: /^\/__mock-payu\/complete$/, auth: false, csrf: false, body: 'form',
      handler: (c) => {
        const f = c.body as Record<string, string>;
        const mock = gateway as MockPayUGateway;
        const outcome = f['outcome'];
        if (!f['txnid'] || !mock.txns.has(f['txnid']) || (outcome !== 'success' && outcome !== 'failure' && outcome !== 'cancel')) return html(c, 400, 'bad request');
        mock.settle(f['txnid'], outcome);
        const payload = mock.callbackFor(f['txnid'], outcome);
        const inputs = Object.entries(payload).map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');
        html(c, 200, `<!doctype html><meta charset="utf-8"><title>Redirecting…</title><form id="f" method="post" action="/api/payments/payu/callback">${inputs}<noscript><button>Continue</button></noscript></form><script src="/static/mock-auto.js"></script>`);
      },
    },
  ] : [];
  const all = [...routes, ...mockRoutes];

  // ------------------------------------------------------------------ pipeline
  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    applySecurityHeaders(res, { hsts: config.cookieSecure, formActionOrigins: payuOrigin && payuOrigin !== new URL(config.appBaseUrl).origin ? [payuOrigin] : [] });
    const url = new URL(req.url ?? '/', 'http://local');
    const ctx: Ctx = { req, res, url, requestId, ip: clientIp(req, has('trust-xff') ? 1 : config.trustProxyHops), body: undefined };
    try {
      const isApi = url.pathname.startsWith('/api/');
      if (isApi) {
        if (has('allow-any-origin')) {
          res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin ?? '*'));
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        } else if (applyCors(req, res, config.allowedOrigins)) return;
        limit(L.global, ctx.ip);
      }
      if (req.method === 'GET' && PAGES[url.pathname]) return void send(res, 200, 'text/html; charset=utf-8', readPublic(PAGES[url.pathname]!));
      if (req.method === 'GET' && ASSETS[url.pathname]) { const [f, t] = ASSETS[url.pathname]!; return void send(res, 200, t, readPublic(f)); }

      const candidates = all.filter((r) => r.match.test(url.pathname));
      if (!candidates.length) throw new AppError('NOT_FOUND');
      const route = candidates.find((r) => r.method === req.method);
      if (!route) throw new AppError('METHOD_NOT_ALLOWED');

      if (route.limiter === 'auth' || route.limiter === 'callback') limit(L[route.limiter], ctx.ip);

      if (route.body !== 'none') {
        const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        const text = await readBody(req, route.body === 'any' || route.body === 'form' ? 32_768 : 16_384);
        const isForm = ct === 'application/x-www-form-urlencoded';
        const isJson = ct === 'application/json';
        if ((route.body === 'json' && !isJson) || (route.body === 'form' && !isForm) || (route.body === 'any' && !isForm && !isJson)) throw new AppError('UNSUPPORTED_MEDIA_TYPE');
        if (isForm) ctx.body = Object.fromEntries(new URLSearchParams(text));
        else {
          try { ctx.body = text ? JSON.parse(text) : {}; } catch { throw new AppError('VALIDATION_FAILED', { fieldErrors: [{ path: '(body)', reason: 'malformed JSON' }] }); }
        }
      }

      if (route.auth) {
        const token = parseCookies(req.headers.cookie)[cookieName];
        const s = sessions.lookup(token);
        if (s.kind === 'expired') { res.setHeader('Set-Cookie', clearCookie()); throw new AppError('SESSION_EXPIRED'); }
        if (s.kind === 'none') throw new AppError('AUTH_REQUIRED');
        const user = db.findUserById(s.session.userId);
        if (!user) { sessions.destroy(token); throw new AppError('AUTH_REQUIRED'); }
        ctx.user = user; ctx.session = s.session; ctx.token = token;
        if (route.limiter === 'checkout' || route.limiter === 'refresh') limit(L[route.limiter], user.id);
        if (route.csrf && !has('no-csrf')) {
          try { assertCsrf(req, s.session.csrfToken, config.allowedOrigins); } catch (e) { logger.security('csrf.rejected', { path: url.pathname, ip: ctx.ip }); throw e; }
        }
      }
      await route.handler(ctx);
    } catch (err) {
      respondError(ctx, err);
    }
  }

  function send(res: http.ServerResponse, status: number, type: string, body: string): void {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  }

  function respondError(c: Ctx, err: unknown): void {
    const known = err instanceof AppError;
    if (!known || err.status >= 500) logger.error('request.failed', { requestId: c.requestId, path: c.url.pathname, method: c.req.method, err, stack: err instanceof Error ? err.stack : undefined, code: known ? err.code : 'UNHANDLED' });
    else if (err.code !== 'NOT_FOUND') logger.warn('request.rejected', { requestId: c.requestId, path: c.url.pathname, code: err.code });
    const r = toErrorResponse(err, c.requestId);
    const body: Record<string, unknown> = { ...r.body };
    if (has('leak-stack') && err instanceof Error) body['debug'] = { stack: err.stack, message: err.message };
    if (c.res.headersSent) { c.res.end(); return; }
    const data = JSON.stringify(body);
    const setCookie = c.res.getHeader('Set-Cookie');
    c.res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', ...r.headers, ...(setCookie ? { 'Set-Cookie': setCookie as string } : {}) });
    c.res.end(data);
  }

  const server = http.createServer((req, res) => { void handle(req, res); });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;

  const app: App = {
    config, db, clock, gateway, logger, sink, payments, subscriptions, sessions, throttle, server, url: '',
    async start(port = config.port) {
      await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
      const p = (server.address() as { port: number }).port;
      app.url = `http://127.0.0.1:${p}`;
      if (config.nodeEnv !== 'production' && /:0$/.test(config.appBaseUrl)) {
        config.appBaseUrl = app.url; // tests bind to an ephemeral port
        if (!config.allowedOrigins.length || config.allowedOrigins.every((o) => o.endsWith(':0'))) config.allowedOrigins = [app.url];
      }
      return app.url;
    },
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
  return app;
}
