import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Logger, MemorySink, redact, scrubString, AppError, toErrorResponse, ERROR_CATALOG, type ErrorCode } from '../../src/security/index.ts';

describe('log redaction', () => {
  it('redacts sensitive keys at any depth, case-insensitively', () => {
    const r = redact({ user: 'a', password: 'p', nested: { PAYU_SALT: 's', Authorization: 'Bearer x', arr: [{ sessionToken: 't', cvv: '123', ok: 1 }] }, hash: 'h', key: 'merchant' }) as any;
    assert.equal(r.password, '[REDACTED]');
    assert.equal(r.nested.PAYU_SALT, '[REDACTED]');
    assert.equal(r.nested.Authorization, '[REDACTED]');
    assert.equal(r.nested.arr[0].sessionToken, '[REDACTED]');
    assert.equal(r.nested.arr[0].cvv, '[REDACTED]');
    assert.equal(r.nested.arr[0].ok, 1);
    assert.equal(r.hash, '[REDACTED]');
    assert.equal(r.key, '[REDACTED]');
    assert.equal(r.user, 'a');
  });
  it('scrubs Luhn-valid card numbers but leaves other digit strings', () => {
    assert.equal(scrubString('card 4111 1111 1111 1111 ok'), 'card [REDACTED_PAN] ok');
    assert.equal(scrubString('4111-1111-1111-1111'), '[REDACTED_PAN]');
    assert.equal(scrubString('ref 1234567890123457'), 'ref 1234567890123457'); // fails Luhn
    assert.equal(scrubString('order 12345'), 'order 12345');
  });
  it('removes literal registered secrets even inside free text', () => {
    const sink = new MemorySink();
    const log = new Logger(sink, { secrets: ['SuperSecretSalt123'] });
    log.error('boom', { message: 'failed using SuperSecretSalt123 for request', other: { deep: 'x SuperSecretSalt123 y' } });
    assert.ok(!sink.text().includes('SuperSecretSalt123'));
    assert.ok(sink.text().includes('[REDACTED]'));
  });
  it('handles circular structures, Errors, and huge strings safely', () => {
    const sink = new MemorySink();
    const log = new Logger(sink);
    const a: any = { n: 1 }; a.self = a;
    log.info('circ', { a, err: new Error('with 4111111111111111 card'), big: 'x'.repeat(10_000) });
    const rec = sink.records()[0] as any;
    assert.equal(rec.a.self, '[circular]');
    assert.ok(!JSON.stringify(rec).includes('4111111111111111'));
    assert.ok(rec.big.length < 2100);
    assert.equal(rec.err.stack, undefined, 'Error objects are reduced to name/message/code');
  });
  it('emits one valid JSON object per line with level and event', () => {
    const sink = new MemorySink();
    const log = new Logger(sink, { base: { svc: 'x' } });
    log.security('callback.invalid_hash', { txnid: 'T' });
    const r = sink.records()[0]!;
    assert.equal(r['level'], 'security'); assert.equal(r['event'], 'callback.invalid_hash'); assert.equal(r['svc'], 'x');
  });
});

describe('log redaction: secrets embedded in free text (DEF-002)', () => {
  it('scrubs key=value and key: value secrets', () => {
    for (const [i, o] of [['connect failed password=hunter2 host=db', 'connect failed password=[REDACTED] host=db'], ['token: abc123XYZ end', 'token: [REDACTED] end'], ['PAYU_SALT=s3cr3tvalue', 'PAYU_SALT=[REDACTED]'.replace('PAYU_SALT', 'PAYU_SALT')], ['Authorization: Bearer eyJhbGciOi.x.y', 'Authorization: [REDACTED]'], ['{"password":"p@ss w0rd","a":1}', '{"password":[REDACTED],"a":1}']] as const) assert.equal(scrubString(i), o, i);
  });
  it('scrubs credentials inside connection URLs', () => assert.equal(scrubString('ECONNREFUSED postgres://app:Sup3rS3cret@10.0.0.5:5432/db'), 'ECONNREFUSED postgres://app:[REDACTED]@10.0.0.5:5432/db'));
  it('does not mangle ordinary text', () => { for (const x of ['order created for plan pro_monthly', 'tokenizer finished', 'user logged in at 10:00']) assert.equal(scrubString(x), x); });
});

describe('error strategy', () => {
  it('every catalogued code has a status, a user-safe message and no technical jargon', () => {
    for (const [code, e] of Object.entries(ERROR_CATALOG)) {
      assert.ok(e.status >= 400 && e.status < 600, code);
      assert.ok(e.message.length > 10, code);
      assert.doesNotMatch(e.message, /(stack|exception|sql|null|undefined|node_modules|ECONN|\bat \w+\()/i, code);
    }
  });
  it('AppError → response uses public message only, never internal detail', () => {
    const e = new AppError('INVALID_CALLBACK', { internal: { reason: 'hash', salt: 'LEAK' } });
    const r = toErrorResponse(e, 'req-1');
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'INVALID_CALLBACK');
    assert.ok(!JSON.stringify(r).includes('LEAK'));
    assert.ok(!JSON.stringify(r).includes('hash'));
  });
  it('unknown errors collapse to INTERNAL_ERROR 500 with no message/stack', () => {
    for (const thrown of [new Error('ECONNREFUSED 10.0.0.5:5432 password=hunter2'), new TypeError('x is undefined'), 'string', null, { sql: 'SELECT *' }]) {
      const r = toErrorResponse(thrown, 'r');
      assert.equal(r.status, 500);
      assert.equal(r.body.error.code, 'INTERNAL_ERROR');
      assert.ok(!JSON.stringify(r.body).match(/ECONN|hunter2|undefined|SELECT|10\.0/));
    }
  });
  it('rate-limit style errors expose Retry-After (min 1s)', () => {
    assert.equal(toErrorResponse(new AppError('RATE_LIMITED', { retryAfterSec: 0.2 }), 'r').headers['Retry-After'], '1');
    assert.equal(toErrorResponse(new AppError('ACCOUNT_THROTTLED', { retryAfterSec: 899.1 }), 'r').headers['Retry-After'], '900');
  });
  it('field errors are exposed for validation failures only as path/reason pairs', () => {
    const r = toErrorResponse(new AppError('VALIDATION_FAILED', { fieldErrors: [{ path: 'email', reason: 'invalid value' }] }), 'r');
    assert.deepEqual(r.body.error.fields, [{ path: 'email', reason: 'invalid value' }]);
  });
  it('error codes are stable identifiers (guards against accidental renames)', () => {
    const expected: ErrorCode[] = ['VALIDATION_FAILED', 'AUTH_REQUIRED', 'SESSION_EXPIRED', 'INVALID_CREDENTIALS', 'ACCOUNT_THROTTLED', 'RATE_LIMITED', 'CSRF_FAILED', 'FORBIDDEN_ORIGIN', 'NOT_FOUND', 'METHOD_NOT_ALLOWED', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'EMAIL_UNAVAILABLE', 'PLAN_INVALID', 'SUBSCRIPTION_ACTIVE', 'IDEMPOTENCY_KEY_USED', 'PAYMENT_INIT_FAILED', 'INVALID_CALLBACK', 'GATEWAY_UNAVAILABLE', 'DB_UNAVAILABLE', 'INTERNAL_ERROR'];
    assert.deepEqual(Object.keys(ERROR_CATALOG).sort(), [...expected].sort());
  });
});
