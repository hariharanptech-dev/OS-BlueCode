import type { IncomingMessage } from 'node:http';
import type { Clock } from './clock.ts';

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** In-memory sliding-window limiter. Replace with Redis in multi-instance deployments (see RISK_REGISTER R-07). */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;
  private readonly maxKeys: number;

  constructor(opts: { limit: number; windowMs: number; clock: Clock; maxKeys?: number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.clock = opts.clock;
    this.maxKeys = opts.maxKeys ?? 50_000;
  }

  hit(key: string): LimitResult {
    const now = this.clock.now().getTime();
    const cutoff = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      const oldest = arr[0] ?? now;
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > this.maxKeys) this.evict(cutoff);
    return { allowed: true, remaining: this.limit - arr.length, retryAfterSec: 0 };
  }

  private evict(cutoff: number): void {
    for (const [k, v] of this.hits) {
      if (v.every((t) => t <= cutoff)) this.hits.delete(k);
      if (this.hits.size <= this.maxKeys * 0.8) break;
    }
    // hard bound: drop oldest insertions if still too large
    while (this.hits.size > this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first === undefined) break;
      this.hits.delete(first);
    }
  }
}

/** Counts consecutive failures per key and locks the key for `lockMs` after `maxFailures`. */
export class FailureThrottle {
  private readonly state = new Map<string, { failures: number; lockedUntil: number }>();
  private readonly maxFailures: number;
  private readonly lockMs: number;
  private readonly clock: Clock;

  constructor(opts: { maxFailures: number; lockMs: number; clock: Clock }) {
    this.maxFailures = opts.maxFailures;
    this.lockMs = opts.lockMs;
    this.clock = opts.clock;
  }

  /** Seconds remaining if locked, else 0. */
  lockedFor(key: string): number {
    const s = this.state.get(key);
    if (!s) return 0;
    const left = s.lockedUntil - this.clock.now().getTime();
    if (left > 0) return Math.ceil(left / 1000);
    if (s.lockedUntil !== 0) this.state.delete(key); // lock elapsed → fresh start
    return 0;
  }

  recordFailure(key: string): void {
    const s = this.state.get(key) ?? { failures: 0, lockedUntil: 0 };
    s.failures += 1;
    if (s.failures >= this.maxFailures) s.lockedUntil = this.clock.now().getTime() + this.lockMs;
    this.state.set(key, s);
  }

  recordSuccess(key: string): void {
    this.state.delete(key);
  }
}

/**
 * Client IP for rate-limit keys. X-Forwarded-For is attacker-controlled unless it was appended by a proxy WE run,
 * so it is ignored (hops = 0) unless the operator declares how many trusted proxies sit in front of the app.
 */
export function clientIp(req: IncomingMessage, trustedProxyHops: number): string {
  const direct = req.socket.remoteAddress ?? 'unknown';
  if (trustedProxyHops <= 0) return direct;
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  if (!raw) return direct;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - trustedProxyHops] ?? direct;
}
