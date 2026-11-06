import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpPayUGateway, GatewayError } from '../../src/reference/gateway.ts';
import { verifyApiHash } from '../../src/security/index.ts';

/** Local stub of PayU's verify_payment endpoint: exercises the REAL HTTP client code path (timeouts, 5xx, parsing). */
let server: http.Server; let url = ''; let mode = 'ok'; let calls = 0; let lastBody = '';
before(async () => {
  server = http.createServer((req, res) => {
    calls++; let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      lastBody = b;
      if (mode === 'hang') return; // never respond
      if (mode === '500') { res.writeHead(500); return res.end('boom'); }
      if (mode === '400') { res.writeHead(400); return res.end('bad'); }
      if (mode === 'flaky' && calls % 2 === 1) { res.writeHead(502); return res.end(); }
      if (mode === 'garbage') { res.writeHead(200); return res.end('<html>not json</html>'); }
      if (mode === 'notfound') { res.writeHead(200); return res.end(JSON.stringify({ status: 0, msg: '0 out of 1 Transactions Fetched Successfully', transaction_details: { T1: 'No Transaction Found' } })); }
      if (mode === 'nofields') { res.writeHead(200); return res.end(JSON.stringify({ transaction_details: { T1: { mihpayid: '1' } } })); }
      res.writeHead(200, { 'content-type': 'application/json' });
      // raw JSON with an UNQUOTED 18-digit id (> 2^53) to prove the client does not round it
      res.end('{"status":1,"msg":"ok","transaction_details":{"T1":{"mihpayid":403993715500000001,"status":"success","transaction_amount":"499.00","amt":"499.00"}}}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${(server.address() as any).port}/verify`;
});
after(() => { server.closeAllConnections(); server.close(); });
const gw = (o: Partial<ConstructorParameters<typeof HttpPayUGateway>[0]> = {}) => new HttpPayUGateway({ key: 'K', salt: 'SALTSALT-1234', verifyUrl: url, timeoutMs: 300, retries: 1, ...o });
const reset = (m: string) => { mode = m; calls = 0; };

describe('HttpPayUGateway (real HTTP code path against a local stub)', () => {
  it('parses a successful verification and preserves 18-digit ids exactly', async () => {
    reset('ok'); const r = await gw().verifyPayment('T1');
    assert.deepEqual(r, { found: true, status: 'success', amount: '499.00', mihpayid: '403993715500000001', currency: undefined });
  });
  it('sends key, command, var1 and a correct hash — and NEVER the salt itself', async () => {
    reset('ok'); await gw().verifyPayment('T1');
    const p = new URLSearchParams(lastBody);
    assert.equal(p.get('command'), 'verify_payment'); assert.equal(p.get('var1'), 'T1'); assert.equal(p.get('key'), 'K');
    assert.equal(p.get('hash'), verifyApiHash('K', 'verify_payment', 'T1', 'SALTSALT-1234'));
    assert.ok(!lastBody.includes('SALTSALT-1234'));
  });
  it('reports unknown transactions as not found (not as an error)', async () => { reset('notfound'); assert.equal((await gw().verifyPayment('T1')).found, false); });
  it('times out on a hung gateway and surfaces GatewayError(timeout) after retry', async () => {
    reset('hang'); const t0 = Date.now();
    await assert.rejects(() => gw().verifyPayment('T1'), (e: unknown) => e instanceof GatewayError && e.kind === 'timeout');
    assert.equal(calls, 2, 'one retry'); assert.ok(Date.now() - t0 < 1500);
  });
  it('retries once on 5xx and recovers when the second attempt succeeds', async () => { reset('flaky'); assert.equal((await gw().verifyPayment('T1')).status, 'success'); assert.equal(calls, 2); });
  it('fails after retries on persistent 5xx', async () => { reset('500'); await assert.rejects(() => gw().verifyPayment('T1'), (e: unknown) => e instanceof GatewayError && e.kind === 'http'); assert.equal(calls, 2); });
  it('does not retry 4xx', async () => { reset('400'); await assert.rejects(() => gw().verifyPayment('T1'), GatewayError); assert.equal(calls, 1); });
  it('rejects non-JSON bodies as malformed (no retry)', async () => { reset('garbage'); await assert.rejects(() => gw().verifyPayment('T1'), (e: unknown) => e instanceof GatewayError && e.kind === 'malformed'); assert.equal(calls, 1); });
  it('rejects responses missing status/amount as malformed', async () => { reset('nofields'); await assert.rejects(() => gw().verifyPayment('T1'), (e: unknown) => e instanceof GatewayError && e.kind === 'malformed'); });
  it('surfaces connection refusal as a network error', async () => {
    await assert.rejects(() => new HttpPayUGateway({ key: 'K', salt: 'SALTSALT-1234', verifyUrl: 'http://127.0.0.1:1/x', timeoutMs: 300, retries: 0 }).verifyPayment('T1'), (e: unknown) => e instanceof GatewayError && e.kind === 'network');
  });
  it('error messages never contain the salt or request hash', async () => {
    reset('500'); try { await gw().verifyPayment('T1'); } catch (e) { assert.ok(!String((e as Error).message).includes('SALTSALT')); }
  });
});
