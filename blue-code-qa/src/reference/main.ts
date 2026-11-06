import { loadConfig } from './config.ts';
import { HttpPayUGateway } from './gateway.ts';
import { createApp, HIGH_LIMITS } from './server.ts';

const config = loadConfig(process.env);
const gateway = config.mockPayuUi ? undefined : new HttpPayUGateway({ key: config.payuKey, salt: config.payuSalt, verifyUrl: config.payuVerifyUrl });
// RELAX_RATE_LIMITS exists ONLY so automated browser tests can register many users per minute. Refused in production.
const relax = process.env['RELAX_RATE_LIMITS'] === 'true';
if (relax && config.nodeEnv === 'production') throw new Error('RELAX_RATE_LIMITS must not be set in production');
const app = createApp({ config, ...(gateway ? { gateway } : {}), ...(relax ? { limits: HIGH_LIMITS } : {}) });
app.start().then((u) => console.log(`Blue Code reference app listening on ${u} (env=${config.nodeEnv})`));
