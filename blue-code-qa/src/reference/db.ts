import { randomUUID } from 'node:crypto';
import { AppError } from '../security/index.ts';
import type { Order, PaymentEvent, Subscription, User } from './types.ts';

export class UniqueViolation extends Error {
  readonly constraint: string;
  constructor(constraint: string) {
    super(`unique violation: ${constraint}`);
    this.name = 'UniqueViolation';
    this.constraint = constraint;
  }
}

type Tables = { users: Map<string, User>; orders: Map<string, Order>; events: PaymentEvent[]; subs: Map<string, Subscription> };
const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory stand-in for the real database. Models the properties the payment logic relies on:
 * serialised transactions with rollback, UNIQUE constraints, and injectable faults.
 * It does NOT prove behaviour of the real DB engine (see RISK_REGISTER R-01).
 */
export class Db {
  private t: Tables = { users: new Map(), orders: new Map(), events: [], subs: new Map() };
  private lock: Promise<void> = Promise.resolve();
  private depth = 0;
  private failures: Array<{ op: string; remaining: number }> = [];

  /** Make the next `times` calls of `op` (method name, or '*') throw DB_UNAVAILABLE. */
  injectFailure(op: string, times = 1): void {
    this.failures.push({ op, remaining: times });
  }
  clearFailures(): void {
    this.failures = [];
  }
  private maybeFail(op: string): void {
    const f = this.failures.find((x) => (x.op === op || x.op === '*') && x.remaining > 0);
    if (f) {
      f.remaining -= 1;
      throw new AppError('DB_UNAVAILABLE', { internal: { op, injected: true } });
    }
  }

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(); // nested: join outer
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    const snapshot: Tables = { users: clone(this.t.users), orders: clone(this.t.orders), events: clone(this.t.events), subs: clone(this.t.subs) };
    this.depth++;
    try {
      return await fn();
    } catch (e) {
      this.t = snapshot; // rollback
      throw e;
    } finally {
      this.depth--;
      release();
    }
  }

  // ---- users
  insertUser(u: Omit<User, 'id' | 'createdAt'>, now: Date): User {
    this.maybeFail('insertUser');
    for (const x of this.t.users.values()) if (x.email === u.email) throw new UniqueViolation('users.email');
    const user: User = { ...u, id: randomUUID(), createdAt: now.toISOString() };
    this.t.users.set(user.id, user);
    return clone(user);
  }
  findUserByEmail(email: string): User | undefined {
    this.maybeFail('findUserByEmail');
    for (const u of this.t.users.values()) if (u.email === email) return clone(u);
    return undefined;
  }
  findUserById(id: string): User | undefined {
    this.maybeFail('findUserById');
    const u = this.t.users.get(id);
    return u ? clone(u) : undefined;
  }

  // ---- orders
  insertOrder(o: Order): Order {
    this.maybeFail('insertOrder');
    for (const x of this.t.orders.values()) {
      if (x.txnid === o.txnid) throw new UniqueViolation('orders.txnid');
      if (o.idempotencyKey && x.userId === o.userId && x.idempotencyKey === o.idempotencyKey) throw new UniqueViolation('orders.user_idempotency');
    }
    this.t.orders.set(o.id, clone(o));
    return clone(o);
  }
  getOrder(id: string): Order | undefined {
    this.maybeFail('getOrder');
    const o = this.t.orders.get(id);
    return o ? clone(o) : undefined;
  }
  getOrderByTxnid(txnid: string): Order | undefined {
    this.maybeFail('getOrderByTxnid');
    for (const o of this.t.orders.values()) if (o.txnid === txnid) return clone(o);
    return undefined;
  }
  updateOrder(o: Order): void {
    this.maybeFail('updateOrder');
    if (!this.t.orders.has(o.id)) throw new Error('order missing');
    this.t.orders.set(o.id, clone(o));
  }
  findByIdempotencyKey(userId: string, key: string): Order | undefined {
    for (const o of this.t.orders.values()) if (o.userId === userId && o.idempotencyKey === key) return clone(o);
    return undefined;
  }
  findOpenOrder(userId: string, planId: string, notBefore: Date): Order | undefined {
    for (const o of this.t.orders.values()) {
      if (o.userId === userId && o.planId === planId && o.status === 'pending' && new Date(o.createdAt) >= notBefore) return clone(o);
    }
    return undefined;
  }
  listOrdersByUser(userId: string, offset: number, limit: number): { rows: Order[]; total: number } {
    this.maybeFail('listOrdersByUser');
    const all = [...this.t.orders.values()].filter((o) => o.userId === userId).sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
    return { rows: all.slice(offset, offset + limit).map(clone), total: all.length };
  }
  listPendingOlderThan(cutoff: Date): Order[] {
    this.maybeFail('listPendingOlderThan');
    return [...this.t.orders.values()].filter((o) => o.status === 'pending' && new Date(o.createdAt) <= cutoff).map(clone);
  }
  /** Closed-but-unpaid orders touched since `since` (candidates for late-success rescue). */
  listClosedUnpaidSince(since: Date, limit: number): Order[] {
    this.maybeFail('listClosedUnpaidSince');
    return [...this.t.orders.values()].filter((o) => (o.status === 'failed' || o.status === 'cancelled' || o.status === 'expired') && new Date(o.updatedAt) >= since).slice(0, limit).map(clone);
  }
  allOrders(): Order[] {
    return [...this.t.orders.values()].map(clone);
  }

  // ---- events
  insertEvent(e: Omit<PaymentEvent, 'id'>): void {
    this.maybeFail('insertEvent');
    this.t.events.push({ ...e, id: randomUUID() });
  }
  eventsFor(txnid: string): PaymentEvent[] {
    return this.t.events.filter((e) => e.txnid === txnid).map(clone);
  }

  // ---- subscriptions
  insertSubscription(s: Omit<Subscription, 'id'>): Subscription {
    this.maybeFail('insertSubscription');
    for (const x of this.t.subs.values()) if (x.paymentId === s.paymentId) throw new UniqueViolation('subscriptions.payment_id');
    const sub: Subscription = { ...s, id: randomUUID() };
    this.t.subs.set(sub.id, sub);
    return clone(sub);
  }
  subscriptionsFor(userId: string): Subscription[] {
    this.maybeFail('subscriptionsFor');
    return [...this.t.subs.values()].filter((s) => s.userId === userId).sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1)).map(clone);
  }
  subscriptionByPayment(paymentId: string): Subscription | undefined {
    for (const s of this.t.subs.values()) if (s.paymentId === paymentId) return clone(s);
    return undefined;
  }
  allSubscriptions(): Subscription[] {
    return [...this.t.subs.values()].map(clone);
  }
  /** test-only seeding bypassing business rules */
  _seedOrders(rows: Order[]): void {
    for (const o of rows) this.t.orders.set(o.id, clone(o));
  }
}
