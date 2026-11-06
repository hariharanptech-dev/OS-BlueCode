/**
 * Lightweight repository secret scanner (no dependencies).
 * Flags: committed .env files, hard-coded secret-looking assignments, private keys, cloud keys, and missing .gitignore protection.
 * It is a safety net, NOT a replacement for gitleaks/trufflehog in CI (see SECURITY_AUDIT.md).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface Finding { severity: 'critical' | 'high' | 'medium'; rule: string; file: string; line?: number; detail: string }

const SKIP_DIRS = new Set(['node_modules', '.git', 'reports', 'test-results', 'playwright-report']);
const TEXT_EXT = /\.(ts|js|mjs|cjs|json|md|html|css|yml|yaml|env|txt|sh|sql|toml)$/i;
const PLACEHOLDER = /(replace|change|example|placeholder|dummy|fake|test|your|xxx|todo|process\.env|\$\{|<.*>|\.\.\.|redacted|not-real)/i;
const ASSIGN = /\b([A-Za-z_]*(?:SALT|SECRET|PASSWORD|API_?KEY|TOKEN|PRIVATE_?KEY|MERCHANT_?KEY|PAYU_?KEY))\s*[:=]\s*(['"`])([A-Za-z0-9+/_\-=.]{12,})\2/i;
const ASSIGN_BARE = /^\s*(?:export\s+)?([A-Za-z_]*(?:SALT|SECRET|PASSWORD|API_?KEY|TOKEN|PRIVATE_?KEY|MERCHANT_?KEY|PAYU_?KEY))\s*[:=]\s*([A-Za-z0-9+/_\-=]{12,})\s*$/i; // env/yaml style, only in config-like files
const CONFIG_FILE = /(^|\/)\.env|\.(ya?ml|sh|toml|txt)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function scan(root: string): Finding[] {
  const findings: Finding[] = [];
  const files = walk(root);
  const rel = (f: string): string => path.relative(root, f).split(path.sep).join('/');

  for (const f of files) {
    const r = rel(f);
    const base = path.basename(f);
    if (/^\.env(\..+)?$/.test(base) && base !== '.env.example' && base !== '.env.sample') findings.push({ severity: 'critical', rule: 'env-file-present', file: r, detail: 'environment file present in the working tree; must never be committed' });
    if (/\.(pem|p12|pfx|key)$/i.test(base)) findings.push({ severity: 'critical', rule: 'key-file', file: r, detail: 'key/certificate file in tree' });
    if (!TEXT_EXT.test(base) && !/^\.env/.test(base)) continue;
    if (statSync(f).size > 1_000_000) continue;
    const inTests = r.startsWith('tests/') || r.startsWith('scripts/scan-secrets');
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(line) && !/scan-secrets|\.test\.ts/.test(r)) findings.push({ severity: 'critical', rule: 'private-key', file: r, line: i + 1, detail: 'private key block' });
      if (/\bAKIA[0-9A-Z]{16}\b/.test(line) && !/scan-secrets|\.test\.ts/.test(r)) findings.push({ severity: 'critical', rule: 'aws-access-key', file: r, line: i + 1, detail: 'AWS access key id' });
      if (!inTests) {
        const m = ASSIGN.exec(line) ?? (CONFIG_FILE.test(r) ? ASSIGN_BARE.exec(line) : null);
        const val = m ? (m[3] ?? m[2]!) : '';
        if (m && !PLACEHOLDER.test(val) && !PLACEHOLDER.test(line) && !/^\s*(\/\/|\*|#)/.test(line)) findings.push({ severity: 'high', rule: 'hardcoded-secret', file: r, line: i + 1, detail: `${m[1]} appears to hold a literal secret` });
      }
    });
  }

  const gi = path.join(root, '.gitignore');
  if (!existsSync(gi) || !/^\.env\s*$/m.test(readFileSync(gi, 'utf8'))) findings.push({ severity: 'high', rule: 'gitignore-missing-env', file: '.gitignore', detail: '.env is not ignored' });

  try {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
    for (const f of tracked) if (/(^|\/)\.env(\..+)?$/.test(f) && !/\.example$|\.sample$/.test(f)) findings.push({ severity: 'critical', rule: 'env-file-tracked', file: f, detail: 'tracked by git' });
  } catch { /* not a git repo: skipped */ }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(process.argv[2] ?? '.');
  const f = scan(root);
  for (const x of f) console.log(`[${x.severity.toUpperCase()}] ${x.rule} ${x.file}${x.line ? ':' + x.line : ''} — ${x.detail}`);
  console.log(f.length ? `\n${f.length} finding(s)` : 'No secrets found.');
  process.exit(f.some((x) => x.severity !== 'medium') ? 1 : 0);
}
