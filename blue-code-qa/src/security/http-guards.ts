import type { IncomingMessage, ServerResponse } from 'node:http';
import { safeEqual } from './payu-hash.ts';
import { AppError } from './errors.ts';

export interface HeaderOptions {
  hsts: boolean;
  /** Origins the browser may POST forms to (PayU). 'self' is always allowed. */
  formActionOrigins: string[];
}

export function applySecurityHeaders(res: ServerResponse, o: HeaderOptions): void {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    `form-action 'self'${o.formActionOrigins.length ? ' ' + o.formActionOrigins.join(' ') : ''}`,
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (o.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/** Exact-match allowlist CORS. Never reflects arbitrary origins, never uses '*', always sets Vary. Returns true if the request was a handled preflight. */
export function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: readonly string[]): boolean {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  const allowed = typeof origin === 'string' && allowedOrigins.includes(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    if (allowed) {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token,Idempotency-Key');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    res.statusCode = allowed ? 204 : 403;
    res.end();
    return true;
  }
  return false;
}

/** If an Origin header is present it MUST be allow-listed (blocks cross-site login/checkout CSRF from browsers). */
export function assertOriginAllowed(req: IncomingMessage, allowedOrigins: readonly string[]): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) throw new AppError('FORBIDDEN_ORIGIN', { internal: { origin: String(origin).slice(0, 100) } });
}

/** Synchroniser-token check for cookie-authenticated state-changing requests. */
export function assertCsrf(req: IncomingMessage, expectedToken: string, allowedOrigins: readonly string[]): void {
  assertOriginAllowed(req, allowedOrigins);
  const supplied = req.headers['x-csrf-token'];
  if (typeof supplied !== 'string' || !safeEqual(supplied, expectedToken)) throw new AppError('CSRF_FAILED');
}

export async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > maxBytes) {
      throw new AppError('PAYLOAD_TOO_LARGE');
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c] as string);
}

/** Allows only same-site relative paths for post-login redirects (open-redirect defence). */
export function safeRelativePath(next: string | null | undefined, fallback = '/pricing'): string {
  if (!next) return fallback;
  if (!/^\/[A-Za-z0-9/_\-.?=&%]*$/.test(next) || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}
