import { randomInt } from 'node:crypto';
import { requestHash, responseHash, safeEqual, verifyApiHash, type PayUFields } from '../security/index.ts';

export interface VerifyResult {
  found: boolean;
  /** PayU transaction status: success | failure | userCancelled | pending | ... */
  status: string;
  amount: string;
  mihpayid: string | null;
  currency?: string | undefined;
}

export interface PayUGateway {
  /** Server-to-server transaction lookup. The ONLY source of truth for money movement. */
  verifyPayment(txnid: string): Promise<VerifyResult>;
}

export class GatewayError extends Error {
  readonly kind: 'timeout' | 'network' | 'http' | 'malformed';
  constructor(kind: GatewayError['kind'], message: string) {
    super(message);
    this.name = 'GatewayError';
    this.kind = kind;
  }
}

/** Real HTTP client for PayU's verify_payment API. Shape parsing must be confirmed against the sandbox (tests/sandbox). */
export class HttpPayUGateway implements PayUGateway {
  private readonly key: string;
  private readonly salt: string;
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(o: { key: string; salt: string; verifyUrl: string; timeoutMs?: number; retries?: number }) {
    this.key = o.key;
    this.salt = o.salt;
    this.url = o.verifyUrl;
    this.timeoutMs = o.timeoutMs ?? 8000;
    this.retries = o.retries ?? 1;
  }

  async verifyPayment(txnid: string): Promise<VerifyResult> {
    let last: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this.once(txnid);
      } catch (e) {
        last = e;
        if (e instanceof GatewayError && (e.kind === 'malformed' || (e.kind === 'http' && !/^5/.test(e.message)))) break; // not retryable
      }
    }
    throw last instanceof GatewayError ? last : new GatewayError('network', 'unexpected');
  }

  private async once(txnid: string): Promise<VerifyResult> {
    const body = new URLSearchParams({ key: this.key, command: 'verify_payment', var1: txnid, hash: verifyApiHash(this.key, 'verify_payment', txnid, this.salt) });
    let res: Response;
    try {
      res = await fetch(this.url, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const name = (e as { name?: string }).name;
      throw new GatewayError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', 'request failed');
    }
    if (!res.ok) throw new GatewayError('http', `${res.status}`);
    let json: unknown;
    try {
      // 18-digit ids exceed 2^53: quote them BEFORE parsing so JSON.parse cannot silently round them.
      json = JSON.parse((await res.text()).slice(0, 200_000).replace(/("mihpayid"\s*:\s*)(\d{12,})/g, '$1"$2"'));
    } catch {
      throw new GatewayError('malformed', 'invalid json');
    }
    if (typeof json !== 'object' || json === null) throw new GatewayError('malformed', 'not an object');
    const details = (json as { transaction_details?: Record<string, Record<string, unknown>> }).transaction_details;
    const d = details && typeof details === 'object' ? details[txnid] : undefined;
    if (!d || typeof d !== 'object') return { found: false, status: 'notfound', amount: '0', mihpayid: null };
    const amt = d['transaction_amount'] ?? d['amt'];
    if (typeof d['status'] !== 'string' || (typeof amt !== 'string' && typeof amt !== 'number')) throw new GatewayError('malformed', 'missing fields');
    return { found: true, status: d['status'], amount: String(amt), mihpayid: d['mihpayid'] != null ? String(d['mihpayid']) : null, currency: typeof d['currency'] === 'string' ? d['currency'] : undefined };
  }
}

export interface MockTxn {
  fields: Record<string, string>;
  status: 'initiated' | 'success' | 'failure' | 'userCancelled' | 'pending';
  mihpayid: string;
  amount: string;
  currency: string;
}

export type Outcome = 'success' | 'failure' | 'cancel';
const CB_STATUS: Record<Outcome, string> = { success: 'success', failure: 'failure', cancel: 'userCancelled' };

export interface CallbackOptions {
  /** Mutations applied BEFORE signing → hash is VALID for the mutated values (simulates compromised/mistaken upstream data). */
  resign?: Partial<Record<string, string>>;
  /** Mutations applied AFTER signing → hash is INVALID (simulates tampering in transit). */
  tamper?: Partial<Record<string, string>>;
  /** Sign with a different salt (attacker without the merchant salt). */
  wrongSalt?: boolean;
  /** Override reported status without touching the ledger. */
  statusOverride?: string;
  omit?: string[];
}

