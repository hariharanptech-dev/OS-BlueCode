"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rupeesToPaise = exports.paiseToRupees = void 0;
/** Money is stored as integer paise. PayU wants a rupee string like "499.00". */
const paiseToRupees = (paise) => {
    if (!Number.isInteger(paise) || paise <= 0)
        throw new Error('invalid amount');
    return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
};
exports.paiseToRupees = paiseToRupees;
const rupeesToPaise = (s) => {
    const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s.trim());
    return m ? parseInt(m[1], 10) * 100 + parseInt((m[2] ?? '').padEnd(2, '0') || '0', 10) : null;
};
exports.rupeesToPaise = rupeesToPaise;
