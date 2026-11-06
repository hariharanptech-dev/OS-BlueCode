/**
 * Payment-event payloads are stored for AUDIT only. We use an ALLOW-LIST (not a deny-list): any key not listed
 * is dropped, so unknown provider fields (card data, hashes, PII, secrets) can never reach the database.
 * Values are coerced to short primitives. Keys are matched case-insensitively.
 */
const ALLOWED = new Set([
  'txnid', 'mihpayid', 'status', 'unmappedstatus', 'amount', 'currency', 'mode', 'bankcode', 'pg_type',
  'bank_ref_num', 'error', 'error_message', 'field9', 'addedon', 'net_amount_debit', 'source', 'verification_source',
  'orderid', 'reason', 'expected_amount_minor', 'received_amount_minor', 'expected_currency', 'received_currency',
  'plancode', 'amountminor', 'from', 'to', 'startdate', 'enddate', 'subscriptionid', 'outcome',
]);
const MAX_LEN = 256;

export function sanitizePayload(input: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED.has(k.toLowerCase())) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_LEN);
    else if (v instanceof Date) out[k] = v.toISOString();
  }
  return out;
}
