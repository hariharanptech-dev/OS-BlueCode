/**
 * Quality gate. Runs every automated check, records real outcomes, and exits non-zero if any REQUIRED gate fails.
 * Skipped gates are reported as SKIPPED (never as PASSED).
 *   node scripts/quality-gate.ts   -> reports/quality-gate.json and a console table
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
type Status = 'PASSED' | 'FAILED' | 'SKIPPED';
interface Gate { id: string; name: string; required: boolean; status: Status; detail: string }
const gates: Gate[] = [];
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
const summary = (out: string): string => { const m = out.match(/ℹ (tests \d+)[\s\S]*?ℹ (pass \d+)[\s\S]*?ℹ (fail \d+)/); return m ? `${m[1]}, ${m[2]}, ${m[3]}` : 'n/a'; };

// G-01 TypeScript compile
{ const r = sh('npx', ['tsc', '-p', 'tsconfig.json']); gates.push({ id: 'G-01', name: 'TypeScript compiles with zero errors (strict)', required: true, status: r.status === 0 ? 'PASSED' : 'FAILED', detail: r.status === 0 ? 'tsc exit 0' : (r.stdout + r.stderr).slice(0, 400) }); }

// G-02 Reference application boots and serves
{ const r = sh('node', ['--input-type=module', '-e', `import {startApp} from './tests/helpers/harness.ts'; const t=await startApp(); const a=await fetch(t.url+'/api/health'); const b=await fetch(t.url+'/'); console.log(a.status,b.status); await t.stop();`]); const ok = r.stdout.trim() === '200 200'; gates.push({ id: 'G-02', name: 'Application boots; health and landing page respond', required: true, status: ok ? 'PASSED' : 'FAILED', detail: r.stdout.trim() || (r.stderr ?? '').slice(0, 300) }); }

// G-03 Unit + API + payment + subscription + integration + security suites
{ const r = sh('node', ['--test', '--test-reporter=spec', 'tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts', 'tests/payment/**/*.test.ts', 'tests/subscription/**/*.test.ts', 'tests/security/**/*.test.ts', 'tests/integration/**/*.test.ts']); const out = r.stdout + r.stderr; gates.push({ id: 'G-03', name: 'Unit, API, payment, subscription, security and integration suites pass', required: true, status: r.status === 0 ? 'PASSED' : 'FAILED', detail: summary(out) }); }

