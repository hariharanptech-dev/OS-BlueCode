import { apiHash } from './hash';

export interface PayuConfig { merchantId?: string; key: string; salt: string; baseUrl: string; verifyUrl: string; }
export interface VerifiedTxn { found: boolean; status: string; mihpayid?: string; amount?: string; unmappedstatus?: string }
export interface PayuGateway { verifyTransaction(txnid: string): Promise<VerifiedTxn>; }

/**
 * Server-to-server Verify Payment API: POST form key, command=verify_payment, var1=txnid,
 * hash=sha512(key|command|var1|salt). Response JSON: { status, msg, transaction_details: { [txnid]: {...} } }.
 * Response shape follows docs.payu.in; confirm field names (amt vs amount) against your sandbox account.
 */
export class PayuClient implements PayuGateway {
  constructor(private cfg: PayuConfig, private fetchImpl: typeof fetch = fetch) {}

  async verifyTransaction(txnid: string): Promise<VerifiedTxn> {
    const body = new URLSearchParams({
      key: this.cfg.key, command: 'verify_payment', var1: txnid,
      hash: apiHash(this.cfg.key, 'verify_payment', txnid, this.cfg.salt),
    });
    const res = await this.fetchImpl(this.cfg.verifyUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`PayU verify HTTP ${res.status}`);
    const json = JSON.parse(await res.text()) as { transaction_details?: Record<string, Record<string, unknown>> };
    const d = json?.transaction_details?.[txnid];
    if (!d || typeof d !== 'object' || d.status === 'Not Found') return { found: false, status: 'not_found' };
    if (typeof d.status !== 'string') throw new Error('PayU verify: malformed transaction_details');
    const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
    return { found: true, status: d.status.toLowerCase(), mihpayid: str(d.mihpayid),
             amount: str(d.amt ?? d.amount), unmappedstatus: str(d.unmappedstatus) };
  }
}
