import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError, testConfig, assertProductionSafe } from '../../src/reference/config.ts';

const prod = {
  NODE_ENV: 'production', APP_BASE_URL: 'https://app.bluecode.example', ALLOWED_ORIGINS: 'https://app.bluecode.example',
  PAYU_KEY: 'Zr8kQ2mXa', PAYU_SALT: 'k9Fq2Lw7Vx3Bn6Tz8Ys1Hd4Pc5Rg0Ju', PAYU_BASE_URL: 'https://secure.payu.in/_payment',
  PAYU_VERIFY_URL: 'https://info.payu.in/merchant/postservice.php?form=2', COOKIE_SECURE: 'true',
};
const issues = (env: Record<string, string>): string[] => { try { loadConfig({ ...prod, ...env }); return []; } catch (e) { return (e as ConfigError).issues; } };

describe('configuration safety', () => {
  it('accepts a well-formed production configuration', () => assert.deepEqual(issues({}), []));
  it('requires merchant key and salt (fail closed)', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), ConfigError);
    assert.throws(() => loadConfig({ NODE_ENV: 'development', PAYU_KEY: 'k' }), ConfigError);
  });
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ['http base URL', { APP_BASE_URL: 'http://app.example', ALLOWED_ORIGINS: 'https://app.example' }, /https/],
    ['insecure cookies', { COOKIE_SECURE: 'false' }, /COOKIE_SECURE/],
    ['mock PayU UI enabled', { MOCK_PAYU_UI: 'true' }, /MOCK_PAYU_UI/],
    ['injected defects', { SUT_DEFECT: 'skip-hash-verify' }, /SUT_DEFECT/],
    ['wildcard CORS', { ALLOWED_ORIGINS: '*' }, /ALLOWED_ORIGINS/],
    ['http CORS origin', { ALLOWED_ORIGINS: 'http://app.example' }, /ALLOWED_ORIGINS/],
    ['placeholder salt', { PAYU_SALT: 'replace-with-your-payu-merchant-salt' }, /PAYU_SALT/],
    ['short salt', { PAYU_SALT: 'abc123' }, /PAYU_SALT/],
    ['placeholder key', { PAYU_KEY: 'test-key' }, /PAYU_KEY/],
    ['sandbox PayU URL', { PAYU_BASE_URL: 'https://test.payu.in/_payment' }, /sandbox/],
  ];
  for (const [name, env, re] of cases) it(`production rejects: ${name}`, () => { const i = issues(env); assert.ok(i.some((x) => re.test(x)), JSON.stringify(i)); });
  it('error messages name settings but NEVER leak their values', () => {
    try { loadConfig({ ...prod, PAYU_SALT: 'replace-with-LEAKME', COOKIE_SECURE: 'false' }); assert.fail('should throw'); }
    catch (e) { assert.ok(!(e as Error).message.includes('LEAKME')); assert.ok(!(e as Error).message.includes(prod.PAYU_KEY)); }
  });
  it('development config tolerates sandbox values', () => assert.doesNotThrow(() => loadConfig({ NODE_ENV: 'development', PAYU_KEY: 'k', PAYU_SALT: 's' })));
  it('defects parse only from SUT_DEFECT and are empty by default', () => {
    assert.equal(loadConfig({ NODE_ENV: 'development', PAYU_KEY: 'k', PAYU_SALT: 's' }).defects.size, 0);
    assert.ok(loadConfig({ NODE_ENV: 'development', PAYU_KEY: 'k', PAYU_SALT: 's', SUT_DEFECT: 'a,b' }).defects.has('a' as never));
  });
  it('test fixtures use obviously fake credentials', () => { const c = testConfig(); assert.match(c.payuSalt, /fake/); assert.doesNotThrow(() => assertProductionSafe.length); });
});