/** Deterministic stand-in for PayU: validates request hashes, keeps a ledger, signs callbacks like PayU, serves verify. */
export class MockPayUGateway implements PayUGateway {
  readonly txns = new Map<string, MockTxn>();
  verifyBehaviour: 'ok' | 'throw' | 'timeout' = 'ok';
  verifyCalls = 0;
  verifyDelayMs = 0;
  /** If set, verifyPayment lies about amount (simulates upstream disagreement). */
  verifyAmountOverride: string | null = null;
  private readonly key: string;
  private readonly salt: string;
  private seq = 0;

  constructor(key: string, salt: string) {
    this.key = key;
    this.salt = salt;
  }

  /** What PayU does when the customer's browser POSTs the payment form. */
  registerInitiation(form: Record<string, string>): MockTxn {
    const f: PayUFields = {
      key: form['key'] ?? '', txnid: form['txnid'] ?? '', amount: form['amount'] ?? '', productinfo: form['productinfo'] ?? '',
      firstname: form['firstname'] ?? '', email: form['email'] ?? '',
      udf1: form['udf1'] ?? '', udf2: form['udf2'] ?? '', udf3: form['udf3'] ?? '', udf4: form['udf4'] ?? '', udf5: form['udf5'] ?? '',
    };
    if (f.key !== this.key) throw new Error('Invalid merchant key');
    if (!safeEqual(form['hash'] ?? '', requestHash(f, this.salt))) throw new Error('Invalid hash');
    const txn: MockTxn = { fields: { ...form }, status: 'initiated', mihpayid: String(403993715500000000n + BigInt(++this.seq) * 7919n + BigInt(randomInt(1, 999))), amount: f.amount, currency: 'INR' };
    this.txns.set(f.txnid, txn);
    return txn;
  }

  /** Customer finishes (or abandons) the payment at PayU. Updates the ledger only. */
  settle(txnid: string, outcome: Outcome): void {
    const t = this.txns.get(txnid);
    if (!t) throw new Error('unknown txn');
    t.status = outcome === 'success' ? 'success' : outcome === 'failure' ? 'failure' : 'userCancelled';
  }

  /** Builds the POST body PayU would send to surl/furl/curl or the webhook. */
  callbackFor(txnid: string, outcome: Outcome, opt: CallbackOptions = {}): Record<string, string> {
    const t = this.txns.get(txnid);
    if (!t) throw new Error('unknown txn');
    const base: Record<string, string> = {
      key: this.key, txnid, amount: t.amount, productinfo: t.fields['productinfo'] ?? '', firstname: t.fields['firstname'] ?? '', email: t.fields['email'] ?? '',
      phone: t.fields['phone'] ?? '', udf1: t.fields['udf1'] ?? '', udf2: '', udf3: '', udf4: '', udf5: '',
      status: opt.statusOverride ?? CB_STATUS[outcome], mihpayid: t.mihpayid, currency: 'INR',
    };
    Object.assign(base, opt.resign ?? {});
    const hash = responseHash(
      { key: base['key']!, txnid: base['txnid']!, amount: base['amount']!, productinfo: base['productinfo']!, firstname: base['firstname']!, email: base['email']!, udf1: base['udf1']!, udf2: '', udf3: '', udf4: '', udf5: '', status: base['status']!, additionalCharges: base['additionalCharges'] },
      opt.wrongSalt ? 'attacker-guess-salt' : this.salt,
    );
    const out: Record<string, string> = { ...base, hash, ...(opt.tamper ?? {}) } as Record<string, string>;
    for (const k of opt.omit ?? []) delete out[k];
    return out;
  }

  async verifyPayment(txnid: string): Promise<VerifyResult> {
    this.verifyCalls++;
    if (this.verifyDelayMs) await new Promise((r) => setTimeout(r, this.verifyDelayMs));
    if (this.verifyBehaviour === 'throw') throw new GatewayError('network', 'mock outage');
    if (this.verifyBehaviour === 'timeout') throw new GatewayError('timeout', 'mock timeout');
    const t = this.txns.get(txnid);
    if (!t) return { found: false, status: 'notfound', amount: '0', mihpayid: null };
    return { found: true, status: t.status === 'initiated' ? 'pending' : t.status, amount: this.verifyAmountOverride ?? t.amount, mihpayid: t.mihpayid, currency: t.currency };
  }
}
