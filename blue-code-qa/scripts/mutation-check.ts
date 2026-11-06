/**
 * Defect-injection ("mutation") check: proves the suites can actually FAIL.
 * For each injected defect (reference app only, refused in production) the relevant test files are run with SUT_DEFECT=<defect>.
 * A defect is KILLED when the suite fails; SURVIVED means the tests would not have caught that bug.
 *   node scripts/mutation-check.ts            -> writes reports/mutation-report.json (+ prints table)
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const MUTANTS: Array<{ defect: string; bug: string; files: string[] }> = [
  { defect: 'skip-hash-verify', bug: 'callback hash is not verified', files: ['tests/payment/payment-invalid.test.ts'] },
  { defect: 'no-gateway-verify', bug: 'success trusted without server-to-server verification', files: ['tests/payment/payment-invalid.test.ts'] },
  { defect: 'no-amount-check', bug: 'callback amount not compared to the order', files: ['tests/payment/payment-invalid.test.ts'] },
  { defect: 'no-key-check', bug: 'merchant key in callback not compared', files: ['tests/payment/payment-invalid.test.ts'] },
  { defect: 'trust-client-amount', bug: 'checkout accepts a client-supplied price', files: ['tests/payment/payment-flow.test.ts'] },
  { defect: 'cancel-activates', bug: 'cancelled payments activate a subscription', files: ['tests/payment/payment-flow.test.ts'] },
  { defect: 'no-idempotency', bug: 'duplicate callbacks activate again / not de-duplicated', files: ['tests/payment/payment-duplicate.test.ts'] },
  { defect: 'no-state-guard', bug: 'closed payments can be flipped between failed/cancelled', files: ['tests/payment/payment-duplicate.test.ts'] },
  { defect: 'idor-payments', bug: "any user can read/refresh another user's payment", files: ['tests/security/authz.test.ts'] },
  { defect: 'no-login-throttle', bug: 'no brute-force lockout', files: ['tests/security/authn.test.ts'] },
  { defect: 'trust-xff', bug: 'X-Forwarded-For trusted for rate-limit/lockout keys', files: ['tests/security/authn.test.ts'] },
  { defect: 'logout-keeps-session', bug: 'logout does not invalidate the server session', files: ['tests/api/api-contract.test.ts'] },
  { defect: 'no-csrf', bug: 'CSRF token not enforced', files: ['tests/security/csrf-cors-headers.test.ts'] },
  { defect: 'allow-any-origin', bug: 'CORS reflects any origin with credentials', files: ['tests/security/csrf-cors-headers.test.ts'] },
  { defect: 'leak-stack', bug: 'stack traces returned in error responses', files: ['tests/security/injection-leakage.test.ts'] },
  { defect: 'log-secrets', bug: 'merchant salt not scrubbed from logs', files: ['tests/security/secrets-logging.test.ts', 'tests/security/injection-leakage.test.ts'] },
];

interface Result { defect: string; bug: string; killed: boolean; killedBy: string[]; seconds: number }

function run(m: (typeof MUTANTS)[number]): Promise<Result> {
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = '';
    const p = spawn('node', ['--test', '--test-reporter=spec', ...m.files], { cwd: root, env: { ...process.env, SUT_DEFECT: m.defect } });
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => {
      const failing = [...out.matchAll(/^\s*✖ (.+?) \(\d/gm)].map((x) => x[1]!);
      const leaf = failing.filter((n) => !/^(SEC|P-|A-|S-|INT)/.test(n)); // drop suite-level wrappers
      resolve({ defect: m.defect, bug: m.bug, killed: code !== 0, killedBy: [...new Set(leaf)].slice(0, 4), seconds: Math.round((Date.now() - t0) / 100) / 10 });
    });
  });
}

const results: Result[] = []; const queue = [...MUTANTS]; const CONCURRENCY = 3;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { for (let m = queue.shift(); m; m = queue.shift()) { const r = await run(m); results.push(r); console.log(`${r.killed ? 'KILLED  ' : 'SURVIVED'} ${r.defect.padEnd(22)} ${r.bug}`); } }));

// control run: with NO defect the same files must pass (otherwise "killed" is meaningless)
const control = await new Promise<number>((res) => { const p = spawn('node', ['--test', ...new Set(MUTANTS.flatMap((m) => m.files))], { cwd: root, stdio: 'ignore' }); p.on('close', (c) => res(c ?? 1)); });
results.sort((a, b) => a.defect.localeCompare(b.defect));
const killed = results.filter((r) => r.killed).length;
const report = { generatedAt: new Date().toISOString(), controlRunPassed: control === 0, total: results.length, killed, survived: results.length - killed, mutationScore: Math.round((killed / results.length) * 100), results };
mkdirSync(path.join(root, 'reports'), { recursive: true }); writeFileSync(path.join(root, 'reports/mutation-report.json'), JSON.stringify(report, null, 2));
console.log(`\ncontrol (no defect) ${control === 0 ? 'PASSED' : 'FAILED'}; mutation score ${report.mutationScore}% (${killed}/${results.length} killed)`);
process.exit(control === 0 && killed === results.length ? 0 : 1);
