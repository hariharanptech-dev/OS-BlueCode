import { randomBytes, createHash } from 'crypto';
/** txnid: 22 chars, alphanumeric only (PayU txnid limit is 25 chars). */
export const newTxnid = () => 'BC' + randomBytes(10).toString('hex');
export const newOrderId = () => 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + randomBytes(4).toString('hex').toUpperCase();
export const stableHash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
