import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { requestHash, responseHash, safeEqual, verifyApiHash, toPaise, amountsEqual, formatPaise } from '../../src/security/index.ts';

const sha = (s: string) => createHash('sha512').update(s).digest('hex');
const base = { key: 'K1', txnid: 'T1', amount: '499.00', productinfo: 'Starter Monthly', firstname: 'Asha', email: 'a@x.test', udf1: 'starter_monthly' };

describe('PayU hash: known-answer vectors (literal strings, independent of implementation)', () => {
  it('request hash = sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||salt)', () => {
    // Build explicitly field by field to avoid pipe-counting mistakes:
    const fields = ['K1', 'T1', '499.00', 'Starter Monthly', 'Asha', 'a@x.test', 'starter_monthly', '', '', '', '', '', '', '', '', '', 'SALT'];
    assert.equal(fields.length, 17); // 6 core + 5 udf + 5 reserved + salt
    assert.equal(requestHash(base, 'SALT'), sha(fields.join('|')));
  });

  it('response hash is the REVERSE sequence and starts with salt|status', () => {
    const fields = ['SALT', 'success', '', '', '', '', '', '', '', '', '', 'starter_monthly', 'a@x.test', 'Asha', 'Starter Monthly', '499.00', 'T1', 'K1'];
    // salt,status, 5 reserved empties, udf5..udf2 (4 empties), udf1, email, firstname, productinfo, amount, txnid, key
    assert.equal(fields.length, 18);
    assert.equal(responseHash({ ...base, status: 'success' }, 'SALT'), sha(fields.join('|')));
  });

  it('additionalCharges is prepended when present, changing the hash', () => {
    const plain = responseHash({ ...base, status: 'success' }, 'SALT');
    const withCharges = responseHash({ ...base, status: 'success', additionalCharges: '12.00' }, 'SALT');
    assert.notEqual(plain, withCharges);
    assert.equal(withCharges, sha('12.00|' + ['SALT', 'success', '', '', '', '', '', '', '', '', '', 'starter_monthly', 'a@x.test', 'Asha', 'Starter Monthly', '499.00', 'T1', 'K1'].join('|')));
  });

  it('every signed field influences the hash (tamper sensitivity)', () => {
    const h = responseHash({ ...base, status: 'success' }, 'SALT');
    for (const [k, v] of Object.entries({ key: 'K2', txnid: 'T2', amount: '1.00', productinfo: 'x', firstname: 'B', email: 'b@x.test', udf1: 'other', status: 'failure' })) {
      assert.notEqual(responseHash({ ...base, status: 'success', [k]: v }, 'SALT'), h, `field ${k} must be covered by the hash`);
    }
    assert.notEqual(responseHash({ ...base, status: 'success' }, 'SALT2'), h);
  });

  it('verify_payment API hash = sha512(key|command|var1|salt)', () => {
    assert.equal(verifyApiHash('K1', 'verify_payment', 'T1', 'SALT'), sha('K1|verify_payment|T1|SALT'));
  });
});

describe('safeEqual', () => {
  it('equal, unequal, different-length and empty inputs never throw', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual('', 'a'), false);
  });
});

describe('amount handling (integer paise, no floats)', () => {
  it('parses canonical amounts', () => {
    assert.equal(toPaise('499'), 49900);
    assert.equal(toPaise('499.0'), 49900);
    assert.equal(toPaise('499.00'), 49900);
    assert.equal(toPaise('0.07'), 7);
    assert.equal(toPaise('14990.00'), 1499000);
  });
  it('rejects malformed amounts', () => {
    for (const bad of ['', ' 1', '1 ', '-1', '1e3', 'NaN', 'Infinity', '1.234', '01', '1,000', '1.', '.5', '0x10', '1;DROP', '１２'] ) assert.equal(toPaise(bad), null, JSON.stringify(bad));
  });
  it('equality is numeric, not string based', () => {
    assert.equal(amountsEqual('499', '499.00'), true);
    assert.equal(amountsEqual('499.10', '499.1'), true);
    assert.equal(amountsEqual('499.00', '499.01'), false);
    assert.equal(amountsEqual('499.00', 'abc'), false);
    assert.equal(amountsEqual('abc', 'abc'), false, 'two invalid amounts must never compare equal');
  });
  it('0.1+0.2 style float traps do not occur', () => {
    assert.equal(amountsEqual('0.30', String(0.1 + 0.2)), false); // 0.30000000000000004 is malformed => rejected
  });
  it('formatPaise round-trips', () => {
    assert.equal(formatPaise(49900), '499.00');
    assert.equal(formatPaise(7), '0.07');
  });
});
