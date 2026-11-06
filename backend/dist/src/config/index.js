"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const zod_1 = require("zod");
const schema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().default(4000),
    DATABASE_URL: zod_1.z.string().min(1),
    SESSION_SECRET: zod_1.z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
    FRONTEND_URL: zod_1.z.string().url(),
    BACKEND_URL: zod_1.z.string().url(),
    PAYU_MERCHANT_KEY: zod_1.z.string().min(1),
    PAYU_MERCHANT_SALT: zod_1.z.string().min(1),
    PAYU_BASE_URL: zod_1.z.string().url(),
    PAYU_VERIFY_URL: zod_1.z.string().url(),
});
function loadConfig(env = process.env) {
    const e = schema.parse(env);
    if (e.NODE_ENV === 'production') {
        if (!e.PAYU_BASE_URL.startsWith('https://secure.payu.in'))
            throw new Error('Production must use https://secure.payu.in/_payment');
        if (!e.PAYU_VERIFY_URL.startsWith('https://info.payu.in'))
            throw new Error('Production must use https://info.payu.in verify URL');
        if (!e.BACKEND_URL.startsWith('https://'))
            throw new Error('BACKEND_URL must be https in production');
    }
    return {
        env: e.NODE_ENV, isProd: e.NODE_ENV === 'production', port: e.PORT, databaseUrl: e.DATABASE_URL,
        sessionSecret: e.SESSION_SECRET, frontendUrl: e.FRONTEND_URL, backendUrl: e.BACKEND_URL,
        payu: { key: e.PAYU_MERCHANT_KEY, salt: e.PAYU_MERCHANT_SALT, baseUrl: e.PAYU_BASE_URL, verifyUrl: e.PAYU_VERIFY_URL },
    };
}
