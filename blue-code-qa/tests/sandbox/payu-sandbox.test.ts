/**
 * REAL PayU SANDBOX tests. Completely separate from the mocked suites and SKIPPED unless credentials are provided:
 *   PAYU_SANDBOX_KEY, PAYU_SANDBOX_SALT, PAYU_SANDBOX_VERIFY_URL (e.g. https://test.payu.in/merchant/postservice.php?form=2)
 *   PAYU_SANDBOX_PAYMENT_URL (e.g. https://test.payu.in/_payment)
 * STATUS: written but NEVER EXECUTED by the author (no network / credentials in the authoring environment).
 * Results from the mocked suites must NOT be cited as evidence of real gateway behaviour.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpPayUGateway } from '../../src/reference/gateway.ts';
import { requestHash } from '../../src/security/index.ts';

const key = process.env['PAYU_SANDBOX_KEY']; const salt = process.env['PAYU_SANDBOX_SALT']; const verifyUrl = process.env['PAYU_SANDBOX_VERIFY_URL']; const payUrl = process.env['PAYU_SANDBOX_PAYMENT_URL'];
const skip = key && salt && verifyUrl && payUrl ? false : 'PayU sandbox credentials not provided (set PAYU_SANDBOX_KEY/SALT/VERIFY_URL/PAYMENT_URL)';

describe('PayU sandbox (real network)', { skip }, () => {
  it('verify_payment authenticates with our hash and reports an unknown txnid as "not found" (not as an auth error)', async () => {
    const gw = new HttpPayUGateway({ key: key!, salt: salt!, verifyUrl: verifyUrl!, timeoutMs: 15_000 });
    const r = await gw.verifyPayment('BCQA' + Date.now()); assert.equal(r.found, false);
  });
  it('sandbox accepts our REQUEST hash format (hosted page is served, no "Invalid Hash" error)', async () => {
    const f = { key: key!, txnid: 'BCQA' + Date.now(), amount: '10.00', productinfo: 'QA Probe', firstname: 'QA', email: 'qa@example.test', udf1: 'qa' };
    const body = new URLSearchParams({ ...f, phone: '9999999999', surl: 'https://example.test/s', furl: 'https://example.test/f', hash: requestHash(f, salt!) });
    const res = await fetch(payUrl!, { method: 'POST', body, redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const text = res.status >= 300 && res.status < 400 ? '' : await res.text(); assert.ok(res.status < 500); assert.doesNotMatch(text, /invalid hash|hash mismatch/i);
  });
  it('MANUAL: complete a sandbox payment with PayU test cards and confirm surl callback hash validates with responseHash()', { todo: 'requires a human/browser at the PayU hosted page; see PAYMENT_TEST_CASES.md §Sandbox' }, () => undefined);
});