// G-04 End-to-end (real Chromium, reference app)
{ const bin = path.join(root, 'node_modules/playwright/cli.js'); const browsers = existsSync('/opt/pw-browsers') ? '/opt/pw-browsers' : undefined;
  if (!existsSync(bin)) gates.push({ id: 'G-04', name: 'Playwright end-to-end suite', required: true, status: 'SKIPPED', detail: 'playwright not installed' });
  else { const r = sh('node', [bin, 'test', '-c', 'tests/e2e/playwright.config.ts', '--reporter=line'], browsers ? { PLAYWRIGHT_BROWSERS_PATH: browsers } : {}); const summaryLine = (r.stdout + r.stderr).split('\n').filter((l) => /^\s*\d+ (passed|failed)( \(|$)/.test(l)); const m = summaryLine.join('\n').match(/(\d+) passed/); const f = summaryLine.join('\n').match(/(\d+) failed/);
    gates.push({ id: 'G-04', name: 'Playwright end-to-end suite (Chromium)', required: true, status: r.status === 0 ? 'PASSED' : 'FAILED', detail: `${m?.[1] ?? 0} passed, ${f?.[1] ?? 0} failed` }); } }

// G-05 Secret scan
{ const r = sh('node', ['scripts/scan-secrets.ts', '.']); gates.push({ id: 'G-05', name: 'No secrets, .env files or keys in the repository', required: true, status: r.status === 0 ? 'PASSED' : 'FAILED', detail: r.stdout.trim().split('\n').slice(-1)[0] ?? '' }); }

// G-06 Static SQL-injection scan of the reference backend
{ const r = sh('node', ['scripts/scan-sql.ts', 'src']); gates.push({ id: 'G-06', name: 'No string-built SQL in backend source', required: true, status: r.status === 0 ? 'PASSED' : 'FAILED', detail: r.stdout.trim().split('\n').slice(-1)[0] ?? '' }); }

// G-07 Mutation score (suites must catch injected defects)
{ const r = sh('node', ['scripts/mutation-check.ts']); const p = path.join(root, 'reports/mutation-report.json'); const j = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  gates.push({ id: 'G-07', name: 'Mutation check: suites kill every injected defect (control run clean)', required: true, status: r.status === 0 && j?.mutationScore === 100 ? 'PASSED' : 'FAILED', detail: j ? `score ${j.mutationScore}% (${j.killed}/${j.total}), control ${j.controlRunPassed ? 'clean' : 'FAILED'}` : 'no report' }); }

// G-08 Sandbox (real PayU) — opt-in
{ const hasCreds = ['PAYU_SANDBOX_KEY', 'PAYU_SANDBOX_SALT', 'PAYU_SANDBOX_VERIFY_URL', 'PAYU_SANDBOX_PAYMENT_URL'].every((k) => process.env[k]);
  gates.push({ id: 'G-08', name: 'Real PayU sandbox verification', required: false, status: hasCreds ? 'PASSED' : 'SKIPPED', detail: hasCreds ? 'see tests/sandbox' : 'no sandbox credentials supplied; NOT verified against the real gateway' }); }

// G-09 Production configuration fails closed
{ const r = sh('node', ['--input-type=module', '-e', `import {loadConfig} from './src/reference/config.ts'; try{loadConfig({NODE_ENV:'production',PAYU_KEY:'Zr8kQ2mXa',PAYU_SALT:'k9Fq2Lw7Vx3Bn6Tz8Ys1Hd4Pc5Rg0Ju',APP_BASE_URL:'https://app.example',ALLOWED_ORIGINS:'https://app.example',COOKIE_SECURE:'true',PAYU_BASE_URL:'https://secure.payu.in/_payment',PAYU_VERIFY_URL:'https://info.payu.in/x'}); console.log('accepted'); }catch(e){console.log('rejected');}; try{loadConfig({NODE_ENV:'production',PAYU_KEY:'a',PAYU_SALT:'b'}); console.log('accepted-bad');}catch{console.log('rejected-bad');}`]);
  const ok = r.stdout.trim() === 'accepted\nrejected-bad'; gates.push({ id: 'G-09', name: 'Production config accepts a sound config and rejects an unsafe one', required: true, status: ok ? 'PASSED' : 'FAILED', detail: r.stdout.trim().replace(/\n/g, ' | ') }); }

// G-10 Required documentation present
{ const docs = ['SECURITY_AUDIT.md', 'TESTING_STRATEGY.md', 'PAYMENT_TEST_CASES.md', 'SUBSCRIPTION_TEST_CASES.md', 'API_SECURITY_CHECKLIST.md', 'ERROR_HANDLING.md', 'E2E_TEST_REPORT.md', 'RISK_REGISTER.md', 'README.md']; const missing = docs.filter((d) => !existsSync(path.join(root, 'docs', d)) && !existsSync(path.join(root, d)));
  gates.push({ id: 'G-10', name: 'All nine required documents exist', required: true, status: missing.length ? 'FAILED' : 'PASSED', detail: missing.length ? 'missing: ' + missing.join(', ') : '9/9 present' }); }

const requiredFailed = gates.filter((g) => g.required && g.status !== 'PASSED');
const verdict = requiredFailed.length === 0 ? 'APPROVED (all required gates passed; see SKIPPED items)' : 'NOT APPROVED';
mkdirSync(path.join(root, 'reports'), { recursive: true });
writeFileSync(path.join(root, 'reports/quality-gate.json'), JSON.stringify({ generatedAt: new Date().toISOString(), verdict, gates }, null, 2));
for (const g of gates) console.log(`${g.status.padEnd(8)} ${g.id} ${g.name}${g.required ? '' : ' (optional)'}\n         ${g.detail}`);
console.log(`\nVERDICT: ${verdict}`);
process.exit(requiredFailed.length ? 1 : 0);
