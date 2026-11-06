"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allowedFrom = exports.canTransition = exports.isTerminal = exports.TERMINAL = exports.TRANSITIONS = void 0;
exports.TRANSITIONS = {
    CREATED: ['PENDING', 'FAILED', 'CANCELLED', 'EXPIRED', 'VERIFICATION_PENDING', 'SUCCESS'],
    PENDING: ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'VERIFICATION_PENDING'],
    VERIFICATION_PENDING: ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
    SUCCESS: [], FAILED: [], CANCELLED: [], EXPIRED: [],
};
exports.TERMINAL = ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'];
const isTerminal = (s) => exports.TERMINAL.includes(s);
exports.isTerminal = isTerminal;
const canTransition = (from, to) => exports.TRANSITIONS[from].includes(to);
exports.canTransition = canTransition;
/** Statuses from which `to` may be reached; used as the compare-and-set guard. */
const allowedFrom = (to) => Object.keys(exports.TRANSITIONS).filter((f) => (0, exports.canTransition)(f, to));
exports.allowedFrom = allowedFrom;
