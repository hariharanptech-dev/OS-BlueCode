"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPaymentForm = buildPaymentForm;
const hash_1 = require("./hash");
/** Returns only what the browser needs to POST to PayU. The salt never leaves the server. */
function buildPaymentForm(cfg, i) {
    const fields = {
        key: cfg.key, txnid: i.txnid, amount: i.amountInRupees, productinfo: i.productinfo,
        firstname: i.firstname, email: i.email, phone: i.phone ?? '',
        surl: i.successUrl, furl: i.failureUrl, udf1: i.orderId,
    };
    fields.hash = (0, hash_1.requestHash)({ ...fields, udf1: i.orderId }, cfg.salt);
    return { action: cfg.baseUrl, method: 'POST', fields };
}
