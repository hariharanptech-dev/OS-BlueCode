import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scan } from '../../scripts/scan-secrets.ts';

const mk = (files: Record<string, string>): string => { const d = mkdtempSync(path.join(tmpdir(), 'scan-')); for (const [f, c] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); writeFileSync(path.join(d, f), c); } return d; };
const rules = (d: string) => scan(d).map((f) => f.rule);

describe('SEC-CFG secret scanner (self-test: must detect what it claims to)', () => {
  it('detects a committed .env file', () => { const d = mk({ '.env': 'PAYU_SALT=abc', '.gitignore': '.env\n' }); try { assert.ok(rules(d).includes('env-file-present')); } finally { rmSync(d, { recursive: true }); } });
  it('allows .env.example', () => { const d = mk({ '.env.example': 'PAYU_SALT=replace-me', '.gitignore': '.env\n' }); try { assert.deepEqual(rules(d), []); } finally { rmSync(d, { recursive: true }); } });
  it('detects a hard-coded merchant salt / API secret in source', () => {
    const d = mk({ 'src/pay.ts': 'const PAYU_SALT = "k9Fq2Lw7Vx3Bn6Tz8Ys1Hd4Pc5Rg0Ju";\nconst apiSecret: "Zr8kQ2mXaPq9LwTn4VbYc7";', '.gitignore': '.env\n' });
    try { assert.equal(rules(d).filter((r) => r === 'hardcoded-secret').length, 2); } finally { rmSync(d, { recursive: true }); }
  });
  it('ignores env lookups and obvious placeholders', () => {
    const d = mk({ 'src/a.ts': 'const salt = process.env.PAYU_SALT;\nconst PAYU_SALT = "replace-with-your-salt-value";', '.gitignore': '.env\n' }); try { assert.deepEqual(rules(d), []); } finally { rmSync(d, { recursive: true }); }
  });
  it('detects private keys and AWS keys', () => {
    const d = mk({ 'a/k.txt': '-----BEGIN PRIVATE KEY-----\nabc', 'a/b.ts': 'const k = "AKIAABCDEFGHIJKLMNOP"', '.gitignore': '.env\n' }); try { const r = rules(d); assert.ok(r.includes('private-key')); assert.ok(r.includes('aws-access-key')); } finally { rmSync(d, { recursive: true }); }
  });
  it('flags a .gitignore that does not protect .env', () => { const d = mk({ '.gitignore': 'node_modules\n' }); try { assert.ok(rules(d).includes('gitignore-missing-env')); } finally { rmSync(d, { recursive: true }); } });
  it('flags key / certificate files', () => { const d = mk({ 'certs/server.pem': 'x', '.gitignore': '.env\n' }); try { assert.ok(rules(d).includes('key-file')); } finally { rmSync(d, { recursive: true }); } });
});

describe('SEC-CFG this repository', () => {
  it('has no secrets, no .env file and ignores .env', () => { const f = scan(path.resolve(import.meta.dirname, '../..')); assert.deepEqual(f, [], JSON.stringify(f)); });
  it('.env.example contains placeholders only', () => { const txt = readFileSync(path.resolve(import.meta.dirname, '../../.env.example'), 'utf8'); assert.match(txt, /PAYU_SALT=replace/); assert.match(txt, /PAYU_KEY=replace/); });
});
