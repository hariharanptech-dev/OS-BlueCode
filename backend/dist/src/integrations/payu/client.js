"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayuClient = void 0;
const hash_1 = require("./hash");
/**
 * Server-to-server Verify Payment API: POST form key, command=verify_payment, var1=txnid,
 * hash=sha512(key|command|var1|salt). Response JSON: { status, msg, transaction_details: { [txnid]: {...} } }.
 * Response shape follows docs.payu.in; confirm field names (amt vs amount) against your sandbox account.
 */
class PayuClient {
    cfg;
    fetchImpl;
    constructor(cfg, fetchImpl = fetch) {
        this.cfg = cfg;
        this.fetchImpl = fetchImpl;
    }
    async verifyTransaction(txnid) {
        const body = new URLSearchParams({
            key: this.cfg.key, command: 'verify_payment', var1: txnid,
            hash: (0, hash_1.apiHash)(this.cfg.key, 'verify_payment', txnid, this.cfg.salt),
        });
        const res = await this.fetchImpl(this.cfg.verifyUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body, signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok)
            throw new Error(`PayU verify HTTP ${res.status}`);
        const json = JSON.parse(await res.text());
        const d = json?.transaction_details?.[txnid];
        if (!d || typeof d !== 'object' || d.status === 'Not Found')
            return { found: false, status: 'not_found' };
        if (typeof d.status !== 'string')
            throw new Error('PayU verify: malformed transaction_details');
        const str = (v) => (v === undefined || v === null ? undefined : String(v));
        return { found: true, status: d.status.toLowerCase(), mihpayid: str(d.mihpayid),
            amount: str(d.amt ?? d.amount), unmappedstatus: str(d.unmappedstatus) };
    }
}
exports.PayuClient = PayuClient;
