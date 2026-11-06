"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stableHash = exports.newOrderId = exports.newTxnid = void 0;
const crypto_1 = require("crypto");
/** txnid: 22 chars, alphanumeric only (PayU txnid limit is 25 chars). */
const newTxnid = () => 'BC' + (0, crypto_1.randomBytes)(10).toString('hex');
exports.newTxnid = newTxnid;
const newOrderId = () => 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + (0, crypto_1.randomBytes)(4).toString('hex').toUpperCase();
exports.newOrderId = newOrderId;
const stableHash = (v) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(v)).digest('hex');
exports.stableHash = stableHash;
