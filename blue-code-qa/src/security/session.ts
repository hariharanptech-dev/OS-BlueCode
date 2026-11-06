import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Clock } from './clock.ts';

export interface Session {
  id: string;
  userId: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
}

export type SessionLookup = { kind: 'ok'; session: Session } | { kind: 'expired' } | { kind: 'none' };

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Server-side opaque sessions. Only SHA-256 of the token is stored, so a store dump cannot be replayed. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly clock: Clock;
  private readonly idleMs: number;
  private readonly absoluteMs: number;

  constructor(opts: { clock: Clock; idleMs: number; absoluteMs: number }) {
    this.clock = opts.clock;
    this.idleMs = opts.idleMs;
    this.absoluteMs = opts.absoluteMs;
  }

  create(userId: string): { token: string; session: Session } {
    const token = randomBytes(32).toString('base64url');
    const now = this.clock.now().getTime();
    const session: Session = { id: randomUUID(), userId, csrfToken: randomBytes(24).toString('base64url'), createdAt: now, lastSeenAt: now };
    this.sessions.set(sha(token), session);
    return { token, session };
  }

  lookup(token: string | undefined): SessionLookup {
    if (!token) return { kind: 'none' };
    const k = sha(token);
    const s = this.sessions.get(k);
    if (!s) return { kind: 'none' };
    const now = this.clock.now().getTime();
    if (now - s.lastSeenAt > this.idleMs || now - s.createdAt > this.absoluteMs) {
      this.sessions.delete(k);
      return { kind: 'expired' };
    }
    s.lastSeenAt = now;
    return { kind: 'ok', session: s };
  }

  destroy(token: string | undefined): void {
    if (token) this.sessions.delete(sha(token));
  }

  destroyAllForUser(userId: string): void {
    for (const [k, s] of this.sessions) if (s.userId === userId) this.sessions.delete(k);
  }

  /** test helper: raw keys must never equal tokens */
  _keysForTest(): string[] {
    return [...this.sessions.keys()];
  }
  size(): number {
    return this.sessions.size;
  }
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
  maxAgeSec?: number;
}

export function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`];
  if (o.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAgeSec)}`);
  if (o.httpOnly !== false) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  parts.push(`SameSite=${o.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!header || header.length > 4096) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}
