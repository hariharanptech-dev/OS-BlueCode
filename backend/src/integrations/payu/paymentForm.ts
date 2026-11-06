import { requestHash } from './hash';
import { PayuConfig } from './client';

export interface BuildFormInput {
  txnid: string; amountInRupees: string; productinfo: string; firstname: string; email: string;
  phone?: string; orderId: string; successUrl: string; failureUrl: string;
}

/** Returns only what the browser needs to POST to PayU. The salt never leaves the server. */
export function buildPaymentForm(cfg: PayuConfig, i: BuildFormInput) {
  const fields: Record<string, string> = {
    key: cfg.key, txnid: i.txnid, amount: i.amountInRupees, productinfo: i.productinfo,
    firstname: i.firstname, email: i.email, phone: i.phone ?? '',
    surl: i.successUrl, furl: i.failureUrl, udf1: i.orderId,
  };
  fields.hash = requestHash({ ...fields, udf1: i.orderId } as any, cfg.salt);
  return { action: cfg.baseUrl, method: 'POST' as const, fields };
}
