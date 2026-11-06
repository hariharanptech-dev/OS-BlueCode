"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestHash = requestHash;
exports.responseHash = responseHash;
exports.apiHash = apiHash;
exports.safeEqualHex = safeEqualHex;
const crypto_1 = require("crypto");
/**
 * Hash rules verified against docs.payu.in (Authentication with PayU APIs, Hosted Checkout,
 * Verify Payment API). Do NOT change field order without re-checking the docs.
 *
 *  Request : sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
 *  Response: sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 *            with additionalCharges: sha512(additionalCharges|SALT|status||||||udf5|...|key)
 *  API     : sha512(key|command|var1|SALT)
 */
const sha512 = (s) => (0, crypto_1.createHash)('sha512').update(s, 'utf8').digest('hex');
function requestHash(p, salt) {
    return sha512([
        p.key, p.txnid, p.amount, p.productinfo, p.firstname, p.email,
        p.udf1 ?? '', p.udf2 ?? '', p.udf3 ?? '', p.udf4 ?? '', p.udf5 ?? '',
        '', '', '', '', '', salt,
    ].join('|'));
}
function responseHash(r, salt) {
    const g = (k) => r[k] ?? '';
    const parts = [
        salt, g('status'), '', '', '', '', '',
        g('udf5'), g('udf4'), g('udf3'), g('udf2'), g('udf1'),
        g('email'), g('firstname'), g('productinfo'), g('amount'), g('txnid'), g('key'),
    ];
    // PayU docs: when additionalCharges is posted back, it is prepended to the reverse hash string.
    if (r['additionalCharges'])
        parts.unshift(r['additionalCharges']);
    return sha512(parts.join('|'));
}
function apiHash(key, command, var1, salt) {
    return sha512([key, command, var1, salt].join('|'));
}
function safeEqualHex(a, b) {
    const x = Buffer.from(a.trim().toLowerCase(), 'utf8');
    const y = Buffer.from(b.trim().toLowerCase(), 'utf8');
    return x.length === y.length && (0, crypto_1.timingSafeEqual)(x, y);
}
