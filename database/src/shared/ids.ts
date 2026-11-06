import { randomBytes, randomUUID } from 'node:crypto';

/** Internal order id (ours; never PayU's `mihpayid`). 36 chars. */
export const generateOrderId = (): string => `ord_${randomUUID().replace(/-/g, '')}`;
/** Merchant transaction id sent to PayU as `txnid`: alphanumeric, 23 chars (PayU's limit is 25; confirm in current docs). */
export const generateTransactionId = (): string => `T${randomBytes(11).toString('hex')}`;
